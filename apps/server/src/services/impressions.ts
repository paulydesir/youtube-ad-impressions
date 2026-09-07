import type {
  AdvertiserStatsFilters,
  CompactImpression,
  ImpressionFilters,
  ImpressionStore,
} from "../repositories/store.js";

// Compact observation DTO. The store holds no avatar or player-metadata
// columns (those live only in raw_json), and raw_json never leaves the
// database, so the repository's compact row is already the DTO shape —
// restated here so the service owns its response contract.
export type ImpressionDto = CompactImpression;

export interface AdvertiserStatsDto {
  advertiser: string;
  impressionCount: number;
  totalDurationMs: number;
  skippedCount: number;
  skipRate: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdvertiserOverviewDto {
  status: "found" | "not_found" | "ambiguous";
  query: string;
  advertiser: string | null;
  candidates: string[];
  stats: AdvertiserStatsDto | null;
  recent: ImpressionDto[];
  headlines: string[];
  creativeTitles: string[];
}

function toStatsDto(row: {
  advertiser: string;
  impressionCount: number;
  totalDurationMs: number;
  skippedCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}): AdvertiserStatsDto {
  return {
    ...row,
    skipRate: row.impressionCount > 0 ? row.skippedCount / row.impressionCount : 0,
  };
}

// Individual observations: headlines, promotions, timing, skip behavior.
// Newest first; limits are clamped by the repository (default 20, max 100).
export async function searchImpressions(
  store: ImpressionStore,
  filters: ImpressionFilters = {},
): Promise<ImpressionDto[]> {
  return store.searchImpressions(filters);
}

// Advertiser rankings and rates: frequency, total watch time, skip rate.
export async function getAdvertiserStats(
  store: ImpressionStore,
  filters: AdvertiserStatsFilters = {},
): Promise<AdvertiserStatsDto[]> {
  return (await store.getAdvertiserStats(filters)).map(toStatsDto);
}

// Resolves one observed advertiser key before returning any data. Exact keys
// win, unique substring matches resolve automatically, and broad matches are
// returned as candidates instead of being silently combined.
export async function getAdvertiserOverview(
  store: ImpressionStore,
  advertiser: string,
): Promise<AdvertiserOverviewDto> {
  const query = advertiser.trim();
  const exact = await store.getAdvertiserOverviewData(query);
  if (exact.stats !== null) {
    return {
      status: "found",
      query,
      advertiser: exact.stats.advertiser,
      candidates: [exact.stats.advertiser],
      stats: toStatsDto(exact.stats),
      recent: exact.recent,
      headlines: exact.headlines,
      creativeTitles: exact.creativeTitles,
    };
  }

  const candidates = (await store.getAdvertiserStats({ advertiser: query, limit: 100 }))
    .map((candidate) => candidate.advertiser);
  if (candidates.length !== 1) {
    return {
      status: candidates.length === 0 ? "not_found" : "ambiguous",
      query,
      advertiser: null,
      candidates,
      stats: null,
      recent: [],
      headlines: [],
      creativeTitles: [],
    };
  }

  const overview = await store.getAdvertiserOverviewData(candidates[0]!);
  return {
    status: "found",
    query,
    advertiser: candidates[0]!,
    candidates,
    stats: overview.stats === null ? null : toStatsDto(overview.stats),
    recent: overview.recent,
    headlines: overview.headlines,
    creativeTitles: overview.creativeTitles,
  };
}
