const TEST_USER = "9c3f24dd-50ab-4f8c-a389-a860dd3053ae";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import { openDatabase, type Database } from "../src/db/database.js";
import type { ImpressionStore } from "../src/repositories/store.js";

const describePostgres = describe.skipIf(process.env.DATABASE_URL === undefined);

function impression(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
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
    ...overrides,
  };
}

describePostgres("postgres store (DATABASE_URL)", () => {
  let database: Database;
  let store: ImpressionStore;

  beforeEach(async () => {
    database = await openDatabase({
      DATABASE_URL: process.env.DATABASE_URL!,
    });
    assert.equal(database.kind, "postgres");
    store = database.store;
  });

  afterEach(async () => {
    await database.close();
  });

  async function put(input: Record<string, unknown>) {
    const { record, rawJson } = toAdImpressionV1(input);
    return store.insertImpression(TEST_USER, record, rawJson);
  }

  it("opens the postgres backend and reports ready", async () => {
    assert.equal(await database.isReady(), true);
  });

  it("inserts idempotently by event_id", async () => {
    const input = impression({ event_id: `pg-test-${Date.now()}` });
    assert.equal((await put(input)).status, "inserted");
    assert.equal((await put(input)).status, "duplicate");
  });

  it("searches case-insensitively, newest first", async () => {
    const prefix = `pg-test-${Date.now()}`;
    await put(
      impression({
        event_id: `${prefix}-1`,
        started_at: "2026-09-01T12:00:00.000Z",
        ad_headline: prefix,
      }),
    );
    await put(
      impression({
        event_id: `${prefix}-2`,
        started_at: "2026-09-02T12:00:00.000Z",
        ad_headline: prefix,
      }),
    );
    const rows = await store.searchImpressions(TEST_USER, { advertiser: "COURSERA", terms: [prefix] });
    assert.deepEqual(
      rows.map((row) => row.eventId),
      [`${prefix}-2`, `${prefix}-1`],
    );
    assert.ok(rows.every((row) => !("rawJson" in row)));
  });

  it("aggregates advertiser stats", async () => {
    const prefix = `pg-stats-${Date.now()}`;
    await put(
      impression({
        event_id: `${prefix}-1`,
        advertiser_name: prefix,
        advertiser_domain: `${prefix}.com`,
        duration_ms: 10000,
        skipped: true,
      }),
    );
    await put(
      impression({
        event_id: `${prefix}-2`,
        advertiser_name: prefix,
        advertiser_domain: `${prefix}.com`,
        duration_ms: 20000,
        skipped: false,
      }),
    );
    const stats = await store.getAdvertiserStats(TEST_USER, { advertiser: `${prefix}.com` });
    assert.equal(stats.length, 1);
    assert.equal(stats[0]?.impressionCount, 2);
    assert.equal(stats[0]?.totalDurationMs, 30000);
    assert.equal(stats[0]?.skippedCount, 1);
  });
});
