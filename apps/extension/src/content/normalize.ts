export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parsePodPosition(value: string | null | undefined): {
  podPosition: number | null;
  podSize: number | null;
} {
  const match = value?.match(/(\d+)\s+of\s+(\d+)/i);
  return match
    ? { podPosition: Number(match[1]), podSize: Number(match[2]) }
    : { podPosition: null, podSize: null };
}

export function secondsToMilliseconds(seconds: number | undefined): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? Math.round(seconds * 1000)
    : null;
}

export function normalizeAdvertiserDomain(
  value: string | null | undefined,
): string | null {
  return value?.trim().toLowerCase() || null;
}
