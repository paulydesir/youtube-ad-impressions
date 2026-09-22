import { hostVideoId } from "./content/extract.ts";
import { buildImpressionRecord, ImpressionMetadataStore } from "./content/impression-builder.ts";
import { observeYouTubeAds } from "./content/observer.ts";
import { createContentTransport } from "./content/transport.ts";
import { createWatchTimeTracker } from "./content/watch-time.ts";

interface WatcherDiagnostic {
  status: string;
  eventName: string;
  active: boolean;
  error?: string;
  refresh?: () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __youtubeAdImpressionWatcher: WatcherDiagnostic | undefined;
}

function isAdVideoIdMessage(message: unknown): message is { type: "ad-video-id"; adVideoId: string } {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; adVideoId?: unknown };
  return candidate.type === "ad-video-id" && typeof candidate.adVideoId === "string" && candidate.adVideoId !== "";
}

function startTracking(): void {
  // Popup recovery and manifest injection may race; keep one observer per tab.
  if (globalThis.__youtubeAdImpressionWatcher?.status === "ready") {
    return;
  }

  const diagnostic: WatcherDiagnostic = { status: "starting", eventName: "", active: false };
  const impressionMetadata = new ImpressionMetadataStore();

  let watchTimer = 0;
  let observer!: ReturnType<typeof observeYouTubeAds>;

  function onPageHide(): void {
    window.clearInterval(watchTimer);
    watchTime.flush();
    observer.destroy("pagehide");
    chrome.runtime.onMessage.removeListener(onAdVideoIdMessage);
    diagnostic.status = "stopped";
    window.removeEventListener("pagehide", onPageHide);
  }

  function onAdVideoIdMessage(message: unknown): void {
    if (isAdVideoIdMessage(message)) {
      observer.captureAdVideoId(message.adVideoId);
    }
  }

  function handleInvalidated(): void {
    window.clearInterval(watchTimer);
    window.removeEventListener("pagehide", onPageHide);
    observer.destroy("extension-invalidated");
    impressionMetadata.clear();
    diagnostic.status = "reload-required";
    chrome.runtime.onMessage.removeListener(onAdVideoIdMessage);
    diagnostic.error = "Refresh this YouTube tab to resume tracking.";
    diagnostic.refresh = undefined;
    document.documentElement.dataset.youtubeAdImpressionWatcher = "reload-required";
  }

  const transport = createContentTransport({ hostVideoId, onInvalidated: handleInvalidated });
  diagnostic.eventName = transport.eventName;
  globalThis.__youtubeAdImpressionWatcher = diagnostic;

  observer = observeYouTubeAds({
    onAdStarted(detail) {
      transport.publish("ad-start", detail);
      impressionMetadata.clear();
    },
    onAdEnded(detail) {
      transport.publish("ad-end", detail);
    },
    onImpressionStarted(detail, metadata) {
      impressionMetadata.set(detail.impressionIndex, metadata);
      transport.publish("ad-impression-start", { ...detail, ...metadata });
    },
    onImpressionEnded(detail) {
      const metadata = impressionMetadata.snapshot(detail.impressionIndex);
      transport.publish("ad-impression-end", { ...detail, ...metadata });
      transport.sendRecordImpression(buildImpressionRecord(detail, metadata, hostVideoId()));
      impressionMetadata.delete(detail.impressionIndex);
    },
    onSkipPressed(impressionIndex) {
      impressionMetadata.markSkipped(impressionIndex, new Date().toISOString());
    },
    onAdVideoId(impressionIndex, adVideoId) {
      const metadata = impressionMetadata.get(impressionIndex);
      if (metadata) {
        metadata.adVideoId = adVideoId;
      }
    },
  });
  chrome.runtime.onMessage.addListener(onAdVideoIdMessage);

  const watchTime = createWatchTimeTracker({
    isAdActive: () => observer.active,
    getVideo: () => observer.getVideo(),
    sendWatchTime: (milliseconds) => transport.sendWatchTime(milliseconds),
  });

  watchTimer = window.setInterval(() => watchTime.sample(), 1000);
  window.addEventListener("pagehide", onPageHide);

  diagnostic.status = "ready";
  diagnostic.refresh = () => observer.refresh();
  Object.defineProperty(diagnostic, "active", {
    enumerable: true,
    get: () => observer.active,
  });
  document.documentElement.dataset.youtubeAdImpressionWatcher = "ready";
}

startTracking();
