import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import {
  closeDatabase,
  initializeDatabase,
  type DatabaseClient,
} from "../src/db/client.js";
import { insertImpression } from "../src/repositories/impressions.js";
import {
  getAdvertiserOverview,
  getAdvertiserStats,
  searchImpressions,
} from "../src/services/impressions.js";

function impression(eventId: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

let db: DatabaseClient;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-service-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
});

afterEach(() => {
  closeDatabase(db);
});

async function store(input: Record<string, unknown>) {
  const { record, rawJson } = toAdImpressionV1(input);
  await insertImpression(db, record, rawJson);
}

// Mirrors the end-to-end acceptance scenario: two Coursera observations with
// distinct headlines plus other advertisers for ranking questions.
async function seedScenario() {
  await store(impression("evt-c1", { ad_headline: "Save $70+" }));
  await store(
    impression("evt-c2", {
      started_at: "2026-09-02T12:00:00.000Z",
      ad_headline: "Invest in Your Growth",
    }),
  );
  await store(
    impression("evt-g1", {
      advertiser_name: "Granola",
      advertiser_domain: "granola.ai",
      ad_headline: "Get the doing done",
      creative_title: "Granola ad",
      skipped: true,
      started_at: "2026-09-03T12:00:00.000Z",
    }),
  );
}

describe("analysis services", () => {
  it("answers Coursera history: two observations with both headlines", async () => {
    await seedScenario();
    const rows = await searchImpressions(db, { advertiser: "coursera" });
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.adHeadline).sort(),
      ["Invest in Your Growth", "Save $70+"],
    );
    assert.ok(rows.every((row) => !("rawJson" in row)));
  });

  it("answers frequency questions with ranked advertiser stats", async () => {
    await seedScenario();
    const stats = await getAdvertiserStats(db);
    assert.equal(stats[0]?.advertiser, "coursera.org");
    assert.equal(stats[0]?.impressionCount, 2);
    assert.equal(stats[0]?.skipRate, 0);
    assert.equal(stats[1]?.advertiser, "granola.ai");
    assert.equal(stats[1]?.skipRate, 1);
  });

  it("answers single-advertiser questions with an overview", async () => {
    await seedScenario();
    const overview = await getAdvertiserOverview(db, "Coursera");
    assert.equal(overview.stats?.impressionCount, 2);
    assert.equal(overview.recent.length, 2);
    assert.deepEqual(overview.headlines, ["Invest in Your Growth", "Save $70+"]);
    assert.deepEqual(overview.creativeTitles, ["Coursera: Grow Your Career"]);
  });

  it("returns empty overview data for an unknown advertiser", async () => {
    await seedScenario();
    const overview = await getAdvertiserOverview(db, "nobody");
    assert.equal(overview.stats, null);
    assert.deepEqual(overview.recent, []);
  });

  it("enforces result limits", async () => {
    await seedScenario();
    assert.equal((await searchImpressions(db, { limit: 1 })).length, 1);
    assert.equal((await getAdvertiserStats(db, { limit: 1 })).length, 1);
  });
});
