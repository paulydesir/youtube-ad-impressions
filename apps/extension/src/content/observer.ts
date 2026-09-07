// Watches the YouTube DOM and turns player/advertiser mutations into
// lifecycle callbacks. This is the only module (besides extract/selectors)
// that touches YouTube markup, MutationObservers, or page navigation events.
// Tests for this layer are integration-style; all interpretation logic lives
// in `ad-state-machine.ts`, `extract.ts`, and `impression-builder.ts`.
import {
  AdStateMachine,
  DomainImpressionTracker,
  playerIsShowingAd,
} from "../ad-state-machine.ts";
import type {
  AdEndDetail,
  AdStartDetail,
  ImpressionEndDetail,
  ImpressionStartDetail,
} from "../ad-state-machine.ts";
import {
  extractAdMetadata,
  extractAdvertiserDomain,
  isSkipButtonClick,
} from "./extract.ts";
import type { AdMetadata } from "./extract.ts";
import { PLAYER_SELECTOR, YOUTUBE_SELECTORS } from "./selectors.ts";

export const ADVERTISER_DEBOUNCE_MS = 200;

export interface ObserveYouTubeAdsCallbacks {
  onAdStarted: (detail: AdStartDetail) => void;
  onAdEnded: (detail: AdEndDetail) => void;
  onImpressionStarted: (
    detail: ImpressionStartDetail,
    metadata: AdMetadata,
  ) => void;
  onImpressionEnded: (detail: ImpressionEndDetail) => void;
  onSkipPressed?: (impressionIndex: number) => void;
}

export interface YouTubeAdObserver {
  readonly active: boolean;
  readonly impressionIndex: number;
  getVideo(): HTMLVideoElement | null;
  /** Re-run player discovery (also exposed for DevTools diagnostics). */
  refresh(): void;
  destroy(reason?: string): void;
}

export function observeYouTubeAds(
  callbacks: ObserveYouTubeAdsCallbacks,
): YouTubeAdObserver {
  let player: HTMLElement | null = null;
  let playerObserver: MutationObserver | null = null;
  let advertiserObserver: MutationObserver | null = null;
  let domainTimer: number | undefined;

  const impressions = new DomainImpressionTracker({
    onStart: (detail: ImpressionStartDetail) => {
      callbacks.onImpressionStarted(detail, extractAdMetadata(player));
    },
    onEnd: (detail: ImpressionEndDetail) => {
      callbacks.onImpressionEnded(detail);
    },
  });

  function inspectAdvertiser(): void {
    domainTimer = undefined;
    impressions.updateDomain(extractAdvertiserDomain(player));
  }

  function scheduleAdvertiserInspection(): void {
    // Bound the wait: countdown/overlay mutations must not postpone detection forever.
    if (domainTimer !== undefined) return;
    domainTimer = window.setTimeout(
      inspectAdvertiser,
      ADVERTISER_DEBOUNCE_MS,
    );
  }

  function startAdvertiserWatcher(): void {
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
    impressions.updateDomain(extractAdvertiserDomain(player));
    impressions.endPod({ reason });
    advertiserObserver?.disconnect();
    advertiserObserver = null;
  }

  const state = new AdStateMachine({
    onStart: (detail) => {
      callbacks.onAdStarted(detail);
      startAdvertiserWatcher();
    },
    onEnd: (detail) => {
      const reason =
        typeof detail["reason"] === "string" ? detail["reason"] : "pod-ended";
      stopAdvertiserWatcher(reason);
      callbacks.onAdEnded(detail);
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

  function recordSkip(event: Event): void {
    if (!isSkipButtonClick(event, player)) return;
    callbacks.onSkipPressed?.(impressions.impressionIndex);
  }

  // YouTube is an SPA. Observe document structure so a replaced player is
  // picked up, while the narrow player observer handles the time-sensitive
  // class transitions.
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

  findAndAttachPlayer();

  return {
    get active() {
      return state.active;
    },
    get impressionIndex() {
      return impressions.impressionIndex;
    },
    getVideo() {
      return (
        player?.querySelector<HTMLVideoElement>(YOUTUBE_SELECTORS.video) ??
        null
      );
    },
    refresh: findAndAttachPlayer,
    destroy(reason = "pagehide") {
      playerObserver?.disconnect();
      advertiserObserver?.disconnect();
      documentObserver.disconnect();
      document.removeEventListener("yt-navigate-finish", findAndAttachPlayer);
      document.removeEventListener("click", recordSkip, true);
      window.clearTimeout(domainTimer);
      domainTimer = undefined;
      state.reset({ reason });
    },
  };
}
