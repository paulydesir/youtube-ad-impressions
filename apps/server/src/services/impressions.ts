import type {
  AdTranscript,
  AdTranscriptLookup,
  AdvertiserStatsFilters,
  CompactImpression,
  ImpressionFilters,
  ImpressionStore,
} from "../repositories/store.js";

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

export async function searchImpressions(
  store: ImpressionStore,
  userId: string,
  filters: ImpressionFilters = {},
): Promise<ImpressionDto[]> {
  return store.searchImpressions(userId, filters);
}

export async function getAdTranscript(
  store: ImpressionStore,
  userId: string,
  lookup: AdTranscriptLookup,
): Promise<AdTranscript | null> {
  return store.getAdTranscript(userId, lookup);
}

export async function getAdvertiserStats(
  store: ImpressionStore,
  userId: string,
  filters: AdvertiserStatsFilters = {},
): Promise<AdvertiserStatsDto[]> {
  return (await store.getAdvertiserStats(userId, filters)).map(toStatsDto);
}

export async function getAdvertiserOverview(
  store: ImpressionStore,
  userId: string,
  advertiser: string,
): Promise<AdvertiserOverviewDto> {
  const query = advertiser.trim();
  const exact = await store.getAdvertiserOverviewData(userId, query);
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

  const candidates = (await store.getAdvertiserStats(userId, { advertiser: query, limit: 100 }))
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

  const overview = await store.getAdvertiserOverviewData(userId, candidates[0]!);
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

export async function getAdTranscripts(store: ImpressionStore, userId: string, adIds: string[]) {
  const ads = await store.getAdTranscripts(userId, adIds);
  const byId = new Map(ads.map(ad => [ad.adId.toLowerCase(), ad]));
  return adIds.map(adId => {
    const ad = byId.get(adId.toLowerCase());
    return ad ? { status: "found" as const, ...ad } : {
      status: "not_found" as const,
      adId,
      source: null,
      adVideoId: null,
      transcript: null,
      transcriptLanguage: null,
      transcriptionModel: null,
      transcribedAt: null,
      jobStatus: null,
    };
  });
}
