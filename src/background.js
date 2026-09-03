importScripts("analytics.js");

const DB_NAME = "AdTrackerDB";
const DB_VERSION = 3;
const STORE_NAME = "impressions";
const STATS_STORE_NAME = "stats";
const WATCH_TIME_KEY = "watch_time_ms";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      let store;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      } else {
        store = request.transaction.objectStore(STORE_NAME);
      }

      for (const legacyIndex of ["timestamp", "advertiser_url"]) {
        if (store.indexNames.contains(legacyIndex)) store.deleteIndex(legacyIndex);
      }

      const indexes = [
        ["event_id", "event_id", { unique: true }],
        ["started_at", "started_at"],
        ["advertiser_domain", "advertiser_domain"],
        ["host_video_id", "host_video_id"],
      ];
      for (const [name, keyPath, options] of indexes) {
        if (!store.indexNames.contains(name)) {
          store.createIndex(name, keyPath, options);
        }
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
          records: records.sort((a, b) =>
            (b.started_at || b.timestamp || "").localeCompare(
              a.started_at || a.timestamp || "",
            ),
          ),
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
