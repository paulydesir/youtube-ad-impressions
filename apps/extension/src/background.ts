import { registerAutomaticTracking } from "./auto-tracking.ts";
import { LOCAL_SERVER_ENDPOINT } from "./api/impression-api-client.ts";
import { createMessageHandler } from "./message-handler.ts";
import { createServerImpressionStore } from "./storage/impression-store.ts";
import { createChromeWatchTimeStore } from "./storage/watch-time-store.ts";
import { isExtensionMessage } from "./types.ts";

import { getAccessToken } from "./auth/supabase.ts";

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
void chrome.storage.local.remove("localServerIngestToken");

console.info(`[YouTube Ad Impressions] service worker started`, {
  endpoint: LOCAL_SERVER_ENDPOINT,
});

const handleMessage = createMessageHandler({
  impressionStore: createServerImpressionStore({ endpoint: LOCAL_SERVER_ENDPOINT, getToken: getAccessToken }),
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

registerAutomaticTracking();
