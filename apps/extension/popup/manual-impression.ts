import type { IdentifiedAdImpressionRecord } from "../src/types.ts";

export function manualImpression(advertiser: string, offer: string, link: string): IdentifiedAdImpressionRecord {
  const advertiserName = advertiser.trim();
  const details = offer.trim();
  const sourceUrl = link.trim() || null;
  if (!advertiserName || advertiserName.length > 200) throw new Error("Enter an advertiser (up to 200 characters).");
  if (!details || details.length > 10000) throw new Error("Enter offer details (up to 10,000 characters).");
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new Error("Enter a valid source link, or leave it blank."); }
    if (!["http:", "https:"].includes(url.protocol) || sourceUrl.length > 2048) throw new Error("Use an HTTP or HTTPS source link (up to 2,048 characters).");
  }
  const now = new Date().toISOString();
  return {
    source: "manual", source_url: sourceUrl,
    event_id: crypto.randomUUID(), pod_id: crypto.randomUUID(),
    advertiser_name: advertiserName, advertiser_url: null,
    ad_headline: details, timestamp: now, ended_at: now,
    host_video_id: null, duration_ms: null, pod_position: null, pod_index: null,
    pod_size: null, impression_index: 0, skipped: false, skip_clicked_at: null,
    skip_available: false, call_to_action: null, creative_title: null,
    creative_duration_ms: null, muted: null, playback_rate: null,
    avatar_url: null, player_version: null, end_reason: "manual-entry",
  };
}
