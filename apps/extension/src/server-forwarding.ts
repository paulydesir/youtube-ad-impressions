import type { AdImpressionV1 } from "@ad-impressions/contracts";
import type { AdImpressionRecord } from "./types.ts";

export const LOCAL_SERVER_ENDPOINT =
  "http://127.0.0.1:8787/api/v1/impressions";
export const INGEST_TOKEN_STORAGE_KEY = "localServerIngestToken";
export const FORWARD_TIMEOUT_MS = 2_000;

type Fetch = typeof globalThis.fetch;

export interface CompanionForwarderOptions {
  getToken: () => Promise<string | null>;
  fetch?: Fetch;
  endpoint?: string;
  timeoutMs?: number;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

function stableIdentityFields(record: AdImpressionRecord): unknown[] {
  return [
    record.timestamp,
    record.ended_at,
    record.advertiser_name,
    record.advertiser_url,
    record.host_video_id,
    record.duration_ms,
    record.ad_headline,
    record.call_to_action,
    record.creative_title,
    record.creative_duration_ms,
    record.pod_index,
    record.pod_size,
    record.impression_index,
    record.skipped,
    record.skip_clicked_at,
    record.end_reason,
  ];
}

async function legacyEventId(record: AdImpressionRecord): Promise<string> {
  const input = new TextEncoder().encode(
    JSON.stringify(stableIdentityFields(record)),
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `legacy-${hex}`;
}

function legacyPodId(eventId: string): string {
  // The captured pod_index is the ad's position, not a pod boundary. Use an
  // event-derived ID rather than falsely grouping unrelated impressions.
  return `legacy-pod:${eventId}`;
}

// Matches the server importer's normalization and deterministic identity so a
// later backup import cannot duplicate an observation already forwarded live.
export async function toAdImpressionV1(
  record: AdImpressionRecord,
): Promise<AdImpressionV1> {
  const eventId = record.event_id?.trim() || (await legacyEventId(record));
  const podId = record.pod_id?.trim() || legacyPodId(eventId);
  return {
    schema_version: 1,
    event_id: eventId,
    source: "youtube",
    started_at: record.timestamp,
    ended_at: record.ended_at,
    duration_ms: record.duration_ms,
    host_video_id: record.host_video_id,
    advertiser_name: record.advertiser_name,
    advertiser_domain: record.advertiser_url,
    ad_headline: record.ad_headline,
    call_to_action: record.call_to_action,
    creative_title: record.creative_title,
    creative_duration_ms: record.creative_duration_ms,
    pod_id: podId,
    pod_label: record.pod_position,
    pod_position: record.pod_index,
    pod_size: record.pod_size,
    pod_impression_index: record.impression_index,
    skipped: record.skipped,
    skip_clicked_at: record.skip_clicked_at,
    end_reason: record.end_reason,
    advertiser_url: record.advertiser_url,
    skip_available: record.skip_available,
    muted: record.muted,
    playback_rate: record.playback_rate,
    avatar_url: record.avatar_url,
    player_version: record.player_version,
  };
}

export function createCompanionForwarder(
  options: CompanionForwarderOptions,
): (record: AdImpressionRecord) => Promise<void> {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? LOCAL_SERVER_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;
  const info = options.info ?? (() => undefined);
  const warn = options.warn ?? (() => undefined);
  let outageLogged = false;
  let missingTokenLogged = false;

  return async (record) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = await options.getToken();
      if (!token) {
        if (!missingTokenLogged) {
          info(
            `[YouTube Ad Impressions] local forwarding disabled: set ${INGEST_TOKEN_STORAGE_KEY}`,
          );
          missingTokenLogged = true;
        }
        return;
      }
      missingTokenLogged = false;
      const canonicalRecord = await toAdImpressionV1(record);
      info(
        `[YouTube Ad Impressions] forwarding impression ${canonicalRecord.event_id}`,
      );
      const response = await fetchRequest(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(canonicalRecord),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`server returned HTTP ${response.status}`);
      }
      info(
        `[YouTube Ad Impressions] forwarded impression ${canonicalRecord.event_id} (HTTP ${response.status})`,
      );
      outageLogged = false;
    } catch (error) {
      if (!outageLogged) {
        const reason = error instanceof Error ? error.message : "request failed";
        warn(`[YouTube Ad Impressions] local forwarding unavailable: ${reason}`);
        outageLogged = true;
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

// Persistence is authoritative. Delivery starts only after it succeeds and is
// intentionally detached so an offline server cannot delay or roll it back.
export async function persistThenForward<T>(
  record: AdImpressionRecord,
  persist: (record: AdImpressionRecord) => Promise<T>,
  forward: (record: AdImpressionRecord) => Promise<void>,
): Promise<T> {
  const result = await persist(record);
  void forward(record).catch(() => undefined);
  return result;
}
