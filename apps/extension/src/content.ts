import { hostVideoId } from "./content/extract.ts";
import {
  buildImpressionRecord,
  ImpressionMetadataStore,
} from "./content/impression-builder.ts";
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
  var __youtubeAdImpressionWatcher: WatcherDiagnostic | undefined;
}

function startTracking() {
  // Popup recovery and manifest injection may race; keep one observer per tab.
  if (globalThis.__youtubeAdImpressionWatcher?.status === "ready") return;
const transport = createContentTransport({
  hostVideoId,
  onInvalidated() {
    window.clearInterval(watchTimer);
    window.removeEventListener("pagehide", onPageHide);
    observer.destroy("extension-invalidated");
    impressionMetadata.clear();
    diagnostic.status = "reload-required";
    diagnostic.error = "Refresh this YouTube tab to resume tracking.";
    diagnostic.refresh = undefined;
    document.documentElement.dataset["youtubeAdImpressionWatcher"] = "reload-required";
  },
});

const diagnostic: WatcherDiagnostic = {
  status: "starting",
  eventName: transport.eventName,
  active: false,
};

globalThis.__youtubeAdImpressionWatcher = diagnostic;

const impressionMetadata = new ImpressionMetadataStore();

const observer = observeYouTubeAds({
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
    transport.sendRecordImpression(
      buildImpressionRecord(detail, metadata, hostVideoId()),
    );
    impressionMetadata.delete(detail.impressionIndex);
  },
  onSkipPressed(impressionIndex) {
    impressionMetadata.markSkipped(
      impressionIndex,
      new Date().toISOString(),
    );
  },
});

const watchTime = createWatchTimeTracker({
  isAdActive: () => observer.active,
  getVideo: () => observer.getVideo(),
  sendWatchTime: (milliseconds) => transport.sendWatchTime(milliseconds),
});

const watchTimer = window.setInterval(() => watchTime.sample(), 1000);
function onPageHide() {
  window.clearInterval(watchTimer);
  watchTime.flush();
  observer.destroy("pagehide");
  diagnostic.status = "stopped";
  window.removeEventListener("pagehide", onPageHide);
}
window.addEventListener("pagehide", onPageHide);

diagnostic.status = "ready";
diagnostic.refresh = () => observer.refresh();
Object.defineProperty(diagnostic, "active", {
  enumerable: true,
  get: () => observer.active,
});

document.documentElement.dataset["youtubeAdImpressionWatcher"] = "ready";
console.info("[YouTube Ad Impressions] watcher ready");

}

startTracking();
