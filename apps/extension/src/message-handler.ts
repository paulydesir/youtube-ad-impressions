import { aggregateImpressions } from "./analytics.ts";
import type { ImpressionAnalytics } from "./analytics.ts";
import type { ImpressionStore } from "./storage/impression-store.ts";
import type { WatchTimeStore } from "./storage/watch-time-store.ts";
import type { AdImpressionRecord, ExtensionMessage } from "./types.ts";

export interface MessageHandlerDeps {
  impressionStore: ImpressionStore;
  watchTimeStore: WatchTimeStore;
}

interface RecordImpressionResponse {
  ok: boolean;
  id?: string;
  error?: string;
}

interface DashboardResponse {
  ok: boolean;
  records?: AdImpressionRecord[];
  analytics?: ImpressionAnalytics;
  error?: string;
}

interface WatchTimeResponse {
  ok: boolean;
  error?: string;
}

export type MessageResponse =
  | RecordImpressionResponse
  | DashboardResponse
  | WatchTimeResponse;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleMessage(
  deps: MessageHandlerDeps,
  message: ExtensionMessage,
  sendResponse: (response: MessageResponse) => void,
): boolean {
  const { impressionStore, watchTimeStore } = deps;

  if (message.type === "record-impression") {
    impressionStore.addImpression(message.record)
      .then((id) => {
        sendResponse({ ok: true, id });
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "get-dashboard") {
    Promise.all([
      impressionStore.getImpressions(),
      watchTimeStore.getWatchTime(),
    ])
      .then(([records, watchTimeMs]) =>
        sendResponse({
          ok: true,
          records: records.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
          analytics: aggregateImpressions(records, watchTimeMs),
        }),
      )
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  if (message.type === "add-watch-time") {
    watchTimeStore
      .addWatchTime(message.milliseconds)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  return false;
}

export function createMessageHandler(
  deps: MessageHandlerDeps,
): (
  message: ExtensionMessage,
  sendResponse: (response: MessageResponse) => void,
) => boolean {
  return (message, sendResponse) => handleMessage(deps, message, sendResponse);
}
