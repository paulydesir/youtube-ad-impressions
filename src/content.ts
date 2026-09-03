// Isolated-world content script: watches `#movie_player` class transitions and
// the advertiser overlay, then forwards completed impressions to the worker.
// Bundled to a single IIFE (see scripts/build.mjs) — no runtime imports remain.
import {
  AdStateMachine,
  DomainImpressionTracker,
  playerIsShowingAd,
} from "./ad-state-machine.ts";
import type {
  ImpressionEndDetail,
  ImpressionStartDetail,
  TransitionContext,
} from "./ad-state-machine.ts";
import type { AdImpressionRecord, ExtensionMessage } from "./types.ts";

const EVENT_NAME = "youtube-ad-impression-transition";
const PLAYER_SELECTOR = "#movie_player";
const ADVERTISER_DOMAIN_SELECTOR = ".ytp-visit-advertiser-link__text";
const DOMAIN_DEBOUNCE_MS = 200;

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

const diagnostic: WatcherDiagnostic = {
  status: "starting",
  eventName: EVENT_NAME,
  active: false,
};

// Install this before initialization so startup failures remain inspectable.
globalThis.__youtubeAdImpressionWatcher = diagnostic;

interface AdMetadata {
  advertiserDomain: string | null;
  advertiserName: string | null;
  adHeadline: string | null;
  callToAction: string | null;
  creativeTitle: string | null;
  disclosureLabel: string | null;
  podLabel: string | null;
  podPosition: number | null;
  podSize: number | null;
  skipAvailableAtCapture: boolean;
  creativeDurationMs: number | null;
  creativeCurrentTimeMs: number | null;
  creativeMutedAtCapture: boolean | null;
  creativePlaybackRate: number | null;
  avatarUrl: string | null;
  playerVersion: string | null;
}

interface StoredMetadata extends AdMetadata {
  skipped: boolean;
  skipClickedAt: string | null;
}

let player: HTMLElement | null = null;
let playerObserver: MutationObserver | null = null;
let advertiserObserver: MutationObserver | null = null;
let domainTimer: number | undefined;
let pendingWatchMs = 0;
let lastWatchTickMs: number | null = null;
const impressionMetadata = new Map<number, StoredMetadata>();

function hostVideoId(): string | null {
  return new URL(location.href).searchParams.get("v");
}

function publish(type: string, detail: TransitionContext): void {
  const payload = {
    type,
    hostVideoId: hostVideoId(),
    observedAt: new Date().toISOString(),
    ...detail,
  };

  document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  console.info("[YouTube Ad Impressions]", payload);
}

function persistImpression(
  detail: ImpressionEndDetail,
  metadata: Partial<StoredMetadata>,
): void {
  const record: AdImpressionRecord = {
    advertiser_name: metadata.advertiserName ?? metadata.advertiserDomain ?? null,
    advertiser_url: metadata.advertiserDomain ?? null,
    host_video_id: hostVideoId(),
    timestamp: new Date(detail.startedAtMs).toISOString(),
    ended_at: new Date(detail.endedAtMs).toISOString(),
    duration_ms: detail.durationMs,
    pod_position: metadata.podLabel ?? null,
    pod_index: metadata.podPosition ?? null,
    pod_size: metadata.podSize ?? null,
    impression_index: detail.impressionIndex,
    skipped: metadata.skipped ?? false,
    skip_clicked_at: metadata.skipClickedAt ?? null,
    skip_available: metadata.skipAvailableAtCapture ?? false,
    ad_headline: metadata.adHeadline ?? null,
    call_to_action: metadata.callToAction ?? null,
    creative_title: metadata.creativeTitle ?? null,
    creative_duration_ms: metadata.creativeDurationMs ?? null,
    muted: metadata.creativeMutedAtCapture ?? null,
    playback_rate: metadata.creativePlaybackRate ?? null,
    avatar_url: metadata.avatarUrl ?? null,
    player_version: metadata.playerVersion ?? null,
    end_reason: detail.reason,
  };

  const message: ExtensionMessage = { type: "record-impression", record };
  chrome.runtime.sendMessage(message, (response: { ok?: boolean } | undefined) => {
    if (chrome.runtime.lastError) {
      console.warn(
        "[YouTube Ad Impressions] storage unavailable; reload this tab after reloading the extension",
      );
      return;
    }
    if (!response?.ok) {
      console.error("[YouTube Ad Impressions] failed to save impression", response);
    }
  });
}

