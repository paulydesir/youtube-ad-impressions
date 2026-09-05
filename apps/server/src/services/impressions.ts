import type { DatabaseClient } from "../db/client.js";
import {
  getAdvertiserOverviewData,
  getAdvertiserStats as repoAdvertiserStats,
  searchImpressions as repoSearchImpressions,
  type AdvertiserStatsFilters,
  type CompactImpression,
  type ImpressionFilters,
} from "../repositories/impressions.js";

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
  db: DatabaseClient,
  filters: ImpressionFilters = {},
): Promise<ImpressionDto[]> {
  return repoSearchImpressions(db, filters);
}

// Advertiser rankings and rates: frequency, total watch time, skip rate.
export async function getAdvertiserStats(
  db: DatabaseClient,
  filters: AdvertiserStatsFilters = {},
): Promise<AdvertiserStatsDto[]> {
  return (await repoAdvertiserStats(db, filters)).map(toStatsDto);
}

// Resolves one observed advertiser key before returning any data. Exact keys
// win, unique substring matches resolve automatically, and broad matches are
// returned as candidates instead of being silently combined.
export async function getAdvertiserOverview(
  db: DatabaseClient,
  advertiser: string,
): Promise<AdvertiserOverviewDto> {
  const query = advertiser.trim();
  const exact = await getAdvertiserOverviewData(db, query);
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

  const candidates = (await repoAdvertiserStats(db, { advertiser: query, limit: 100 }))
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

  const overview = await getAdvertiserOverviewData(db, candidates[0]!);
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
