import assert from "node:assert/strict";
import test from "node:test";
import type { ImpressionEndDetail } from "../src/ad-state-machine.ts";
import {
  buildImpressionRecord,
  ImpressionMetadataStore,
} from "../src/content/impression-builder.ts";
import type { StoredMetadata } from "../src/content/impression-builder.ts";

function endDetail(overrides: Partial<ImpressionEndDetail> = {}): ImpressionEndDetail {
  return {
    eventId: "event-1",
    podId: "pod-1",
    advertiserDomain: "example.com",
    impressionIndex: 1,
    startedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
    endedAtMs: Date.parse("2026-01-01T00:00:30.000Z"),
    durationMs: 30000,
    reason: "pod-ended",
    ...overrides,
  };
}

function storedMetadata(
  overrides: Partial<StoredMetadata> = {},
): StoredMetadata {
  return {
    advertiserDomain: "example.com",
    advertiserName: "Example",
    adHeadline: "Save big",
    callToAction: "Buy now",
    creativeTitle: "Creative",
    disclosureLabel: "Ad",
    podLabel: "1 of 2",
    podPosition: 1,
    podSize: 2,
    skipAvailableAtCapture: true,
    creativeDurationMs: 30000,
    creativeCurrentTimeMs: 5000,
    creativeMutedAtCapture: false,
    creativePlaybackRate: 1,
    avatarUrl: "https://example.com/avatar.png",
    playerVersion: "9.9.9",
    skipped: true,
    skipClickedAt: "2026-01-01T00:00:10.000Z",
    ...overrides,
  };
}

test("buildImpressionRecord maps metadata and state to the stored shape", () => {
  const record = buildImpressionRecord(endDetail(), storedMetadata(), "host-1");

  assert.equal(record.event_id, "event-1");
  assert.equal(record.pod_id, "pod-1");
  assert.equal(record.advertiser_name, "Example");
  assert.equal(record.advertiser_url, "example.com");
  assert.equal(record.host_video_id, "host-1");
  assert.equal(record.timestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(record.ended_at, "2026-01-01T00:00:30.000Z");
  assert.equal(record.duration_ms, 30000);
  assert.equal(record.pod_position, "1 of 2");
  assert.equal(record.pod_index, 1);
  assert.equal(record.pod_size, 2);
  assert.equal(record.impression_index, 1);
  assert.equal(record.skipped, true);
  assert.equal(record.skip_clicked_at, "2026-01-01T00:00:10.000Z");
  assert.equal(record.skip_available, true);
  assert.equal(record.ad_headline, "Save big");
  assert.equal(record.call_to_action, "Buy now");
  assert.equal(record.creative_title, "Creative");
  assert.equal(record.creative_duration_ms, 30000);
  assert.equal(record.muted, false);
  assert.equal(record.playback_rate, 1);
  assert.equal(record.avatar_url, "https://example.com/avatar.png");
  assert.equal(record.player_version, "9.9.9");
  assert.equal(record.end_reason, "pod-ended");
});

test("buildImpressionRecord preserves legacy fallbacks for sparse metadata", () => {
  const record = buildImpressionRecord(endDetail(), {}, null);

  assert.equal(record.advertiser_name, null);
  assert.equal(record.advertiser_url, null);
  assert.equal(record.host_video_id, null);
  assert.equal(record.skipped, false);
  assert.equal(record.skip_clicked_at, null);
  assert.equal(record.skip_available, false);
  assert.equal(record.muted, null);
});

test("buildImpressionRecord falls back to the domain for the name", () => {
  const record = buildImpressionRecord(
    endDetail(),
    { advertiserDomain: "fallback.example", advertiserName: null },
    "host-1",
  );
  assert.equal(record.advertiser_name, "fallback.example");
});

test("ImpressionMetadataStore tracks skips per impression", () => {
  const store = new ImpressionMetadataStore();
  assert.deepEqual(store.snapshot(1), {});

  store.set(1, storedMetadata({ skipped: false }));
  assert.equal(store.get(1)?.skipped, false);
  assert.equal(store.markSkipped(1, "2026-01-01T00:00:10.000Z"), true);
  assert.equal(store.get(1)?.skipped, true);
  assert.equal(store.get(1)?.skipClickedAt, "2026-01-01T00:00:10.000Z");

  assert.equal(store.markSkipped(999, "2026-01-01T00:00:10.000Z"), false);

  store.delete(1);
  assert.deepEqual(store.snapshot(1), {});

  store.set(1, storedMetadata());
  store.set(2, storedMetadata());
  store.clear();
  assert.deepEqual(store.snapshot(1), {});
  assert.deepEqual(store.snapshot(2), {});
});
