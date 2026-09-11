import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config/env.js";
import { loadRuntimeEnvironment } from "../src/config/runtime-environment.js";
import { createApp } from "../src/http/app.js";
import type { ImpressionStore } from "../src/repositories/store.js";

const TOKEN = "test-token";

let databaseReady = true;

afterEach(() => { databaseReady = true; });

const store: ImpressionStore = {
  insertImpression: async (_userId, record) => ({ status: "inserted", eventId: record.event_id }),
  searchImpressions: async () => [],
  getAdvertiserStats: async () => [],
  getAdvertiserOverviewData: async () => ({ stats: null, recent: [], headlines: [], creativeTitles: [] }),
};

function testApp(requestLog?: (message: string) => void) {
  return createApp({
    store,
    isDatabaseReady: () => Promise.resolve(databaseReady),
    verifyAccessToken: async token => {
      if (token !== TOKEN) throw new Error("Invalid token");
      return { userId: "9c3f24dd-50ab-4f8c-a389-a860dd3053ae", email: "test@example.com" };
    },
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
    databaseReady = false;
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
      loadConfig({}),
      {
      APP_ENV: "development",
      SUPABASE_URL: "http://127.0.0.1:54321",
      PORT: 8787,
      HOST: "127.0.0.1",
      DATABASE_URL: "postgresql://ad_impressions:ad_impressions@127.0.0.1:5432/ad_impressions",
      MCP_RESOURCE_URL: "http://127.0.0.1:8787/mcp",
      LOG_LEVEL: "info",
      POSTGRES_USER: "ad_impressions",
      POSTGRES_PASSWORD: "ad_impressions",
      POSTGRES_DB: "ad_impressions",
      POSTGRES_PORT: 5432,
      },
    );
  });

  it("does not require an ingestion token", () => {
    assert.doesNotThrow(() => loadConfig({}));
  });
  it("requires injected remote services in production", () => {
    assert.throws(() => loadConfig({ APP_ENV: "production" }), /SUPABASE_URL/);
    assert.deepEqual(
      loadConfig({
        APP_ENV: "production",
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        DATABASE_URL: "postgresql://user:password@db.example.com:5432/postgres",
        MCP_RESOURCE_URL: "https://api.example.com/mcp",
      }),
      {
        APP_ENV: "production",
        SUPABASE_URL: "https://project.supabase.co/",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        DATABASE_URL: "postgresql://user:password@db.example.com:5432/postgres",
        MCP_RESOURCE_URL: "https://api.example.com/mcp",
        PORT: 8787,
        HOST: "0.0.0.0",
        LOG_LEVEL: "info",
        POSTGRES_USER: "ad_impressions",
        POSTGRES_PASSWORD: "ad_impressions",
        POSTGRES_DB: "ad_impressions",
        POSTGRES_PORT: 5432,
      },
    );
  });

  it("rejects loopback service URLs in production", () => {
    assert.throws(() => loadConfig({
      APP_ENV: "production",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      DATABASE_URL: "postgresql://user:password@db.example.com:5432/postgres",
      MCP_RESOURCE_URL: "https://api.example.com/mcp",
    }), /SUPABASE_URL/);
  });
  it("rejects unsafe resource URLs", () => {
    for (const url of ["http://example.com/mcp", "https://user:pass@example.com/mcp", "https://example.com/mcp#fragment", "https://example.com/mcp?token=x"]) {
      assert.throws(() => loadConfig({ MCP_RESOURCE_URL: url }), /MCP_RESOURCE_URL/);
    }
  });

  it("rejects an invalid port with a clear message", () => {
    assert.throws(
      () =>
        loadConfig({
              MCP_RESOURCE_URL: "http://127.0.0.1:8787/mcp",
          PORT: "not-a-port",
        }),
      /Invalid server configuration: PORT/,
    );
  });

  it("rejects an unknown log level", () => {
    assert.throws(
      () =>
        loadConfig({
              MCP_RESOURCE_URL: "http://127.0.0.1:8787/mcp",
          LOG_LEVEL: "verbose",
        }),
      /Invalid server configuration: LOG_LEVEL/,
    );
  });
});

describe("loadRuntimeEnvironment", () => {
  it("loads ignored files only for development", () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-impressions-env-"));
    writeFileSync(join(dir, ".env.development.local"), "SUPABASE_URL=http://127.0.0.1:54321\n");
    const env: NodeJS.ProcessEnv = {};
    assert.equal(loadRuntimeEnvironment(dir, env), "development");
    assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
  });

  it("does not read files in production", () => {
    const dir = mkdtempSync(join(tmpdir(), "ad-impressions-env-"));
    writeFileSync(join(dir, ".env"), "DATABASE_URL=postgresql://local\n");
    const env: NodeJS.ProcessEnv = { APP_ENV: "production" };
    assert.equal(loadRuntimeEnvironment(dir, env), "production");
    assert.equal(env.DATABASE_URL, undefined);
  });
});
