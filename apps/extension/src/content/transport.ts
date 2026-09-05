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
  let runtimeUnavailableLogged = false;

  function warnRuntimeUnavailable(): void {
    if (runtimeUnavailableLogged) return;
    runtimeUnavailableLogged = true;
    warn(
      "[YouTube Ad Impressions] extension context unavailable; reload this YouTube tab after reloading the extension",
    );
  }

  function defaultSender(
    message: ExtensionMessage,
    onResponse?: (response: unknown) => void,
  ): void {
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError) {
          warnRuntimeUnavailable();
          return;
        }
        runtimeUnavailableLogged = false;
        onResponse?.(response);
      });
    } catch {
      // Reloading an unpacked extension invalidates already-running content
      // scripts; sendMessage throws before lastError can report the problem.
      warnRuntimeUnavailable();
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
    const message: ExtensionMessage = { type: "record-impression", record };
    sendExtensionMessage(message, (value) => {
      const response = value as { ok?: boolean } | undefined;
      if (!response?.ok) {
        error("[YouTube Ad Impressions] failed to save impression", response);
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
