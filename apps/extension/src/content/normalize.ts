// Pure string/number normalization for values scraped from the YouTube DOM.
// No DOM, Chrome, or YouTube knowledge beyond the shape of the strings.

/** Trim user-visible text; empty/whitespace-only becomes null. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse pod labels like "1 of 2" (case-insensitive, extra spacing tolerated).
 * Anything else yields nulls — never throws, never guesses.
 */
export function parsePodPosition(value: string | null | undefined): {
  podPosition: number | null;
  podSize: number | null;
} {
  const match = value?.match(/(\d+)\s+of\s+(\d+)/i);
  return match
    ? { podPosition: Number(match[1]), podSize: Number(match[2]) }
    : { podPosition: null, podSize: null };
}

/** Convert video-element seconds to whole milliseconds; non-finite → null. */
export function secondsToMilliseconds(seconds: number | undefined): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.round(seconds * 1000)
    : null;
}

/** Canonicalize an advertiser domain the way impression tracking compares it. */
export function normalizeAdvertiserDomain(
  value: string | null | undefined,
): string | null {
  return value?.trim().toLowerCase() || null;
}
