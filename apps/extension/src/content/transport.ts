// Sends completed impressions to the background service worker and emits
// page-context diagnostics. Knows about extension messaging; knows nothing
// about YouTube markup.
import type {
  ExtensionMessage,
  IdentifiedAdImpressionRecord,
} from "../types.ts";

export const CONTENT_EVENT_NAME = "youtube-ad-impression-transition";

export interface ChromeMessageSender {
  (
    message: ExtensionMessage,
    onResponse?: (response: unknown) => void,
  ): void;
}

export interface ContentTransportOptions {
  sender?: ChromeMessageSender;
  onInvalidated?: () => void;
  eventName?: string;
  hostVideoId?: () => string | null;
  warn?: (message: string) => void;
  error?: (message: string, detail?: unknown) => void;
  info?: (message: string, detail?: unknown) => void;
  now?: () => string;
}

export interface ContentTransport {
  readonly eventName: string;
  sendExtensionMessage(
    message: ExtensionMessage,
    onResponse?: (response: unknown) => void,
  ): void;
  /** Emit a page-context CustomEvent plus a console line, like legacy code. */
  publish(type: string, detail: Record<string, unknown>): void;
  sendRecordImpression(record: IdentifiedAdImpressionRecord): void;
  sendWatchTime(milliseconds: number): void;
}

export function createContentTransport(
  options: ContentTransportOptions = {},
): ContentTransport {
  const {
    sender,
    eventName = CONTENT_EVENT_NAME,
    hostVideoId = () => new URL(location.href).searchParams.get("v"),
    warn = (message) => console.warn(message),
    error = (message, detail) => console.error(message, detail),
    info = (message, detail) => console.info(message, detail),
    now = () => new Date().toISOString(),
  } = options;
  let invalidated = false;
  let runtimeUnavailableLogged = false;

  function invalidate(): void {
    if (invalidated) return;
    invalidated = true;
    info("[YouTube Ad Impressions] extension reloaded; refresh this YouTube tab to resume tracking");
    options.onInvalidated?.();
  }

  function handleFailure(detail: unknown): void {
    const message = detail instanceof Error ? detail.message : String(detail);
    if (!globalThis.chrome?.runtime?.id || /extension context invalidated/i.test(message)) {
      invalidate();
    } else {
      warnRuntimeUnavailable();
    }
  }

  function warnRuntimeUnavailable(): void {
    if (runtimeUnavailableLogged) return;
    runtimeUnavailableLogged = true;
    warn(
      "[YouTube Ad Impressions] could not contact the background worker; will retry on the next message",
    );
  }

  function defaultSender(
    message: ExtensionMessage,
    onResponse?: (response: unknown) => void,
  ): void {
    if (invalidated) return;
    try {
      if (!globalThis.chrome?.runtime?.id) {
        invalidate();
        return;
      }
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError) {
          handleFailure(chrome.runtime.lastError.message);
          return;
        }
        runtimeUnavailableLogged = false;
        onResponse?.(response);
      });
    } catch (failure) {
      // Reloading an unpacked extension invalidates already-running content
      // scripts; sendMessage throws before lastError can report the problem.
      handleFailure(failure);
    }
  }

  const send = sender ?? defaultSender;

  function sendExtensionMessage(
    message: ExtensionMessage,
    onResponse?: (response: unknown) => void,
  ): void {
    send(message, onResponse);
  }

  function publish(type: string, detail: Record<string, unknown>): void {
    const payload = {
      type,
      hostVideoId: hostVideoId(),
      observedAt: now(),
      ...detail,
    };

    document.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    info("[YouTube Ad Impressions]", payload);
  }

  function sendRecordImpression(record: IdentifiedAdImpressionRecord): void {
    info("[YouTube Ad Impressions] sending impression to service worker", {
      eventId: record.event_id,
      advertiser: record.advertiser_name ?? record.advertiser_url,
    });
    const message: ExtensionMessage = { type: "record-impression", record };
    sendExtensionMessage(message, (value) => {
      const response = value as { ok?: boolean; id?: string; error?: string } | undefined;
      if (!response?.ok) {
        error("[YouTube Ad Impressions] failed to save impression", response);
      } else {
        info("[YouTube Ad Impressions] service worker confirmed impression", {
          eventId: record.event_id,
          storedId: response.id,
        });
      }
    });
  }

  function sendWatchTime(milliseconds: number): void {
    const message: ExtensionMessage = { type: "add-watch-time", milliseconds };
    sendExtensionMessage(message);
  }

  return {
    eventName,
    sendExtensionMessage,
    publish,
    sendRecordImpression,
    sendWatchTime,
  };
}
