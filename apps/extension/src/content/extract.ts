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

export interface QueryRoot {
  querySelector(selector: string): Element | null;
}

export function extractText(
  player: QueryRoot | null | undefined,
  selector: string,
): string | null {
  const element = player?.querySelector(selector);
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

export function hostVideoIdFromHref(href: string): string | null {
  try {
    return new URL(href).searchParams.get("v");
  } catch {
    return null;
  }
}

export function hostVideoId(): string | null {
  return hostVideoIdFromHref(location.href);
}

// Structural checks work across page and extension DOM realms.
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
