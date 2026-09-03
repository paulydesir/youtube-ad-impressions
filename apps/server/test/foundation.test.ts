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
  type DatabaseClient,
} from "../src/db/client.js";
import { createApp } from "../src/http/app.js";

const TOKEN = "test-token";

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

function testApp() {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-foundation-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
  return createApp({ db, ingestToken: TOKEN });
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
});

describe("loadConfig", () => {
  it("applies defaults for optional values", () => {
    assert.deepEqual(loadConfig({ INGEST_API_TOKEN: TOKEN }), {
      PORT: 8787,
      HOST: "127.0.0.1",
      DATABASE_FILE: "./data/ad-impressions.sqlite",
      INGEST_API_TOKEN: TOKEN,
      LOG_LEVEL: "info",
    });
  });

  it("rejects a missing ingestion token", () => {
    assert.throws(() => loadConfig({}), /INGEST_API_TOKEN/);
  });

  it("rejects an invalid port with a clear message", () => {
    assert.throws(
      () => loadConfig({ INGEST_API_TOKEN: TOKEN, PORT: "not-a-port" }),
      /Invalid server configuration: PORT/,
    );
  });

  it("rejects an unknown log level", () => {
    assert.throws(
      () => loadConfig({ INGEST_API_TOKEN: TOKEN, LOG_LEVEL: "verbose" }),
      /Invalid server configuration: LOG_LEVEL/,
    );
  });
});
