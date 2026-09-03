// Pure aggregation over stored impressions for the popup dashboard.

export interface ImpressionInput {
  advertiser_name?: string | null;
  advertiser_url?: string | null;
  duration_ms?: number | null;
  skipped?: boolean | null;
}

export interface AdvertiserSummary {
  name: string;
  impressions: number;
  durationMs: number;
}

export interface ImpressionAnalytics {
  totalImpressions: number;
  totalAdMs: number;
  averageAdMs: number;
  skippedCount: number;
  skipRate: number;
  watchTimeMs: number;
  adsPerWatchHour: number | null;
  advertisers: AdvertiserSummary[];
}

export function aggregateImpressions(
  records: readonly ImpressionInput[],
  watchTimeMs = 0,
): ImpressionAnalytics {
  const advertisers = new Map<string, AdvertiserSummary>();
  let totalAdMs = 0;
  let skippedCount = 0;

  for (const record of records) {
    const durationMs = Number.isFinite(record.duration_ms)
      ? Math.max(0, record.duration_ms as number)
      : 0;
    const advertiser =
      record.advertiser_name || record.advertiser_url || "Unknown advertiser";
    const current = advertisers.get(advertiser) ?? {
      name: advertiser,
      impressions: 0,
      durationMs: 0,
    };

    current.impressions += 1;
    current.durationMs += durationMs;
    advertisers.set(advertiser, current);
    totalAdMs += durationMs;
    if (record.skipped) skippedCount += 1;
  }

  return {
    totalImpressions: records.length,
    totalAdMs,
    averageAdMs: records.length ? Math.round(totalAdMs / records.length) : 0,
    skippedCount,
    skipRate: records.length ? skippedCount / records.length : 0,
    watchTimeMs,
    adsPerWatchHour:
      watchTimeMs > 0 ? records.length / (watchTimeMs / 3_600_000) : null,
    advertisers: [...advertisers.values()].sort(
      (a, b) => b.impressions - a.impressions || b.durationMs - a.durationMs,
    ),
  };
}
