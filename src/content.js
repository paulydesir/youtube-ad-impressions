(function startYouTubeAdWatcher() {
  "use strict";

  const EVENT_NAME = "youtube-ad-impression-transition";
  const PLAYER_SELECTOR = "#movie_player";
  const ADVERTISER_DOMAIN_SELECTOR = ".ytp-visit-advertiser-link__text";
  const DOMAIN_DEBOUNCE_MS = 200;
  const diagnostic = {
    status: "starting",
    eventName: EVENT_NAME,
    active: false,
  };

  // Install this before initialization so startup failures remain inspectable.
  globalThis.__youtubeAdImpressionWatcher = diagnostic;

  const watcherLibrary = globalThis.YouTubeAdWatcher;
  if (!watcherLibrary) {
    diagnostic.status = "error";
    diagnostic.error = "ad-state-machine.js did not load";
    console.error("[YouTube Ad Impressions]", diagnostic.error);
    return;
  }

  const { AdStateMachine, DomainImpressionTracker, playerIsShowingAd } =
    watcherLibrary;

  let player = null;
  let playerObserver = null;
  let advertiserObserver = null;
  let domainTimer = null;
  let pendingWatchMs = 0;
  let lastWatchTickMs = null;
  const impressionMetadata = new Map();

  function hostVideoId() {
    return new URL(location.href).searchParams.get("v");
  }

  function publish(type, detail) {
    const payload = {
      type,
      hostVideoId: hostVideoId(),
      observedAt: new Date().toISOString(),
      ...detail,
    };

    document.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    console.info("[YouTube Ad Impressions]", payload);
  }

  function persistImpression(detail, metadata) {
    const record = {
      advertiser_name: metadata.advertiserName || metadata.advertiserDomain,
      advertiser_url: metadata.advertiserDomain,
      host_video_id: hostVideoId(),
      timestamp: new Date(detail.startedAtMs).toISOString(),
      ended_at: new Date(detail.endedAtMs).toISOString(),
      duration_ms: detail.durationMs,
      pod_position: metadata.podLabel,
      pod_index: metadata.podPosition,
      pod_size: metadata.podSize,
      impression_index: detail.impressionIndex,
      skipped: metadata.skipped,
      skip_clicked_at: metadata.skipClickedAt,
      skip_available: metadata.skipAvailableAtCapture,
      ad_headline: metadata.adHeadline,
      call_to_action: metadata.callToAction,
      creative_title: metadata.creativeTitle,
      creative_duration_ms: metadata.creativeDurationMs,
      muted: metadata.creativeMutedAtCapture,
      playback_rate: metadata.creativePlaybackRate,
      avatar_url: metadata.avatarUrl,
      player_version: metadata.playerVersion,
      end_reason: detail.reason,
    };

    chrome.runtime.sendMessage(
      { type: "record-impression", record },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[YouTube Ad Impressions] storage unavailable; reload this tab after reloading the extension",
          );
          return;
        }
        if (!response?.ok) {
          console.error("[YouTube Ad Impressions] failed to save impression", response);
        }
      },
    );
  }

  function flushWatchTime() {
    if (pendingWatchMs < 1) return;
    const milliseconds = Math.round(pendingWatchMs);
    pendingWatchMs = 0;
    chrome.runtime.sendMessage({ type: "add-watch-time", milliseconds }, () => {
      void chrome.runtime.lastError;
    });
  }

  function sampleWatchTime() {
    const now = performance.now();
    const video = player?.querySelector("video.html5-main-video");

    if (lastWatchTickMs !== null && video && !video.paused && !state.active) {
      // The cap prevents sleep/wake or a suspended tab from creating phantom hours.
      pendingWatchMs += Math.min(2000, now - lastWatchTickMs);
    }
    lastWatchTickMs = now;

    if (pendingWatchMs >= 10_000) flushWatchTime();
  }

  function text(selector) {
    const element = player?.querySelector(selector);
    return element?.textContent?.trim() || element?.getAttribute("aria-label") || null;
  }

  function parsePodPosition(value) {
    const match = value?.match(/(\d+)\s+of\s+(\d+)/i);
    return match
      ? { podPosition: Number(match[1]), podSize: Number(match[2]) }
      : { podPosition: null, podSize: null };
  }

  function finiteMilliseconds(seconds) {
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  }

  function extractAdMetadata() {
    const video = player?.querySelector("video.html5-main-video");
    const podLabel = text(".ytp-ad-pod-index .ad-simple-attributed-string");
    const avatar = player?.querySelector("img.ytp-ad-avatar");
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
      playerVersion: player?.dataset.version || null,
    };
  }

  const impressions = new DomainImpressionTracker({
    onStart: (detail) => {
      const metadata = extractAdMetadata();
      impressionMetadata.set(detail.impressionIndex, {
        ...metadata,
        skipped: false,
        skipClickedAt: null,
      });
      publish("ad-impression-start", { ...detail, ...metadata });
    },
    onEnd: (detail) => {
      const metadata = impressionMetadata.get(detail.impressionIndex) || {};
      publish("ad-impression-end", { ...detail, ...metadata });
      persistImpression(detail, metadata);
      impressionMetadata.delete(detail.impressionIndex);
    },
  });

  function advertiserDomain() {
    return player
      ?.querySelector(ADVERTISER_DOMAIN_SELECTOR)
      ?.textContent?.trim() || null;
  }

  function inspectAdvertiser() {
    domainTimer = null;
    impressions.updateDomain(advertiserDomain());
  }

  function scheduleAdvertiserInspection() {
    clearTimeout(domainTimer);
    domainTimer = setTimeout(inspectAdvertiser, DOMAIN_DEBOUNCE_MS);
  }

  function startAdvertiserWatcher() {
    impressionMetadata.clear();
    impressions.beginPod();
    advertiserObserver?.disconnect();
    advertiserObserver = new MutationObserver(scheduleAdvertiserInspection);
    advertiserObserver.observe(player, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scheduleAdvertiserInspection();
  }

  function stopAdvertiserWatcher(reason) {
    clearTimeout(domainTimer);
    domainTimer = null;
    // Read once synchronously so a short ad is not lost to the debounce window.
    impressions.updateDomain(advertiserDomain());
    impressions.endPod({ reason });
    advertiserObserver?.disconnect();
    advertiserObserver = null;
  }

  function recordSkip(event) {
    const skipButton = event.target.closest?.(".ytp-skip-ad-button");
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
      stopAdvertiserWatcher(detail.reason || "pod-ended");
      publish("ad-end", detail);
    },
  });

  function readPlayerState() {
    state.update(playerIsShowingAd(player), {
      playerClasses: player ? [...player.classList] : [],
    });
  }

  function attachToPlayer(nextPlayer) {
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

  function findAndAttachPlayer() {
    attachToPlayer(document.querySelector(PLAYER_SELECTOR));
  }

  function ensurePlayerIsAttached() {
    if (player?.isConnected) return;
    findAndAttachPlayer();
  }

  // YouTube is an SPA. Observe document structure so a replaced player is picked up,
  // while the narrow player observer handles the time-sensitive class transitions.
  const documentObserver = new MutationObserver(ensurePlayerIsAttached);
  documentObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("yt-navigate-finish", findAndAttachPlayer);
  document.addEventListener("click", recordSkip, true);
  const watchTimer = setInterval(sampleWatchTime, 1000);
  window.addEventListener("pagehide", () => {
    playerObserver?.disconnect();
    documentObserver.disconnect();
    document.removeEventListener("click", recordSkip, true);
    clearInterval(watchTimer);
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
  document.documentElement.dataset.youtubeAdImpressionWatcher = "ready";
  console.info("[YouTube Ad Impressions] watcher ready");
})();
