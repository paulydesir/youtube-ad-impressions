import type { ExtensionMessage, IdentifiedAdImpressionRecord } from "../types.ts";

export const CONTENT_EVENT_NAME = "youtube-ad-impression-transition";

export interface ChromeMessageSender {
  (message: ExtensionMessage, onResponse?: (response: unknown) => void): void;
}

interface FailureCallbacks {
  onInvalidated?: () => void;
  warn?: (message: string) => void;
  error?: (message: string, detail?: unknown) => void;
  info?: (message: string, detail?: unknown) => void;
}

export interface ContentTransportOptions extends FailureCallbacks {
  sender?: ChromeMessageSender;
  eventName?: string;
  hostVideoId?: () => string | null;
  now?: () => string;
}

export interface ContentTransport {
  readonly eventName: string;
  sendExtensionMessage(message: ExtensionMessage, onResponse?: (response: unknown) => void): void;
  publish(type: string, detail: Record<string, unknown>): void;
  sendRecordImpression(record: IdentifiedAdImpressionRecord): void;
  sendWatchTime(milliseconds: number): void;
}

function isInvalidatedContext(message: string): boolean {
  return message.toLowerCase().includes("extension context invalidated");
}

function toMessage(failure: unknown): string {
  if (failure instanceof Error) {
    return failure.message;
  }
  return String(failure);
}

export function createContentTransport(options: ContentTransportOptions = {}): ContentTransport {
  const eventName = options.eventName ?? CONTENT_EVENT_NAME;
  const getHostVideoId = options.hostVideoId ?? defaultHostVideoId;
  const now = options.now ?? (() => new Date().toISOString());
  const warn = options.warn ?? noop;
  const reportError = options.error ?? noop;
  const info = options.info ?? noop;

  let invalidated = false;
  let runtimeUnavailableLogged = false;

  function defaultHostVideoId(): string | null {
    return new URL(location.href).searchParams.get("v");
  }

  function invalidate(): void {
    if (invalidated) {
      return;
    }
    invalidated = true;
    info("[YouTube Ad Impressions] extension reloaded; refresh this YouTube tab to resume tracking");
    options.onInvalidated?.();
  }

  function warnRuntimeUnavailable(): void {
    if (runtimeUnavailableLogged) {
      return;
    }
    runtimeUnavailableLogged = true;
    warn("[YouTube Ad Impressions] could not contact the background worker; will retry on the next message");
  }

  function handleFailure(failure: unknown): void {
    const runtimeAlive = Boolean(globalThis.chrome?.runtime?.id);
    if (!runtimeAlive || isInvalidatedContext(toMessage(failure))) {
      invalidate();
      return;
    }
    warnRuntimeUnavailable();
  }

  function defaultSender(message: ExtensionMessage, onResponse?: (response: unknown) => void): void {
    if (invalidated) {
      return;
    }
    if (!globalThis.chrome?.runtime?.id) {
      invalidate();
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response: unknown) => {
        if (chrome.runtime.lastError) {
          handleFailure(chrome.runtime.lastError.message);
          return;
        }
        runtimeUnavailableLogged = false;
        onResponse?.(response);
      });
    } catch (failure) {
      handleFailure(failure);
    }
  }

  const send = options.sender ?? defaultSender;

  function sendExtensionMessage(message: ExtensionMessage, onResponse?: (response: unknown) => void): void {
    send(message, onResponse);
  }

  function publish(type: string, detail: Record<string, unknown>): void {
    const payload = {
      type,
      hostVideoId: getHostVideoId(),
      observedAt: now(),
      ...detail,
    };
    document.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }

  function sendRecordImpression(record: IdentifiedAdImpressionRecord): void {
    const message: ExtensionMessage = { type: "record-impression", record };
    sendExtensionMessage(message, (value) => {
      const response = value as { ok?: boolean; error?: string } | undefined;
      if (response?.ok !== true) {
        const reason = response?.error ?? "No response from service worker";
        reportError(`[YouTube Ad Impressions] failed to save impression ${record.event_id}: ${reason}`);
      }
    });
  }

  function sendWatchTime(milliseconds: number): void {
    sendExtensionMessage({ type: "add-watch-time", milliseconds });
  }

  return { eventName, sendExtensionMessage, publish, sendRecordImpression, sendWatchTime };
}

function noop(): void {
  // Quiet by default; callers opt into logging via callbacks.
}
