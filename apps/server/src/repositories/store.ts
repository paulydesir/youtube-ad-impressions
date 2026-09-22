import type { AdImpressionV1 } from "@ad-impressions/contracts";
import {
  type AdTranscript,
  type AdvertiserOverviewData,
  type AdvertiserStatRow,
  type AdvertiserStatsFilters,
  type CompactImpression,
  type ImpressionFilters,
  type InsertStatus,
} from "./impressions.postgres.js";
import type { PostgresDatabaseClient } from "../db/postgres/client.js";
import {
  getAdTranscript as postgresTranscript,
  getAdvertiserOverviewData as postgresOverview,
  getAdvertiserStats as postgresStats,
  insertImpression as postgresInsert,
  searchImpressions as postgresSearch,
} from "./impressions.postgres.js";

export type {
  AdTranscript,
  AdvertiserOverviewData,
  AdvertiserStatRow,
  AdvertiserStatsFilters,
  CompactImpression,
  ImpressionFilters,
  InsertStatus,
};

export interface ImpressionStore {
  insertImpression(
    userId: string,
    record: AdImpressionV1,
    rawJson: string,
    ingestedAt?: string,
  ): Promise<{ status: InsertStatus; eventId: string }>;
  searchImpressions(userId: string, filters?: ImpressionFilters): Promise<CompactImpression[]>;
  getAdvertiserStats(userId: string, filters?: AdvertiserStatsFilters): Promise<AdvertiserStatRow[]>;
  getAdvertiserOverviewData(userId: string, resolvedAdvertiser: string): Promise<AdvertiserOverviewData>;
  getAdTranscript(adVideoId: string): Promise<AdTranscript | null>;
}

export function createPostgresStore(db: PostgresDatabaseClient): ImpressionStore {
  return {
    insertImpression: (userId, record, rawJson, ingestedAt) =>
      postgresInsert(db, userId, record, rawJson, ingestedAt),
    searchImpressions: (userId, filters) => postgresSearch(db, userId, filters),
    getAdvertiserStats: (userId, filters) => postgresStats(db, userId, filters),
    getAdvertiserOverviewData: (userId, resolvedAdvertiser) =>
      postgresOverview(db, userId, resolvedAdvertiser),
    getAdTranscript: (adVideoId) => postgresTranscript(db, adVideoId),
  };
}
