import assert from "node:assert/strict";
import { describe, it } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config/env.js";
import { createApp } from "../src/http/app.js";

const TOKEN = "test-token";

describe("GET /healthz", () => {
  it("reports the service is up without opening a port", async () => {
    const response = await request(createApp()).get("/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, database: "not-configured" });
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
