// Isolated-world content script: watches `#movie_player` class transitions and
// the advertiser overlay, then forwards completed impressions to the worker.
// Bundled to a single IIFE (see scripts/build.mjs) — no runtime imports remain.
//
// This file is orchestration only. YouTube DOM knowledge lives in
// `content/observer.ts` + `content/extract.ts` + `content/selectors.ts`,
// record mapping in `content/impression-builder.ts`, messaging in
// `content/transport.ts`, and watch-time batching in `content/watch-time.ts`.
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
  // Inspectable from DevTools (content-script context) for status checks.
  var __youtubeAdImpressionWatcher: WatcherDiagnostic | undefined;
}

const transport = createContentTransport({ hostVideoId });

const diagnostic: WatcherDiagnostic = {
  status: "starting",
  eventName: transport.eventName,
  active: false,
};

// Install this before initialization so startup failures remain inspectable.
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
window.addEventListener("pagehide", () => {
  window.clearInterval(watchTimer);
  watchTime.flush();
  observer.destroy("pagehide");
});

diagnostic.status = "ready";
diagnostic.refresh = () => observer.refresh();
Object.defineProperty(diagnostic, "active", {
  enumerable: true,
  get: () => observer.active,
});

// This marker is visible from the normal page context as well as the isolated
// content-script context, making installation checks unambiguous.
document.documentElement.dataset["youtubeAdImpressionWatcher"] = "ready";
console.info("[YouTube Ad Impressions] watcher ready");
