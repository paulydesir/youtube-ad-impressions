import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { toAdImpressionV1 } from "../api/impression-mapper.ts";
import type { AdImpressionRecord } from "../types.ts";

export interface ImpressionStore {
  addImpression(record: AdImpressionRecord): Promise<string>;
  getImpressions(): Promise<AdImpressionRecord[]>;
}

type FetchFn = typeof globalThis.fetch;
type ServerRow = Record<string, unknown>;

interface HistoryPage {
  records: ServerRow[];
  nextCursor?: string | null;
}

interface ServerImpressionStoreOptions {
  endpoint: string;
  getToken: () => Promise<string | null>;
  fetch?: FetchFn;
  timeoutMs?: number;
  onError?: (message: string) => void;
  error?: (message: string, detail?: unknown) => void;
  info?: (message: string, detail?: unknown) => void;
}

// Stay below Chrome's 30-second service-worker fetch response limit.
const DEFAULT_TIMEOUT_MS = 25_000;
const PAGE_SIZE = 100;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function toRecord(row: ServerRow): AdImpressionRecord {
  return {
    event_id: String(row.eventId),
    pod_id: String(row.podId ?? ""),
    advertiser_name: (row.advertiserName as string | null) ?? null,
    advertiser_url: (row.advertiserDomain as string | null) ?? null,
    host_video_id: (row.hostVideoId as string | null) ?? null,
    timestamp: String(row.startedAt),
    ended_at: String(row.endedAt ?? row.startedAt),
    duration_ms: (row.durationMs as number | null) ?? null,
    pod_position: (row.podLabel as string | null) ?? null,
    pod_index: (row.podPosition as number | null) ?? null,
    pod_size: (row.podSize as number | null) ?? null,
    impression_index: Number(row.podImpressionIndex ?? 0),
    skipped: Boolean(row.skipped),
    skip_clicked_at: (row.skipClickedAt as string | null) ?? null,
    skip_available: false,
    ad_headline: (row.adHeadline as string | null) ?? null,
    call_to_action: (row.callToAction as string | null) ?? null,
    creative_title: (row.creativeTitle as string | null) ?? null,
    creative_duration_ms: (row.creativeDurationMs as number | null) ?? null,
    muted: null,
    playback_rate: null,
    avatar_url: null,
    player_version: null,
    end_reason: String(row.endReason ?? "unknown"),
  };
}

function failureName(failure: unknown): string {
  if (typeof failure === "object" && failure !== null && "name" in failure) {
    return String(failure.name);
  }
  return "Error";
}

function failureMessage(failure: unknown): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  return String(failure);
}

function isTimeout(failure: unknown): boolean {
  return failureName(failure) === "TimeoutError";
}

function isConnectionFailure(failure: unknown): boolean {
  return failureName(failure) === "TypeError";
}

function isRetryableNetworkFailure(failure: unknown): boolean {
  return isTimeout(failure) || isConnectionFailure(failure);
}

function isStatusError(failure: unknown): boolean {
  const message = failureMessage(failure);
  return message.includes("session was rejected") || message.startsWith("Server returned HTTP");
}

function toUserMessage(endpoint: string, timeoutMs: number, failure: unknown): string {
  const origin = new URL(endpoint).origin;
  const detail = failureMessage(failure);

  if (isTimeout(failure)) {
    return `The server at ${origin} did not respond within ${timeoutMs / 1000} seconds. It may be starting up; retry shortly.`;
  }
  if (isConnectionFailure(failure)) {
    return `Could not connect to the server at ${origin}: ${detail}`;
  }
  return `${failureName(failure)}: ${detail}`;
}

export function createServerImpressionStore(options: ServerImpressionStoreOptions): ImpressionStore {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function reportError(message: string): void {
    options.onError?.(message);
    options.error?.(message);
  }

  function fail(method: string, url: string, failure: unknown): never {
    const message = toUserMessage(options.endpoint, timeoutMs, failure);
    reportError(`[YouTube Ad Impressions] ${method} ${url} failed: ${message}`);
    throw new Error(message, { cause: failure });
  }

  function requireOk(response: Response): void {
    if (response.status === 401) {
      throw new Error("Your session was rejected (HTTP 401). Please log in again.");
    }
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status} ${response.statusText}.`);
    }
  }

  // A timed-out POST may already have committed server-side, so network
  // failures retry once with the same serialized body. The server dedupes
  // by event ID. Only the final failure is reported.
  async function request<T>(method: string, path: string, init?: RequestInit): Promise<T> {
    const url = `${options.endpoint}${path}`;
    const token = await options.getToken();
    if (token === null || token === "") {
      throw new Error("Sign in to your account to load and save impressions.");
    }

    async function attempt(): Promise<Response> {
      return fetchRequest(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
    }

    let response = await tryAttempt(attempt, method, url, true);

    if (RETRYABLE_STATUSES.has(response.status)) {
      response = await tryAttempt(attempt, method, url, false);
    }

    return readWithOneRetry<T>(method, url, response, attempt);
  }

  async function tryAttempt(
    attempt: () => Promise<Response>,
    method: string,
    url: string,
    allowRetry: boolean,
  ): Promise<Response> {
    try {
      return await attempt();
    } catch (failure) {
      if (allowRetry && isRetryableNetworkFailure(failure)) {
        try {
          return await attempt();
        } catch (retryFailure) {
          fail(method, url, retryFailure);
        }
      }
      fail(method, url, failure);
    }
  }

  async function readWithOneRetry<T>(
    method: string,
    url: string,
    response: Response,
    attempt: () => Promise<Response>,
  ): Promise<T> {
    try {
      requireOk(response);
      return (await response.json()) as T;
    } catch (failure) {
      if (isStatusError(failure)) {
        throw failure;
      }
      if (!isRetryableNetworkFailure(failure)) {
        fail(method, url, failure);
      }
      const retryResponse = await tryAttempt(attempt, method, url, false);
      try {
        requireOk(retryResponse);
        return (await retryResponse.json()) as T;
      } catch (retryFailure) {
        if (isStatusError(retryFailure)) {
          throw retryFailure;
        }
        fail(method, url, retryFailure);
      }
    }
  }

  async function addImpression(record: AdImpressionRecord): Promise<string> {
    const canonical: AdImpressionV1 = await toAdImpressionV1(record);
    const body = await request<{ event_id: string }>("POST", "", {
      method: "POST",
      body: JSON.stringify(canonical),
    });
    return body.event_id;
  }

  async function getImpressions(): Promise<AdImpressionRecord[]> {
    const records: AdImpressionRecord[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (true) {
      let path = `?limit=${PAGE_SIZE}`;
      if (cursor !== null) {
        path += `&cursor=${encodeURIComponent(cursor)}`;
      }
      const page = await request<HistoryPage>("GET", path);

      if (page.nextCursor === undefined && page.records.length >= PAGE_SIZE) {
        throw new Error("The server needs the history pagination update to load more than 100 impressions.");
      }

      for (const row of page.records) {
        records.push(toRecord(row));
      }

      if (page.nextCursor === undefined || page.nextCursor === null) {
        return records;
      }
      if (seenCursors.has(page.nextCursor)) {
        throw new Error("The server returned a repeated history cursor.");
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  return { addImpression, getImpressions };
}
