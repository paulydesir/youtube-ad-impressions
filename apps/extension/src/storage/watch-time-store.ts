import { WATCH_TIME_KEY } from "../backup.ts";
import {
  STATS_STORE_NAME,
  idbError,
  openDatabase,
  transactionError,
} from "./database.ts";

interface WatchTimeRow {
  key: string;
  value: number;
}

// Operations the application needs on the watch-time stats row.
export interface WatchTimeStore {
  addWatchTime(milliseconds: number): Promise<void>;
  getWatchTime(): Promise<number>;
  setWatchTime(value: number): Promise<void>;
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

export function createIndexedDbWatchTimeStore(): WatchTimeStore {
  return { addWatchTime, getWatchTime, setWatchTime };
}
