import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  closeDatabase,
  initializeDatabase,
  type DatabaseClient,
} from "../src/db/client.js";
import { importLegacyExport } from "../src/import/legacy-import.js";
import { searchImpressions } from "../src/repositories/impressions.js";
import { createSqliteStore, type ImpressionStore } from "../src/repositories/store.js";

function legacyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    advertiser_name: "coursera.org",
    advertiser_url: "coursera.org",
    host_video_id: "abc123",
    timestamp: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15000,
    pod_position: "1 of 2",
    pod_index: 1,
    pod_size: 2,
    impression_index: 0,
    skipped: false,
    skip_clicked_at: null,
    skip_available: true,
    ad_headline: "Save $70+",
    call_to_action: "Start now",
    creative_title: "Coursera: Grow Your Career",
    creative_duration_ms: 15000,
    muted: false,
    playback_rate: 1,
    avatar_url: null,
    player_version: "base.js",
    end_reason: "completed",
    ...overrides,
  };
}

function envelope(impressions: unknown[]): Record<string, unknown> {
  return {
    formatVersion: 1,
    exportedAt: "2026-09-03T14:57:35.590Z",
    database: "AdTrackerDB",
    impressions,
    stats: [{ key: "watch_time_ms", value: 37453103 }],
  };
}

let db: DatabaseClient;
let sqliteStore: ImpressionStore;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-import-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
  sqliteStore = createSqliteStore(db);
});

afterEach(() => {
  closeDatabase(db);
});

describe("importLegacyExport", () => {
  it("imports rows and ignores the stats record", async () => {
    const summary = await importLegacyExport(
      sqliteStore,
      envelope([legacyRow(), { ...legacyRow(), timestamp: "2026-09-02T12:00:00.000Z" }]),
    );
    assert.deepEqual(summary, { accepted: 2, duplicates: 0, rejected: 0 });
    assert.equal((await searchImpressions(db)).length, 2);
  });

  it("is repeat-safe with deterministic event IDs", async () => {
    const data = envelope([{ ...legacyRow(), id: 1 }, { ...legacyRow(), id: 999 }]);
    const first = await importLegacyExport(sqliteStore, data);
    // Same content under a different IndexedDB id is the same observation.
    assert.deepEqual(first, { accepted: 1, duplicates: 1, rejected: 0 });
    const second = await importLegacyExport(sqliteStore, data);
    assert.deepEqual(second, { accepted: 0, duplicates: 2, rejected: 0 });
    assert.equal((await searchImpressions(db)).length, 1);
  });

  it("preserves extension-owned event and pod UUIDs", async () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const podId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await importLegacyExport(
      sqliteStore,
      envelope([legacyRow({ event_id: eventId, pod_id: podId })]),
    );

    const [row] = await searchImpressions(db);
    assert.equal(row?.eventId, eventId);
    assert.equal(row?.podId, podId);
  });

  it("maps legacy pod and advertiser fields onto V1", async () => {
    await importLegacyExport(sqliteStore, envelope([legacyRow()]));
    const [row] = await searchImpressions(db, { advertiser: "coursera" });
    assert.equal(row?.advertiserDomain, "coursera.org");
    assert.equal(row?.podLabel, "1 of 2");
    assert.equal(row?.podPosition, 1);
    assert.equal(row?.podImpressionIndex, 0);
    assert.ok(row?.eventId.startsWith("legacy-"));
    assert.equal(row?.podId, `legacy-pod:${row?.eventId}`);
  });

  it("does not infer shared pods from host video and ad position", async () => {
    await importLegacyExport(
      sqliteStore,
      envelope([
        legacyRow({
          timestamp: "2026-09-01T12:00:00.000Z",
          pod_index: 1,
        }),
        legacyRow({
          timestamp: "2026-09-01T12:00:30.000Z",
          pod_index: 2,
        }),
        legacyRow({
          timestamp: "2026-09-02T12:00:00.000Z",
          pod_index: 1,
        }),
      ]),
    );

    const rows = await searchImpressions(db);
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.podId)).size, 3);
    assert.ok(rows.every((row) => row.podId === `legacy-pod:${row.eventId}`));
  });

  it("counts invalid rows as rejected without aborting", async () => {
    const summary = await importLegacyExport(
      sqliteStore,
      envelope([legacyRow(), { advertiser_name: 42 }, "not-an-object"]),
    );
    assert.deepEqual(summary, { accepted: 1, duplicates: 0, rejected: 2 });
  });

  it("rejects unsupported envelopes", async () => {
    await assert.rejects(importLegacyExport(sqliteStore, envelope([]).impressions), /JSON object/);
    await assert.rejects(importLegacyExport(sqliteStore, { formatVersion: 2, impressions: [] }), /formatVersion/);
    await assert.rejects(importLegacyExport(sqliteStore, { formatVersion: 1 }), /impressions/);
  });
});
