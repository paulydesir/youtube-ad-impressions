import type { IdentifiedAdImpressionRecord } from "../src/types.ts";

export function sampleImpression(
  overrides: Partial<IdentifiedAdImpressionRecord> = {},
): IdentifiedAdImpressionRecord {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    pod_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    advertiser_name: "coursera.org",
    advertiser_url: "coursera.org",
    host_video_id: "abc123",
    timestamp: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15_000,
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
    creative_duration_ms: 15_000,
    muted: false,
    playback_rate: 1,
    avatar_url: null,
    player_version: "test-player",
    end_reason: "completed",
    ...overrides,
  };
}
