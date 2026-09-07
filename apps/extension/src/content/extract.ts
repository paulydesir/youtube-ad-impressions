// Reads raw values from YouTube DOM elements.
// This is the only layer (besides selectors/observer) that knows about
// YouTube markup. Everything downstream receives plain `AdMetadata`.
import {
  normalizeText,
  parsePodPosition,
  secondsToMilliseconds,
} from "./normalize.ts";
import { YOUTUBE_SELECTORS } from "./selectors.ts";

export interface AdMetadata {
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

/** Minimal DOM surface the extractor needs (real Elements satisfy this). */
export interface QueryRoot {
  querySelector(selector: string): Element | null;
}

/** Read user-visible text, falling back to aria-label like the legacy code. */
export function extractText(
  player: QueryRoot | null | undefined,
  selector: string,
): string | null {
  const element = player?.querySelector(selector);
  // Legacy semantics preserved exactly: trimmed textContent, else the raw
  // aria-label attribute, else null (empty strings fall through).
  return (
    element?.textContent?.trim() || element?.getAttribute("aria-label") || null
  );
}

export function extractAdvertiserDomain(
  player: QueryRoot | null | undefined,
): string | null {
  const element = player?.querySelector(YOUTUBE_SELECTORS.advertiserDomain);
  return normalizeText(element?.textContent);
}

/** Snapshot every ad field from the player at this instant. */
export function extractAdMetadata(
  player: (QueryRoot & Element) | null | undefined,
): AdMetadata {
  const root: QueryRoot | null | undefined = player;
  const video = root?.querySelector(
    YOUTUBE_SELECTORS.video,
  ) as HTMLVideoElement | null;
  const podLabel = extractText(player, YOUTUBE_SELECTORS.podLabel);
  const avatar = root?.querySelector(
    YOUTUBE_SELECTORS.avatar,
  ) as HTMLImageElement | null;
  const skipButton = root?.querySelector(YOUTUBE_SELECTORS.skipButton);

  return {
    advertiserDomain: extractAdvertiserDomain(player),
    advertiserName: extractText(player, YOUTUBE_SELECTORS.advertiserName),
    adHeadline: extractText(player, YOUTUBE_SELECTORS.adHeadline),
    callToAction: extractText(player, YOUTUBE_SELECTORS.callToAction),
    creativeTitle: extractText(player, YOUTUBE_SELECTORS.creativeTitle),
    disclosureLabel: extractText(player, YOUTUBE_SELECTORS.disclosureLabel),
    podLabel,
    ...parsePodPosition(podLabel),
    skipAvailableAtCapture: Boolean(skipButton),
    creativeDurationMs: secondsToMilliseconds(video?.duration),
    creativeCurrentTimeMs: secondsToMilliseconds(video?.currentTime),
    creativeMutedAtCapture: video?.muted ?? null,
    creativePlaybackRate: video?.playbackRate ?? null,
    avatarUrl: avatar?.currentSrc || avatar?.src || null,
    playerVersion:
      (player as { dataset?: Record<string, string | undefined> } | null)
        ?.dataset?.["version"] ?? null,
  };
}

/** Pure host-video lookup so tests never need `location`. */
export function hostVideoIdFromHref(href: string): string | null {
  try {
    return new URL(href).searchParams.get("v");
  } catch {
    return null;
  }
}

/** Content-script lookup for the currently watched video. */
export function hostVideoId(): string | null {
  return hostVideoIdFromHref(location.href);
}

/**
 * True when a captured click is a press on the player's skip button.
 * Mirrors the legacy `recordSkip` guard exactly. The target check is
 * structural (rather than `instanceof Element`) so it also works across
 * realms and in non-DOM test runtimes; in browsers only Elements expose
 * `closest`, so the outcome is identical.
 */
export function isSkipButtonClick(
  event: Event,
  player: { contains(node: Node | null): boolean } | null | undefined,
): boolean {
  const target = event.target as Element | null | undefined;
  if (!target || typeof target.closest !== "function") return false;
  const skipButton = target.closest(YOUTUBE_SELECTORS.skipButton);
  if (!skipButton || !player?.contains(skipButton)) return false;
  return true;
}
