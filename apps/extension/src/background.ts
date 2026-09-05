// Service worker (ESM, see manifest `"type": "module"`): bootstrap only.
// Constructs the stores, API client, and message handler, then registers the
// Chrome listener. All behavior lives in the wired dependencies.
import { createImpressionApiClient } from "./api/impression-api-client.ts";
import { INGEST_TOKEN_STORAGE_KEY } from "./api/impression-api-client.ts";
import { toAdImpressionV1 } from "./api/impression-mapper.ts";
import { createMessageHandler } from "./message-handler.ts";
import { createIndexedDbImpressionStore } from "./storage/impression-store.ts";
import { createIndexedDbWatchTimeStore } from "./storage/watch-time-store.ts";
import type { AdImpressionRecord } from "./types.ts";
import { isExtensionMessage } from "./types.ts";

async function readIngestToken(): Promise<string | null> {
  const values = await chrome.storage.local.get(INGEST_TOKEN_STORAGE_KEY);
  const token = values[INGEST_TOKEN_STORAGE_KEY];
  return typeof token === "string" && token.length > 0 ? token : null;
}

const sendToLocalServer = createImpressionApiClient({
  getToken: readIngestToken,
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
});

// Map to the shared contract, then deliver best-effort. A mapping failure
// rejects here and is swallowed by persistThenForward's detached forward —
// previously it surfaced as one forwarding diagnostic; digest failures do
// not occur in practice, so the composition stays inline.
function forwardToLocalServer(record: AdImpressionRecord): Promise<void> {
  return toAdImpressionV1(record).then((canonical) =>
    sendToLocalServer(canonical),
  );
}

const handleMessage = createMessageHandler({
  impressionStore: createIndexedDbImpressionStore(),
  watchTimeStore: createIndexedDbWatchTimeStore(),
  forwardRecord: forwardToLocalServer,
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isExtensionMessage(message)) return handleMessage(message, sendResponse);
  return false;
});
