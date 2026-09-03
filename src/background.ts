// Service worker (ESM, see manifest `"type": "module"`): owns the IndexedDB
// `AdTrackerDB` database behind content-script and popup messages.
import { aggregateImpressions } from "./analytics.ts";
import type { ImpressionAnalytics } from "./analytics.ts";
import {
  backupWatchTimeMs,
  buildBackupFile,
  dedupeKey,
  parseBackupFile,
} from "./backup.ts";
import type { BackupFile, ImportMode, StoredImpression } from "./backup.ts";
import { WATCH_TIME_KEY } from "./backup.ts";
import type { AdImpressionRecord, ExtensionMessage } from "./types.ts";
import { isExtensionMessage } from "./types.ts";

const DB_NAME = "AdTrackerDB";
const DB_VERSION = 2;
const STORE_NAME = "impressions";
const STATS_STORE_NAME = "stats";

interface WatchTimeRow {
  key: string;
  value: number;
}

function idbError<T>(request: IDBRequest<T>): Error {
  return request.error instanceof Error
    ? request.error
    : new Error("IndexedDB request failed");
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp", "timestamp");
        store.createIndex("advertiser_url", "advertiser_url");
        store.createIndex("host_video_id", "host_video_id");
      }
      if (!database.objectStoreNames.contains(STATS_STORE_NAME)) {
        database.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(idbError(request));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = operation(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(idbError(request));
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => reject(transaction.error ?? idbError(request));
      }),
  );
}

function addImpression(record: AdImpressionRecord): Promise<IDBValidKey> {
  return withStore("readwrite", (store) => store.add(record));
}

function getImpressions(): Promise<AdImpressionRecord[]> {
  return withStore("readonly", (store) =>
    store.getAll() as IDBRequest<AdImpressionRecord[]>,
  );
}

/** Same rows but keeping the autoIncrement `id` key, for backups. */
function getStoredImpressions(): Promise<StoredImpression[]> {
  return withStore("readonly", (store) =>
    store.getAll() as IDBRequest<StoredImpression[]>,
  );
}

async function addWatchTime(milliseconds: number): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(STATS_STORE_NAME);
    const request = store.get(WATCH_TIME_KEY) as IDBRequest<WatchTimeRow | undefined>;

    request.onsuccess = () => {
      store.put({
        key: WATCH_TIME_KEY,
        value: (request.result?.value ?? 0) + milliseconds,
      });
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? idbError(request));
  });
}

async function getWatchTime(): Promise<number> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATS_STORE_NAME, "readonly");
    const request = transaction.objectStore(STATS_STORE_NAME).get(WATCH_TIME_KEY) as IDBRequest<
      WatchTimeRow | undefined
    >;
    request.onsuccess = () => resolve(request.result?.value ?? 0);
    request.onerror = () => reject(idbError(request));
    transaction.oncomplete = () => database.close();
  });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transactionError(transaction: IDBTransaction): Error {
  return transaction.error instanceof Error
    ? transaction.error
    : new Error("IndexedDB transaction failed");
}

async function exportBackup(): Promise<BackupFile> {
  const [impressions, watchTimeMs] = await Promise.all([
    getStoredImpressions(),
    getWatchTime(),
  ]);
  return buildBackupFile(impressions, watchTimeMs);
}

/** Replace mode: clear the store, then restore every row (keeping ids). */
function replaceAll(
  database: IDBDatabase,
  records: StoredImpression[],
  watchTimeMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, STATS_STORE_NAME], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transactionError(transaction));
    transaction.onabort = () => reject(transactionError(transaction));
    const impressions = transaction.objectStore(STORE_NAME);
    impressions.clear().onsuccess = () => {
      for (const record of records) impressions.put(record);
    };
    transaction
      .objectStore(STATS_STORE_NAME)
      .put({ key: WATCH_TIME_KEY, value: watchTimeMs });
  });
}

/** Merge mode: add only rows not already stored (fresh autoIncrement ids). */
function bulkAdd(database: IDBDatabase, records: AdImpressionRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transactionError(transaction));
    transaction.onabort = () => reject(transactionError(transaction));
    const store = transaction.objectStore(STORE_NAME);
    for (const record of records) store.add(record);
  });
}

async function setWatchTime(value: number): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATS_STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transactionError(transaction));
      transaction.onabort = () => reject(transactionError(transaction));
      transaction.objectStore(STATS_STORE_NAME).put({ key: WATCH_TIME_KEY, value });
    });
  } finally {
    database.close();
  }
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  totalImpressions: number;
  watchTimeMs: number;
}

async function importBackup(mode: ImportMode, data: unknown): Promise<ImportSummary> {
  const parsed = parseBackupFile(data);
  if (!parsed.ok) throw new Error(parsed.error);
  const incomingWatchTimeMs = backupWatchTimeMs(parsed.file);

  if (mode === "replace") {
    const database = await openDatabase();
    try {
      await replaceAll(database, parsed.file.impressions, incomingWatchTimeMs);
    } finally {
      database.close();
    }
    return {
      imported: parsed.file.impressions.length,
      skipped: 0,
      totalImpressions: parsed.file.impressions.length,
      watchTimeMs: incomingWatchTimeMs,
    };
  }

  const seen = new Set((await getStoredImpressions()).map(dedupeKey));
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
    const database = await openDatabase();
    try {
      await bulkAdd(database, fresh);
    } finally {
      database.close();
    }
  }
  const watchTimeMs = Math.max(await getWatchTime(), incomingWatchTimeMs);
  await setWatchTime(watchTimeMs);
  const totalImpressions = (await getStoredImpressions()).length;
  return { imported: fresh.length, skipped, totalImpressions, watchTimeMs };
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

type MessageResponse =
  | RecordImpressionResponse
  | DashboardResponse
  | WatchTimeResponse
  | ExportDataResponse
  | ImportDataResponse;

function handleMessage(
  message: ExtensionMessage,
  sendResponse: (response: MessageResponse) => void,
): boolean {
  if (message.type === "record-impression") {
    addImpression(message.record)
      .then((id) => sendResponse({ ok: true, id }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  if (message.type === "get-dashboard") {
    Promise.all([getImpressions(), getWatchTime()])
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
    addWatchTime(message.milliseconds)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  if (message.type === "export-data") {
    exportBackup()
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
    importBackup(message.mode, message.data)
      .then((summary) => sendResponse({ ok: true, ...summary }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: toErrorMessage(error) }),
      );
    return true;
  }

  return false;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isExtensionMessage(message)) return handleMessage(message, sendResponse);
  return false;
});
