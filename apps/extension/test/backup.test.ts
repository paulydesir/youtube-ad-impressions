import assert from "node:assert/strict";
import test from "node:test";
import {
  backupWatchTimeMs,
  buildBackupFile,
  dedupeKey,
  parseBackupFile,
} from "../src/backup.ts";
import type { StoredImpression } from "../src/backup.ts";

function sampleImpression(overrides: Partial<StoredImpression> = {}): StoredImpression {
  return {
    advertiser_name: "jobs.fidelity.com",
    advertiser_url: "jobs.fidelity.com",
    host_video_id: "D3C1Hn0gCOM",
    timestamp: "2026-08-29T14:41:19.045Z",
    ended_at: "2026-08-29T14:41:24.255Z",
    duration_ms: 5210,
    pod_position: "1 of 2",
    pod_index: 1,
    pod_size: 2,
    impression_index: 1,
    skipped: true,
    skip_clicked_at: "2026-08-29T14:41:24.236Z",
    skip_available: true,
    ad_headline: "Find your Fidelity",
    call_to_action: "Learn more",
    creative_title: "Is a career in customer service for you?",
    creative_duration_ms: 30061,
    muted: false,
    playback_rate: 1,
    avatar_url: null,
    player_version: "/s/player/e937390a/player_es6.vflset/en_US/base.js",
    end_reason: "advertiser-hidden",
    id: 1,
    ...overrides,
  };
}

test("round-trips a backup file", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const podId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const backup = buildBackupFile(
    [sampleImpression({ event_id: eventId, pod_id: podId })],
    37453103,
  );
  const parsed = parseBackupFile(JSON.parse(JSON.stringify(backup)));

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.file.formatVersion, 1);
  assert.equal(parsed.file.impressions.length, 1);
  assert.equal(parsed.file.impressions[0]?.advertiser_url, "jobs.fidelity.com");
  assert.equal(parsed.file.impressions[0]?.event_id, eventId);
  assert.equal(parsed.file.impressions[0]?.pod_id, podId);
  assert.equal(parsed.file.impressions[0]?.id, undefined);
  assert.equal(backupWatchTimeMs(parsed.file), 37453103);
});

test("rejects wrong versions, missing arrays, and bad rows", () => {
  assert.equal(parseBackupFile(null).ok, false);
  assert.equal(
    parseBackupFile({ formatVersion: 2, impressions: [] }).ok,
    false,
  );
  assert.equal(parseBackupFile({ formatVersion: 1 }).ok, false);
  const badRow = parseBackupFile({
    formatVersion: 1,
    impressions: [{ timestamp: "2026-08-29T14:41:19.045Z" }],
  });
  assert.equal(badRow.ok, false);
  if (!badRow.ok) assert.match(badRow.error, /index 0/);
});

test("dedupe keys ignore volatile fields but separate distinct ads", () => {
  const base = sampleImpression();
  const reskipped = sampleImpression({ skipped: false, id: 99 });
  const other = sampleImpression({ timestamp: "2026-08-29T14:46:39.049Z" });

  assert.equal(dedupeKey(base), dedupeKey(reskipped));
  assert.notEqual(dedupeKey(base), dedupeKey(other));
});

test("dedupe keys prefer an extension-owned event ID", () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const first = sampleImpression({ event_id: eventId });
  const changed = sampleImpression({
    event_id: eventId,
    timestamp: "2026-09-02T12:00:00.000Z",
    duration_ms: 30_000,
  });

  assert.equal(dedupeKey(first), dedupeKey(changed));
});
