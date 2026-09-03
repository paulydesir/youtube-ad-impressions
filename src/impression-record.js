(function exposeImpressionRecordSchema(global) {
  "use strict";

  const SCHEMA_VERSION = 1;

  function isoTimestamp(milliseconds) {
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds).toISOString()
      : null;
  }

  function buildAdImpressionRecord({ detail, metadata, hostVideoId }) {
    if (!detail?.eventId || !detail?.podId) {
      throw new Error("Ad impressions require event and pod IDs");
    }

    return {
      schema_version: SCHEMA_VERSION,
      event_id: detail.eventId,
      source: "youtube",

      started_at: isoTimestamp(detail.startedAtMs),
      ended_at: isoTimestamp(detail.endedAtMs),
      duration_ms: detail.durationMs ?? null,

      host_video_id: hostVideoId || null,
      advertiser_name:
        metadata.advertiserName || metadata.advertiserDomain || null,
      advertiser_domain: metadata.advertiserDomain || null,

      ad_headline: metadata.adHeadline || null,
      call_to_action: metadata.callToAction || null,
      creative_title: metadata.creativeTitle || null,
      disclosure_label: metadata.disclosureLabel || null,
      creative_duration_ms: metadata.creativeDurationMs ?? null,
      creative_current_time_ms_at_start:
        metadata.creativeCurrentTimeMs ?? null,

      pod_id: detail.podId,
      pod_label: metadata.podLabel || null,
      pod_position: metadata.podPosition ?? null,
      pod_size: metadata.podSize ?? null,
      pod_impression_index: detail.podImpressionIndex,

      skipped: Boolean(metadata.skipped),
      skip_clicked_at: metadata.skipClickedAt || null,
      skip_available_at_start: Boolean(metadata.skipAvailableAtCapture),
      muted_at_start: metadata.creativeMutedAtCapture ?? null,
      playback_rate_at_start: metadata.creativePlaybackRate ?? null,

      avatar_url: metadata.avatarUrl || null,
      player_version: metadata.playerVersion || null,
      end_reason: detail.reason || null,
    };
  }

  global.YouTubeAdImpressionSchema = {
    SCHEMA_VERSION,
    buildAdImpressionRecord,
  };
})(globalThis);
