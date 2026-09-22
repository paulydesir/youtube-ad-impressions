import { registerAutomaticTracking } from "./auto-tracking.ts";
import { registerAdVideoIdLogger } from "./ad-video-id-logger.ts";
import { getAccessToken } from "./auth/supabase.ts";
import { IMPRESSIONS_ENDPOINT } from "./config.ts";
import { createMessageHandler } from "./message-handler.ts";
import { createServerImpressionStore } from "./storage/impression-store.ts";
import { createChromeWatchTimeStore } from "./storage/watch-time-store.ts";
import { isExtensionMessage } from "./types.ts";

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

const handleMessage = createMessageHandler({
  impressionStore: createServerImpressionStore({
    endpoint: IMPRESSIONS_ENDPOINT,
    getToken: getAccessToken,
  }),
  watchTimeStore: createChromeWatchTimeStore(),
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isExtensionMessage(message)) {
    return handleMessage(message, sendResponse);
  }
  return false;
});

registerAutomaticTracking();
registerAdVideoIdLogger();