function flushWatchTime(): void {
  if (pendingWatchMs < 1) return;
  const milliseconds = Math.round(pendingWatchMs);
  pendingWatchMs = 0;
  const message: ExtensionMessage = { type: "add-watch-time", milliseconds };
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function sampleWatchTime(): void {
  const now = performance.now();
  const video = player?.querySelector<HTMLVideoElement>("video.html5-main-video");

  if (lastWatchTickMs !== null && video && !video.paused && !state.active) {
    // The cap prevents sleep/wake or a suspended tab from creating phantom hours.
    pendingWatchMs += Math.min(2000, now - lastWatchTickMs);
  }
  lastWatchTickMs = now;

  if (pendingWatchMs >= 10_000) flushWatchTime();
}

function text(selector: string): string | null {
  const element = player?.querySelector(selector);
  return (
    element?.textContent?.trim() || element?.getAttribute("aria-label") || null
  );
}

function parsePodPosition(value: string | null): {
  podPosition: number | null;
  podSize: number | null;
} {
  const match = value?.match(/(\d+)\s+of\s+(\d+)/i);
  return match
    ? { podPosition: Number(match[1]), podSize: Number(match[2]) }
    : { podPosition: null, podSize: null };
}

function finiteMilliseconds(seconds: number | undefined): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.round(seconds * 1000)
    : null;
}

function advertiserDomain(): string | null {
  return (
    player?.querySelector(ADVERTISER_DOMAIN_SELECTOR)?.textContent?.trim() || null
  );
}

function extractAdMetadata(): AdMetadata {
  const video = player?.querySelector<HTMLVideoElement>("video.html5-main-video");
  const podLabel = text(".ytp-ad-pod-index .ad-simple-attributed-string");
  const avatar = player?.querySelector<HTMLImageElement>("img.ytp-ad-avatar");
  const skipButton = player?.querySelector(".ytp-skip-ad-button");

  return {
    advertiserDomain: advertiserDomain(),
    advertiserName: text(".ytp-ad-avatar-lockup-card__description"),
    adHeadline: text(".ytp-ad-avatar-lockup-card__headline"),
    callToAction: text(".ytp-ad-button-vm__text"),
    creativeTitle: text(".ytp-title-text .ytp-title-link"),
    disclosureLabel: text(".ytp-ad-badge__text--clean-player"),
    podLabel,
    ...parsePodPosition(podLabel),
    skipAvailableAtCapture: Boolean(skipButton),
    creativeDurationMs: finiteMilliseconds(video?.duration),
    creativeCurrentTimeMs: finiteMilliseconds(video?.currentTime),
    creativeMutedAtCapture: video?.muted ?? null,
    creativePlaybackRate: video?.playbackRate ?? null,
    avatarUrl: avatar?.currentSrc || avatar?.src || null,
    playerVersion: player?.dataset["version"] ?? null,
  };
}

const impressions = new DomainImpressionTracker({
  onStart: (detail: ImpressionStartDetail) => {
    const metadata = extractAdMetadata();
    impressionMetadata.set(detail.impressionIndex, {
      ...metadata,
      skipped: false,
      skipClickedAt: null,
    });
    publish("ad-impression-start", { ...detail, ...metadata });
  },
  onEnd: (detail: ImpressionEndDetail) => {
    const metadata: Partial<StoredMetadata> =
      impressionMetadata.get(detail.impressionIndex) ?? {};
    publish("ad-impression-end", { ...detail, ...metadata });
    persistImpression(detail, metadata);
    impressionMetadata.delete(detail.impressionIndex);
  },
});

