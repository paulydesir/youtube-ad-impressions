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

// One advertiser's full picture: aggregates plus recent observations and the
// distinct headlines/creatives actually seen. stats is null when the
// advertiser has no observations.
export async function getAdvertiserOverview(
  db: DatabaseClient,
  advertiser: string,
): Promise<AdvertiserOverviewDto> {
  const overview = await getAdvertiserOverviewData(db, advertiser);
  return {
    stats: overview.stats === null ? null : toStatsDto(overview.stats),
    recent: overview.recent,
    headlines: overview.headlines,
    creativeTitles: overview.creativeTitles,
  };
}
