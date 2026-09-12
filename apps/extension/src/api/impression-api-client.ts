import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { SERVER_BASE_URL } from "../config.ts";

export const LOCAL_SERVER_ENDPOINT =
  `${SERVER_BASE_URL}/api/v1/impressions`;
export const FORWARD_TIMEOUT_MS = 2_000;

type Fetch = typeof globalThis.fetch;

export interface ImpressionApiClientOptions {
  getToken: () => Promise<string | null>;
  fetch?: Fetch;
  endpoint?: string;
  timeoutMs?: number;
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export function createImpressionApiClient(
  options: ImpressionApiClientOptions,
): (canonical: AdImpressionV1) => Promise<void> {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? LOCAL_SERVER_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? FORWARD_TIMEOUT_MS;
  const info = options.info ?? (() => undefined);
  const warn = options.warn ?? (() => undefined);
  let outageLogged = false;
  let missingTokenLogged = false;

  return async (canonical) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = await options.getToken();
      if (!token) {
        if (!missingTokenLogged) {
          info(
            `[YouTube Ad Impressions] local forwarding disabled: sign in to your account`,
          );
          missingTokenLogged = true;
        }
        return;
      }
      missingTokenLogged = false;
      info(
        `[YouTube Ad Impressions] forwarding impression ${canonical.event_id}`,
      );
      const response = await fetchRequest(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(canonical),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`server returned HTTP ${response.status}`);
      }
      info(
        `[YouTube Ad Impressions] forwarded impression ${canonical.event_id} (HTTP ${response.status})`,
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