function inspectAdvertiser(): void {
  domainTimer = undefined;
  impressions.updateDomain(advertiserDomain());
}

function scheduleAdvertiserInspection(): void {
  window.clearTimeout(domainTimer);
  domainTimer = window.setTimeout(inspectAdvertiser, DOMAIN_DEBOUNCE_MS);
}

function startAdvertiserWatcher(): void {
  impressionMetadata.clear();
  impressions.beginPod();
  advertiserObserver?.disconnect();
  advertiserObserver = new MutationObserver(scheduleAdvertiserInspection);
  if (player) {
    advertiserObserver.observe(player, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  scheduleAdvertiserInspection();
}

function stopAdvertiserWatcher(reason: string): void {
  window.clearTimeout(domainTimer);
  domainTimer = undefined;
  // Read once synchronously so a short ad is not lost to the debounce window.
  impressions.updateDomain(advertiserDomain());
  impressions.endPod({ reason });
  advertiserObserver?.disconnect();
  advertiserObserver = null;
}

function recordSkip(event: Event): void {
  if (!(event.target instanceof Element)) return;
  const skipButton = event.target.closest(".ytp-skip-ad-button");
  if (!skipButton || !player?.contains(skipButton)) return;

  const metadata = impressionMetadata.get(impressions.impressionIndex);
  if (!metadata) return;
  metadata.skipped = true;
  metadata.skipClickedAt = new Date().toISOString();
}

const state = new AdStateMachine({
  onStart: (detail) => {
    publish("ad-start", detail);
    startAdvertiserWatcher();
  },
  onEnd: (detail) => {
    const reason =
      typeof detail["reason"] === "string" ? detail["reason"] : "pod-ended";
    stopAdvertiserWatcher(reason);
    publish("ad-end", detail);
  },
});

function readPlayerState(): void {
  state.update(playerIsShowingAd(player), {
    playerClasses: player ? [...player.classList] : [],
  });
}

function attachToPlayer(nextPlayer: HTMLElement | null): void {
  if (nextPlayer === player) return;

  playerObserver?.disconnect();
  advertiserObserver?.disconnect();
  state.reset({ reason: "player-replaced" });
  player = nextPlayer;

  if (!player) return;

  playerObserver = new MutationObserver(readPlayerState);
  playerObserver.observe(player, {
    attributes: true,
    attributeFilter: ["class"],
  });
  readPlayerState();
}

function findAndAttachPlayer(): void {
  attachToPlayer(document.querySelector<HTMLElement>(PLAYER_SELECTOR));
}

function ensurePlayerIsAttached(): void {
  if (player?.isConnected) return;
  findAndAttachPlayer();
}

// YouTube is an SPA. Observe document structure so a replaced player is picked up,
// while the narrow player observer handles the time-sensitive class transitions.
const documentObserver = new MutationObserver(ensurePlayerIsAttached);
const rootElement = document.documentElement;
if (rootElement) {
  documentObserver.observe(rootElement, {
    childList: true,
    subtree: true,
  });
}

document.addEventListener("yt-navigate-finish", findAndAttachPlayer);
document.addEventListener("click", recordSkip, true);
const watchTimer = window.setInterval(sampleWatchTime, 1000);
window.addEventListener("pagehide", () => {
  playerObserver?.disconnect();
  documentObserver.disconnect();
  document.removeEventListener("click", recordSkip, true);
  window.clearInterval(watchTimer);
  flushWatchTime();
  state.reset({ reason: "pagehide" });
});

findAndAttachPlayer();

diagnostic.status = "ready";
diagnostic.refresh = findAndAttachPlayer;
Object.defineProperty(diagnostic, "active", {
  enumerable: true,
  get: () => state.active,
});

// This marker is visible from the normal page context as well as the isolated
// content-script context, making installation checks unambiguous.
document.documentElement.dataset["youtubeAdImpressionWatcher"] = "ready";
console.info("[YouTube Ad Impressions] watcher ready");
