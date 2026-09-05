// Combines extracted metadata + tracker state into the final record.
// Pure domain code: no DOM, no Chrome, no YouTube knowledge.
import type { ImpressionEndDetail } from "../ad-state-machine.ts";
import type { AdMetadata } from "./extract.ts";
import type { IdentifiedAdImpressionRecord } from "../types.ts";

export interface StoredMetadata extends AdMetadata {
  skipped: boolean;
  skipClickedAt: string | null;
}

/** Build the storage/messaging record for one completed impression. */
export function buildImpressionRecord(
  detail: ImpressionEndDetail,
  metadata: Partial<StoredMetadata>,
  hostVideoId: string | null,
): IdentifiedAdImpressionRecord {
  return {
    event_id: detail.eventId,
    pod_id: detail.podId,
    advertiser_name: metadata.advertiserName ?? metadata.advertiserDomain ?? null,
    advertiser_url: metadata.advertiserDomain ?? null,
    host_video_id: hostVideoId,
    timestamp: new Date(detail.startedAtMs).toISOString(),
    ended_at: new Date(detail.endedAtMs).toISOString(),
    duration_ms: detail.durationMs,
    pod_position: metadata.podLabel ?? null,
    pod_index: metadata.podPosition ?? null,
    pod_size: metadata.podSize ?? null,
    impression_index: detail.impressionIndex,
    skipped: metadata.skipped ?? false,
    skip_clicked_at: metadata.skipClickedAt ?? null,
    skip_available: metadata.skipAvailableAtCapture ?? false,
    ad_headline: metadata.adHeadline ?? null,
    call_to_action: metadata.callToAction ?? null,
    creative_title: metadata.creativeTitle ?? null,
    creative_duration_ms: metadata.creativeDurationMs ?? null,
    muted: metadata.creativeMutedAtCapture ?? null,
    playback_rate: metadata.creativePlaybackRate ?? null,
    avatar_url: metadata.avatarUrl ?? null,
    player_version: metadata.playerVersion ?? null,
    end_reason: detail.reason,
  };
}

/**
 * Owns per-impression metadata captured at impression start, including
 * skip presses observed before the impression ends.
 */
export class ImpressionMetadataStore {
  private readonly entries = new Map<number, StoredMetadata>();

  set(impressionIndex: number, metadata: AdMetadata): void {
    this.entries.set(impressionIndex, {
      ...metadata,
      skipped: false,
      skipClickedAt: null,
    });
  }

  get(impressionIndex: number): StoredMetadata | undefined {
    return this.entries.get(impressionIndex);
  }

  /** Snapshot for building the record; empty object when nothing was stored. */
  snapshot(impressionIndex: number): Partial<StoredMetadata> {
    return this.entries.get(impressionIndex) ?? {};
  }

  markSkipped(impressionIndex: number, clickedAt: string): boolean {
    const metadata = this.entries.get(impressionIndex);
    if (!metadata) return false;
    metadata.skipped = true;
    metadata.skipClickedAt = clickedAt;
    return true;
  }

  delete(impressionIndex: number): void {
    this.entries.delete(impressionIndex);
  }

  clear(): void {
    this.entries.clear();
  }
}
