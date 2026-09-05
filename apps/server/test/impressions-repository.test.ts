import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import { closeDatabase, initializeDatabase, type DatabaseClient } from "../src/db/client.js";
import {
  getAdvertiserOverviewData,
  getAdvertiserStats,
  insertImpression,
  searchImpressions,
} from "../src/repositories/impressions.js";

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

let db: DatabaseClient;

beforeEach(() => {
  // Every test gets a fresh migrated database in the OS temp dir — the real
  // user database is never touched.
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-test-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
});

afterEach(() => {
  closeDatabase(db);
});

async function store(input: Record<string, unknown>) {
  const { record, rawJson } = toAdImpressionV1(input);
  return insertImpression(db, record, rawJson);
}

describe("insertImpression", () => {
  it("migrates a fresh database and stores a record", async () => {
    const result = await store(impression({ event_id: "evt-1" }));
    assert.equal(result.status, "inserted");
    assert.equal((await searchImpressions(db)).length, 1);
  });

  it("is idempotent by event_id", async () => {
    const input = impression({ event_id: "evt-dedupe" });
    assert.equal((await store(input)).status, "inserted");
    assert.equal((await store(input)).status, "duplicate");
    assert.equal((await searchImpressions(db)).length, 1);
  });
});

describe("searchImpressions", () => {
  it("matches advertisers case-insensitively and newest first", async () => {
    await store(impression({ event_id: "e1", started_at: "2026-09-01T12:00:00.000Z" }));
    await store(
      impression({ event_id: "e2", started_at: "2026-09-02T12:00:00.000Z" }),
    );
    const rows = await searchImpressions(db, { advertiser: "COURSERA" });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.eventId, "e2");
    assert.ok(!("rawJson" in rows[0]!));
  });

  it("matches terms across headline, CTA, and creative with OR semantics", async () => {
    await store(impression({ event_id: "e1", ad_headline: "Save $70+" }));
    await store(
      impression({
        event_id: "e2",
        ad_headline: "Something else",
        creative_title: "Grow Your Career",
      }),
    );
    await store(
      impression({
        event_id: "e3",
        ad_headline: "Unrelated",
        call_to_action: "Learn more",
        creative_title: "Other show",
        advertiser_name: "example",
        advertiser_domain: "example.com",
      }),
    );
    const rows = await searchImpressions(db, { terms: ["Save", "Career"] });
    assert.deepEqual(
      rows.map((row) => row.eventId).sort(),
      ["e1", "e2"],
    );
  });

  it("filters by date range and skip status", async () => {
    await store(
      impression({ event_id: "e1", started_at: "2026-08-01T12:00:00.000Z", skipped: true }),
    );
    await store(
      impression({ event_id: "e2", started_at: "2026-09-01T12:00:00.000Z", skipped: false }),
    );
    assert.equal(
      (await searchImpressions(db, { from: "2026-08-15T00:00:00.000Z" })).length,
      1,
    );
    assert.equal((await searchImpressions(db, { skipped: true }))[0]?.eventId, "e1");
  });

  it("clamps limits to a maximum of 100", async () => {
    for (let n = 0; n < 5; n += 1) {
      await store(impression({ event_id: `bulk-${n}` }));
    }
    assert.equal((await searchImpressions(db, { limit: 2 })).length, 2);
    assert.equal((await searchImpressions(db, { limit: 5000 })).length, 5);
  });
});

describe("getAdvertiserStats", () => {
  it("aggregates counts, durations, skips, and first/last seen", async () => {
    await store(
      impression({
        event_id: "e1",
        started_at: "2026-09-01T12:00:00.000Z",
        duration_ms: 10000,
        skipped: true,
      }),
    );
    await store(
      impression({
        event_id: "e2",
        started_at: "2026-09-03T12:00:00.000Z",
        duration_ms: 20000,
        skipped: false,
      }),
    );
    await store(
      impression({
        event_id: "e3",
        advertiser_name: "Other",
        advertiser_domain: "other.com",
        started_at: "2026-09-02T12:00:00.000Z",
        duration_ms: 5000,
        skipped: false,
      }),
    );
    const stats = await getAdvertiserStats(db);
    assert.equal(stats.length, 2);
    assert.equal(stats[0]?.advertiser, "coursera.org");
    assert.equal(stats[0]?.impressionCount, 2);
    assert.equal(stats[0]?.totalDurationMs, 30000);
    assert.equal(stats[0]?.skippedCount, 1);
    assert.equal(stats[0]?.firstSeenAt, "2026-09-01T12:00:00.000Z");
    assert.equal(stats[0]?.lastSeenAt, "2026-09-03T12:00:00.000Z");
  });
});

describe("getAdvertiserOverviewData", () => {
  it("returns stats, recent impressions, and distinct texts", async () => {
    await store(impression({ event_id: "e1", ad_headline: "Save $70+" }));
    await store(impression({ event_id: "e2", ad_headline: "Invest in Your Growth" }));
    const overview = await getAdvertiserOverviewData(db, "coursera.org");
    assert.equal(overview.stats?.impressionCount, 2);
    assert.equal(overview.recent.length, 2);
    assert.deepEqual(overview.headlines, ["Invest in Your Growth", "Save $70+"]);
    assert.deepEqual(overview.creativeTitles, ["Coursera: Grow Your Career"]);
  });

  it("returns empty data for an unknown advertiser", async () => {
    const overview = await getAdvertiserOverviewData(db, "nobody");
    assert.equal(overview.stats, null);
    assert.deepEqual(overview.recent, []);
    assert.deepEqual(overview.headlines, []);
  });
});
