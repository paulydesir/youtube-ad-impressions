importScripts("analytics.js");

const DB_NAME = "AdTrackerDB";
const DB_VERSION = 2;
const STORE_NAME = "impressions";
const STATS_STORE_NAME = "stats";
const WATCH_TIME_KEY = "watch_time_ms";

function openDatabase() {
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
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

function addImpression(record) {
  return withStore("readwrite", (store) => store.add(record));
}

function getImpressions() {
  return withStore("readonly", (store) => store.getAll());
}

async function addWatchTime(milliseconds) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(STATS_STORE_NAME);
    const request = store.get(WATCH_TIME_KEY);

    request.onsuccess = () => {
      store.put({
        key: WATCH_TIME_KEY,
        value: (request.result?.value || 0) + milliseconds,
      });
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getWatchTime() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATS_STORE_NAME, "readonly");
    const request = transaction.objectStore(STATS_STORE_NAME).get(WATCH_TIME_KEY);
    request.onsuccess = () => resolve(request.result?.value || 0);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "record-impression") {
    addImpression(message.record)
      .then((id) => sendResponse({ ok: true, id }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "get-dashboard") {
    Promise.all([getImpressions(), getWatchTime()])
      .then(([records, watchTimeMs]) =>
        sendResponse({
          ok: true,
          records: records.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
          analytics: globalThis.YouTubeAdAnalytics.aggregateImpressions(
            records,
            watchTimeMs,
          ),
        }),
      )
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "add-watch-time") {
    addWatchTime(message.milliseconds)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
