import type { AdImpressionRecord } from "../types.ts";
import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { toAdImpressionV1 } from "../api/impression-mapper.ts";

// Operations the application needs from the server-backed impression store.
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
  info?: (message: string, detail?: unknown) => void;
  error?: (message: string, detail?: unknown) => void;
}): ImpressionStore {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const info = options.info ?? ((message, detail) => console.info(message, detail ?? ""));
  const error = options.error ?? ((message, detail) => console.error(message, detail ?? ""));
  async function request(path = "", init?: RequestInit): Promise<Response> {
    const method = init?.method ?? "GET";
    const url = `${options.endpoint}${path}`;
    const token = await options.getToken();
    if (!token) {
      error(`[YouTube Ad Impressions] ${method} ${url} not sent: no authenticated session`);
      throw new Error("Sign in to your account to load and save impressions.");
    }
    const startedAt = performance.now();
    info(`[YouTube Ad Impressions] API request starting: ${method} ${url}`, { tokenConfigured: true });
    try {
      const response = await fetchRequest(url, {
        ...init,
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      });
      info(`[YouTube Ad Impressions] API response: ${method} ${url} -> ${response.status} (${Math.round(performance.now() - startedAt)}ms)`);
      if (!response.ok) {
        const responseText = await response.clone().text().catch(() => "");
        error(`[YouTube Ad Impressions] API rejected request: ${method} ${url}`, responseText || `HTTP ${response.status}`);
        if (response.status === 401) {
          throw new Error("Your session was rejected (HTTP 401). Please log in again.");
        }
        throw new Error(`Server returned HTTP ${response.status}. Check the local server console.`);
      }
      return response;
    } catch (failure) {
      error(`[YouTube Ad Impressions] API request failed: ${method} ${url}`, failure);
      if (failure instanceof Error && failure.name === "TimeoutError") {
        throw new Error("The local server did not respond within 10 seconds. Check that it is running and retry.");
      }
      if (failure instanceof TypeError) {
        throw new Error("Could not connect to the local server at http://127.0.0.1:8787. Start it with npm run dev and retry.");
      }
      throw failure;
    }
  }
  return {
    addImpression: async (record) => {
      info(`[YouTube Ad Impressions] mapping impression for POST`, { eventId: record.event_id });
      const canonical: AdImpressionV1 = await toAdImpressionV1(record);
      const response = await request("", { method: "POST", body: JSON.stringify(canonical) });
      const body = await response.json() as { event_id: string };
      info(`[YouTube Ad Impressions] PostgreSQL write confirmed`, { eventId: body.event_id });
      return body.event_id;
    },
    getImpressions: async () => {
      const response = await request("?limit=100");
      const body = await response.json() as { records: ServerRow[] };
      return body.records.map(fromServer);
    },
  };
}
