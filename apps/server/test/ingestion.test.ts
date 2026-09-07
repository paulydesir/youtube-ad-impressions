import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  closeDatabase,
  initializeDatabase,
  isDatabaseReady,
  type DatabaseClient,
} from "../src/db/client.js";
import { createApp } from "../src/http/app.js";
import { createSqliteStore } from "../src/repositories/store.js";

const TOKEN = "ingest-test-token";
const MCP_TOKEN = "mcp-test-token";

function impression(eventId: string): Record<string, unknown> {
  return {
    schema_version: 1,
    event_id: eventId,
    source: "youtube",
    started_at: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15000,
    host_video_id: "abc123",
    advertiser_name: "coursera.org",
    advertiser_domain: "coursera.org",
    ad_headline: "Save $70+",
    call_to_action: "Start now",
    creative_title: "Coursera: Grow Your Career",
    creative_duration_ms: 15000,
    pod_id: "pod-1",
    pod_label: null,
    pod_position: 1,
    pod_size: 2,
    pod_impression_index: 0,
    skipped: false,
    skip_clicked_at: null,
    end_reason: "completed",
  };
}

let db: DatabaseClient;
let app: Express;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-ingest-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
  app = createApp({
    store: createSqliteStore(db),
    isDatabaseReady: () => Promise.resolve(isDatabaseReady(db)),
    ingestToken: TOKEN,
    mcpToken: MCP_TOKEN,
  });
});

afterEach(() => {
  closeDatabase(db);
});

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${TOKEN}`);

describe("POST /api/v1/impressions", () => {
  it("stores a new record with 201", async () => {
    const response = await auth(request(app).post("/api/v1/impressions")).send(
      impression("evt-new"),
    );
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { event_id: "evt-new", duplicate: false });
  });

  it("returns 200 with duplicate:true when the event already exists", async () => {
    await auth(request(app).post("/api/v1/impressions")).send(impression("evt-dup"));
    const response = await auth(request(app).post("/api/v1/impressions")).send(
      impression("evt-dup"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { event_id: "evt-dup", duplicate: true });
  });

  it("returns 400 for an invalid record without storing anything", async () => {
    const response = await auth(request(app).post("/api/v1/impressions")).send({
      ...impression("evt-bad"),
      started_at: "not-a-timestamp",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_record");
  });

  it("returns 401 without a token and with a wrong token", async () => {
    const missing = await request(app).post("/api/v1/impressions").send(impression("e1"));
    assert.equal(missing.status, 401);
    const wrong = await request(app)
      .post("/api/v1/impressions")
      .set("Authorization", "Bearer wrong-token")
      .send(impression("e1"));
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, { error: "unauthorized" });
  });

  it("returns 400 JSON for a malformed JSON body", async () => {
    const response = await request(app)
      .post("/api/v1/impressions")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set("Content-Type", "application/json")
      .send("{oops");
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_json");
  });
});

describe("GET /api/v1/impressions", () => {
  it("returns stored records newest first", async () => {
    await auth(request(app).post("/api/v1/impressions")).send(impression("evt-read"));
    const response = await auth(request(app).get("/api/v1/impressions"));
    assert.equal(response.status, 200);
    assert.equal(response.body.records.length, 1);
    assert.equal(response.body.records[0].eventId, "evt-read");
  });

  it("requires authorization", async () => {
    const response = await request(app).get("/api/v1/impressions");
    assert.equal(response.status, 401);
  });
});

describe("POST /api/v1/impressions/batch", () => {
  it("reports accepted, duplicate, and rejected counts", async () => {
    await auth(request(app).post("/api/v1/impressions")).send(impression("evt-seen"));
    const response = await auth(request(app).post("/api/v1/impressions/batch")).send([
      impression("evt-batch-1"),
      impression("evt-seen"),
      { ...impression("evt-bad"), duration_ms: -1 },
    ]);
    assert.equal(response.status, 200);
    assert.equal(response.body.accepted, 1);
    assert.equal(response.body.duplicates, 1);
    assert.equal(response.body.rejected, 1);
    assert.equal(response.body.errors.length, 1);
    assert.equal(response.body.errors[0].index, 2);
  });

  it("rejects batches larger than 500 records", async () => {
    const response = await auth(request(app).post("/api/v1/impressions/batch")).send(
      Array.from({ length: 501 }, (_, index) => impression(`evt-overflow-${index}`)),
    );
    assert.equal(response.status, 413);
    assert.equal(response.body.error, "batch_too_large");
  });

  it("rejects a non-array batch body", async () => {
    const response = await auth(request(app).post("/api/v1/impressions/batch")).send({
      event_id: "not-an-array",
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_batch");
  });

  it("requires authorization", async () => {
    const response = await request(app)
      .post("/api/v1/impressions/batch")
      .send([impression("evt-x")]);
    assert.equal(response.status, 401);
  });
});
