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

export type MessageResponse = RecordImpressionResponse | DashboardResponse | WatchTimeResponse;
export type Respond = (response: MessageResponse) => void;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecordImpression(message: ExtensionMessage): message is Extract<ExtensionMessage, { type: "record-impression" }> {
  return message.type === "record-impression";
}

export function createMessageHandler(deps: MessageHandlerDeps) {
  return (message: ExtensionMessage, sendResponse: Respond): boolean => {
    if (isRecordImpression(message)) {
      void recordImpression(message.record, sendResponse);
      return true;
    }
    if (message.type === "get-dashboard") {
      void sendDashboard(sendResponse);
      return true;
    }
    if (message.type === "add-watch-time") {
      void addWatchTime(message.milliseconds, sendResponse);
      return true;
    }
    return false;
  };

  async function recordImpression(
    record: Extract<ExtensionMessage, { type: "record-impression" }>["record"],
    sendResponse: Respond,
  ): Promise<void> {
    try {
      const id = await deps.impressionStore.addImpression(record);
      sendResponse({ ok: true, id });
    } catch (error) {
      sendResponse({ ok: false, error: toErrorMessage(error) });
    }
  }

  async function sendDashboard(sendResponse: Respond): Promise<void> {
    try {
      const [records, watchTimeMs] = await Promise.all([
        deps.impressionStore.getImpressions(),
        deps.watchTimeStore.getWatchTime(),
      ]);
      const sorted = [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      sendResponse({ ok: true, records: sorted, analytics: aggregateImpressions(sorted, watchTimeMs) });
    } catch (error) {
      sendResponse({ ok: false, error: toErrorMessage(error) });
    }
  }

  async function addWatchTime(milliseconds: number, sendResponse: Respond): Promise<void> {
    try {
      await deps.watchTimeStore.addWatchTime(milliseconds);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: toErrorMessage(error) });
    }
  }
}
