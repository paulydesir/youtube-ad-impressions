import { WATCH_TIME_KEY } from "../backup.ts";
import type { StoredImpression } from "../backup.ts";
import type { AdImpressionRecord } from "../types.ts";
import {
  STATS_STORE_NAME,
  STORE_NAME,
  idbError,
  openDatabase,
  transactionError,
} from "./database.ts";

// Operations the application needs on the impressions object store.
// Callers deal only in records and promises — never IDB types.
export interface ImpressionStore {
  addImpression(record: AdImpressionRecord): Promise<IDBValidKey>;
  getImpressions(): Promise<AdImpressionRecord[]>;
  /** Stored rows include the local key, which backup serialization strips. */
  getStoredImpressions(): Promise<StoredImpression[]>;
  /** Merge-mode import: add only rows not already stored. */
  bulkAdd(records: AdImpressionRecord[]): Promise<void>;
  /**
   * Replace-mode import: clear the store, restore every portable row, and set
   * the watch-time row. One cross-store transaction so a failure cannot leave
   * a half-replaced database; the watch-time write piggybacks here because
   * the backup envelope carries both.
   */
  replaceAll(records: StoredImpression[], watchTimeMs: number): Promise<void>;
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

async function addImpression(record: AdImpressionRecord): Promise<IDBValidKey> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).add(record);
    let key!: IDBValidKey;

    request.onsuccess = () => {
      key = request.result;
    };
    request.onerror = () => reject(idbError(request));
    transaction.oncomplete = () => {
      database.close();
      resolve(key);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? idbError(request));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? idbError(request));
    };
  });
}

function getImpressions(): Promise<AdImpressionRecord[]> {
  return withStore("readonly", (store) =>
    store.getAll() as IDBRequest<AdImpressionRecord[]>,
  );
}

/** Stored rows include the local key, which backup serialization strips. */
function getStoredImpressions(): Promise<StoredImpression[]> {
  return withStore("readonly", (store) =>
    store.getAll() as IDBRequest<StoredImpression[]>,
  );
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

/** Replace mode: clear the store, then restore every portable row. */
function replaceAll(
  database: IDBDatabase,
  records: StoredImpression[],
  watchTimeMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [STORE_NAME, STATS_STORE_NAME],
      "readwrite",
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transactionError(transaction));
    transaction.onabort = () => reject(transactionError(transaction));
    const impressions = transaction.objectStore(STORE_NAME);
    impressions.clear().onsuccess = () => {
      for (const { id: _localId, ...record } of records) impressions.put(record);
    };
    transaction
      .objectStore(STATS_STORE_NAME)
      .put({ key: WATCH_TIME_KEY, value: watchTimeMs });
  });
}

export function createIndexedDbImpressionStore(): ImpressionStore {
  return {
    addImpression,
    getImpressions,
    getStoredImpressions,
    bulkAdd: async (records) => {
      const database = await openDatabase();
      try {
        await bulkAdd(database, records);
      } finally {
        database.close();
      }
    },
    replaceAll: async (records, watchTimeMs) => {
      const database = await openDatabase();
      try {
        await replaceAll(database, records, watchTimeMs);
      } finally {
        database.close();
      }
    },
  };
}
