import type { AdImpressionRecord } from "../types.ts";
import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { toAdImpressionV1 } from "../api/impression-mapper.ts";

export interface ImpressionStore {
  addImpression(record: AdImpressionRecord): Promise<string>;
  getImpressions(): Promise<AdImpressionRecord[]>;
}

type Fetch = typeof globalThis.fetch;
type ServerRow = Record<string, unknown>;

function fromServer(row: ServerRow): AdImpressionRecord {
  return {
    event_id: String(row.eventId), pod_id: String(row.podId ?? ""),
    advertiser_name: row.advertiserName as string | null,
    advertiser_url: row.advertiserDomain as string | null,
    host_video_id: row.hostVideoId as string | null,
    timestamp: String(row.startedAt), ended_at: String(row.endedAt ?? row.startedAt),
    duration_ms: row.durationMs as number | null,
    pod_position: row.podLabel as string | null,
    pod_index: row.podPosition as number | null, pod_size: row.podSize as number | null,
    impression_index: Number(row.podImpressionIndex ?? 0), skipped: Boolean(row.skipped),
    skip_clicked_at: row.skipClickedAt as string | null, skip_available: false,
    ad_headline: row.adHeadline as string | null, call_to_action: row.callToAction as string | null,
    creative_title: row.creativeTitle as string | null,
    creative_duration_ms: row.creativeDurationMs as number | null,
    muted: null, playback_rate: null, avatar_url: null, player_version: null,
    end_reason: String(row.endReason ?? "unknown"),
  };
}

export function createServerImpressionStore(options: {
  endpoint: string;
  getToken: () => Promise<string | null>;
  fetch?: Fetch;
  timeoutMs?: number;
  info?: (message: string, detail?: unknown) => void;
  error?: (message: string, detail?: unknown) => void;
}): ImpressionStore {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const error = options.error ?? ((message, detail) => console.error(message, detail ?? ""));
  // Stay below Chrome's 30-second service-worker fetch response limit.
  const timeoutMs = options.timeoutMs ?? 25_000;
  async function request<T>(path = "", init?: RequestInit): Promise<T> {
    const method = init?.method ?? "GET";
    const url = `${options.endpoint}${path}`;
    const token = await options.getToken();
    if (!token) {
      error(`[YouTube Ad Impressions] ${method} ${url} not sent: no authenticated session`);
      throw new Error("Sign in to your account to load and save impressions.");
    }
    const startedAt = performance.now();
    // Retry once with the same serialized body/event ID. A timed-out POST may
    // already have committed; the server treats that event ID as a duplicate.
    for (let attempt = 0; ; attempt += 1) {
      let retryable = false;
      try {
        const response = await fetchRequest(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
        });
        if (!response.ok) {
          retryable = [502, 503, 504].includes(response.status);
          if (response.status === 401) {
            throw new Error("Your session was rejected (HTTP 401). Please log in again.");
          }
          throw new Error(`Server returned HTTP ${response.status} ${response.statusText}.`);
        }
        // Keep body reads inside the timeout/error handling too.
        return await response.json() as T;
      } catch (failure) {
        const name = failure && typeof failure === "object" && "name" in failure ? String(failure.name) : "Error";
        if (attempt === 0 && (retryable || name === "TimeoutError" || name === "TypeError")) continue;
        const detail = failure && typeof failure === "object" && "message" in failure ? String(failure.message) : String(failure);
        const origin = new URL(options.endpoint).origin;
        const message = name === "TimeoutError"
          ? `The server at ${origin} did not respond within ${timeoutMs / 1000} seconds. It may be starting up; retry shortly.`
          : name === "TypeError"
            ? `Could not connect to the server at ${origin}: ${detail}`
            : `${name}: ${detail}`;
        error(`[YouTube Ad Impressions] ${method} ${url} failed after ${Math.round(performance.now() - startedAt)}ms: ${message}`);
        throw new Error(message, { cause: failure });
      }
    }
  }
  return {
    addImpression: async (record) => {
      const canonical: AdImpressionV1 = await toAdImpressionV1(record);
      const body = await request<{ event_id: string }>("", { method: "POST", body: JSON.stringify(canonical) });
      return body.event_id;
    },
    getImpressions: async () => {
      const records: AdImpressionRecord[] = [];
      let cursor: string | null = null;
      const visited = new Set<string>();
      do {
        const path: string = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const body = await request<{ records: ServerRow[]; nextCursor?: string | null }>(path);
        // Older servers silently truncate history. Do not display that page as
        // a lifetime total while the API update is waiting to be deployed.
        if (body.nextCursor === undefined && body.records.length >= 100) {
          throw new Error("The server needs the history pagination update to load more than 100 impressions.");
        }
        records.push(...body.records.map(fromServer));
        cursor = body.nextCursor ?? null;
        if (cursor) {
          if (visited.has(cursor)) throw new Error("The server returned a repeated history cursor.");
          visited.add(cursor);
        }
      } while (cursor);
      return records;
    },
  };
}
