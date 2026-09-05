import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config/env.js";
import {
  closeDatabase,
  initializeDatabase,
  isDatabaseReady,
  type DatabaseClient,
} from "../src/db/client.js";
import { createApp } from "../src/http/app.js";
import { createSqliteStore } from "../src/repositories/store.js";

const TOKEN = "test-token";
const MCP_TOKEN = "mcp-test-token";

let db: DatabaseClient;

afterEach(() => {
  // Tests may close the database themselves (unavailability probe); a second
  // close is harmless.
  try {
    if (db !== undefined) closeDatabase(db);
  } catch {
    // Already closed.
  }
});

function testApp(requestLog?: (message: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-foundation-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
  return createApp({
    store: createSqliteStore(db),
    // Closes over the mutable `db` binding so the unavailability test below
    // (which closes the database) still observes the failure.
    isDatabaseReady: () => Promise.resolve(isDatabaseReady(db)),
    ingestToken: TOKEN,
    mcpToken: MCP_TOKEN,
    requestLog,
  });
}

describe("GET /healthz", () => {
  it("reports the service and database as ready without opening a port", async () => {
    const response = await request(testApp()).get("/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, database: "ready" });
  });

  it("reports unavailability when the database cannot answer", async () => {
    const app = testApp();
    closeDatabase(db);
    const response = await request(app).get("/healthz");
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { ok: false, database: "unavailable" });
  });

  it("logs request metadata without payloads", async () => {
    const messages: string[] = [];
    const response = await request(testApp((message) => messages.push(message))).get(
      "/healthz",
    );

    assert.equal(response.status, 200);
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /^GET \/healthz 200 \d+ms$/);
  });
});

describe("loadConfig", () => {
  it("applies defaults for optional values", () => {
    assert.deepEqual(
      loadConfig({ INGEST_API_TOKEN: TOKEN, MCP_API_TOKEN: MCP_TOKEN }),
      {
      PORT: 8787,
      HOST: "127.0.0.1",
      DATABASE_FILE: "./data/ad-impressions.sqlite",
      INGEST_API_TOKEN: TOKEN,
      MCP_API_TOKEN: MCP_TOKEN,
      LOG_LEVEL: "info",
      POSTGRES_USER: "ad_impressions",
      POSTGRES_PASSWORD: "ad_impressions",
      POSTGRES_DB: "ad_impressions",
      POSTGRES_PORT: 5432,
      },
    );
  });

  it("rejects a missing ingestion token", () => {
    assert.throws(() => loadConfig({ MCP_API_TOKEN: MCP_TOKEN }), /INGEST_API_TOKEN/);
  });

  it("rejects a missing or reused MCP token", () => {
    assert.throws(() => loadConfig({ INGEST_API_TOKEN: TOKEN }), /MCP_API_TOKEN/);
    assert.throws(
      () => loadConfig({ INGEST_API_TOKEN: TOKEN, MCP_API_TOKEN: TOKEN }),
      /must differ/,
    );
  });

  it("rejects an invalid port with a clear message", () => {
    assert.throws(
      () =>
        loadConfig({
          INGEST_API_TOKEN: TOKEN,
          MCP_API_TOKEN: MCP_TOKEN,
          PORT: "not-a-port",
        }),
      /Invalid server configuration: PORT/,
    );
  });

  it("rejects an unknown log level", () => {
    assert.throws(
      () =>
        loadConfig({
          INGEST_API_TOKEN: TOKEN,
          MCP_API_TOKEN: MCP_TOKEN,
          LOG_LEVEL: "verbose",
        }),
      /Invalid server configuration: LOG_LEVEL/,
    );
  });
});
