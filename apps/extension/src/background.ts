// Service worker (ESM, see manifest `"type": "module"`): bootstrap only.
// Constructs the stores, API client, and message handler, then registers the
// Chrome listener. All behavior lives in the wired dependencies.
import { INGEST_TOKEN_STORAGE_KEY, LOCAL_SERVER_ENDPOINT } from "./api/impression-api-client.ts";
import { createMessageHandler } from "./message-handler.ts";
import { createServerImpressionStore } from "./storage/impression-store.ts";
import { createChromeWatchTimeStore } from "./storage/watch-time-store.ts";
import { isExtensionMessage } from "./types.ts";

async function readIngestToken(): Promise<string | null> {
  const values = await chrome.storage.local.get(INGEST_TOKEN_STORAGE_KEY);
  const token = values[INGEST_TOKEN_STORAGE_KEY];
  const configured = typeof token === "string" && token.trim().length > 0;
  console.info(`[YouTube Ad Impressions] ingest token lookup`, {
    storageKey: INGEST_TOKEN_STORAGE_KEY,
    configured,
  });
  return configured ? token.trim() : null;
}

console.info(`[YouTube Ad Impressions] service worker started`, {
  endpoint: LOCAL_SERVER_ENDPOINT,
});

const handleMessage = createMessageHandler({
  impressionStore: createServerImpressionStore({ endpoint: LOCAL_SERVER_ENDPOINT, getToken: readIngestToken }),
  watchTimeStore: createChromeWatchTimeStore(),
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isExtensionMessage(message)) {
    console.info(`[YouTube Ad Impressions] service worker received ${message.type}`, {
      eventId: message.type === "record-impression" ? message.record.event_id : undefined,
    });
    return handleMessage(message, sendResponse);
  }
  console.warn(`[YouTube Ad Impressions] service worker ignored unknown message`, message);
  return false;
});
