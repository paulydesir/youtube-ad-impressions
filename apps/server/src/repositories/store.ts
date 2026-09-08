import type { AdImpressionV1 } from "@ad-impressions/contracts";
import type { DatabaseClient } from "../db/client.js";
import {
  getAdvertiserOverviewData as sqliteOverview,
  getAdvertiserStats as sqliteStats,
  insertImpression as sqliteInsert,
  searchImpressions as sqliteSearch,
  type AdvertiserOverviewData,
  type AdvertiserStatRow,
  type AdvertiserStatsFilters,
  type CompactImpression,
  type ImpressionFilters,
  type InsertStatus,
} from "./impressions.js";
import type { PostgresDatabaseClient } from "../db/postgres/client.js";
import {
  getAdvertiserOverviewData as postgresOverview,
  getAdvertiserStats as postgresStats,
  insertImpression as postgresInsert,
  searchImpressions as postgresSearch,
} from "./impressions.postgres.js";

export type {
  AdvertiserOverviewData,
  AdvertiserStatRow,
  AdvertiserStatsFilters,
  CompactImpression,
  ImpressionFilters,
  InsertStatus,
};

// Backend-agnostic access to stored impressions. The SQLite and PostgreSQL
// repositories expose identical operations over different Drizzle clients, so
// this interface lets the service, HTTP, MCP, and import layers run against
// either backend without a dialect import. Row shapes are identical across
// backends (timestamps stay UTC ISO-8601 strings; skipped stays boolean).
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
}

export function createSqliteStore(db: DatabaseClient): ImpressionStore {
  return {
    insertImpression: (userId, record, rawJson, ingestedAt) =>
      sqliteInsert(db, userId, record, rawJson, ingestedAt),
    searchImpressions: (userId, filters) => sqliteSearch(db, userId, filters),
    getAdvertiserStats: (userId, filters) => sqliteStats(db, userId, filters),
    getAdvertiserOverviewData: (userId, resolvedAdvertiser) =>
      sqliteOverview(db, userId, resolvedAdvertiser),
  };
}

export function createPostgresStore(db: PostgresDatabaseClient): ImpressionStore {
  return {
    insertImpression: (userId, record, rawJson, ingestedAt) =>
      postgresInsert(db, userId, record, rawJson, ingestedAt),
    searchImpressions: (userId, filters) => postgresSearch(db, userId, filters),
    getAdvertiserStats: (userId, filters) => postgresStats(db, userId, filters),
    getAdvertiserOverviewData: (userId, resolvedAdvertiser) =>
      postgresOverview(db, userId, resolvedAdvertiser),
  };
}
