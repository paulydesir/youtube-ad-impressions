// Shared IndexedDB plumbing for the `AdTrackerDB` database. Owns the schema
// (names, version, upgrades) and error normalization. Single-store CRUD lives
// in `impression-store.ts` / `watch-time-store.ts`; nothing outside `storage/`
// should import this module.

export const DB_NAME = "AdTrackerDB";
export const DB_VERSION = 3;
export const STORE_NAME = "impressions";
export const STATS_STORE_NAME = "stats";

export function idbError<T>(request: IDBRequest<T>): Error {
  return request.error instanceof Error
    ? request.error
    : new Error("IndexedDB request failed");
}

export function transactionError(transaction: IDBTransaction): Error {
  return transaction.error instanceof Error
    ? transaction.error
    : new Error("IndexedDB transaction failed");
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      let store: IDBObjectStore;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp", "timestamp");
        store.createIndex("advertiser_url", "advertiser_url");
        store.createIndex("host_video_id", "host_video_id");
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains("event_id")) {
        // Missing keys on legacy rows are not indexed. New UUIDs are unique.
        store.createIndex("event_id", "event_id", { unique: true });
      }
      if (!database.objectStoreNames.contains(STATS_STORE_NAME)) {
        database.createObjectStore(STATS_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(idbError(request));
  });
}
