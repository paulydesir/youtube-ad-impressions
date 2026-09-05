// Chrome message routing for the service worker. Delegates to the injected
// stores and forwarder; knows nothing about IndexedDB, HTTP, or record
// mapping. Testable with in-memory fakes — no service worker required.
import { aggregateImpressions } from "./analytics.ts";
import type { ImpressionAnalytics } from "./analytics.ts";
import {
  backupWatchTimeMs,
  buildBackupFile,
  dedupeKey,
  parseBackupFile,
} from "./backup.ts";
import type { BackupFile, ImportMode } from "./backup.ts";
import type { ImpressionStore } from "./storage/impression-store.ts";
import type { WatchTimeStore } from "./storage/watch-time-store.ts";
import type { AdImpressionRecord, ExtensionMessage } from "./types.ts";

export interface MessageHandlerDeps {
  impressionStore: ImpressionStore;
  watchTimeStore: WatchTimeStore;
  /** Best-effort server delivery; failures are quiet by contract. */
  forwardRecord: (record: AdImpressionRecord) => Promise<void>;
}

interface RecordImpressionResponse {
  ok: boolean;
  id?: IDBValidKey;
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

interface ExportDataResponse {
  ok: boolean;
  backup?: BackupFile;
  error?: string;
}

interface ImportDataResponse {
  ok: boolean;
  imported?: number;
  skipped?: number;
  totalImpressions?: number;
  watchTimeMs?: number;
  error?: string;
}

export type MessageResponse =
  | RecordImpressionResponse
  | DashboardResponse
  | WatchTimeResponse
  | ExportDataResponse
  | ImportDataResponse;

export interface ImportSummary {
  imported: number;
  skipped: number;
  totalImpressions: number;
  watchTimeMs: number;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function exportBackup(
  impressionStore: ImpressionStore,
  watchTimeStore: WatchTimeStore,
): Promise<BackupFile> {
  const [impressions, watchTimeMs] = await Promise.all([
    impressionStore.getStoredImpressions(),
    watchTimeStore.getWatchTime(),
  ]);
  return buildBackupFile(impressions, watchTimeMs);
}

async function importBackup(
  impressionStore: ImpressionStore,
  watchTimeStore: WatchTimeStore,
  mode: ImportMode,
  data: unknown,
): Promise<ImportSummary> {
  const parsed = parseBackupFile(data);
  if (!parsed.ok) throw new Error(parsed.error);
  const incomingWatchTimeMs = backupWatchTimeMs(parsed.file);

  if (mode === "replace") {
    await impressionStore.replaceAll(
      parsed.file.impressions,
      incomingWatchTimeMs,
    );
    return {
      imported: parsed.file.impressions.length,
      skipped: 0,
      totalImpressions: parsed.file.impressions.length,
      watchTimeMs: incomingWatchTimeMs,
    };
  }

  const seen = new Set(
    (await impressionStore.getStoredImpressions()).map(dedupeKey),
  );
  const fresh: AdImpressionRecord[] = [];
  let skipped = 0;
  for (const record of parsed.file.impressions) {
    const key = dedupeKey(record);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    const { id: _dropped, ...rest } = record;
    fresh.push(rest);
  }

  if (fresh.length) {
    await impressionStore.bulkAdd(fresh);
  }
  const watchTimeMs = Math.max(
    await watchTimeStore.getWatchTime(),
    incomingWatchTimeMs,
  );
  await watchTimeStore.setWatchTime(watchTimeMs);
  const totalImpressions = (await impressionStore.getStoredImpressions()).length;
  return { imported: fresh.length, skipped, totalImpressions, watchTimeMs };
}

function handleMessage(
  deps: MessageHandlerDeps,
  message: ExtensionMessage,
  sendResponse: (response: MessageResponse) => void,
): boolean {
  const { impressionStore, watchTimeStore, forwardRecord } = deps;

  if (message.type === "record-impression") {
    persistThenForward(
      message.record,
      (record) => impressionStore.addImpression(record),
      forwardRecord,
    )
      .then((id) => {
        console.info(
          `[YouTube Ad Impressions] stored impression ${message.record.event_id} in IndexedDB`,
        );
        sendResponse({ ok: true, id });
      })
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
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

  if (message.type === "export-data") {
    exportBackup(impressionStore, watchTimeStore)
      .then((backup) => sendResponse({ ok: true, backup }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  if (message.type === "import-data") {
    if (message.mode !== "merge" && message.mode !== "replace") {
      sendResponse({ ok: false, error: 'Import mode must be "merge" or "replace".' });
      return false;
    }
    importBackup(impressionStore, watchTimeStore, message.mode, message.data)
      .then((summary) => sendResponse({ ok: true, ...summary }))
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
