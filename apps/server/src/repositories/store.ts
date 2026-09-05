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
    record: AdImpressionV1,
    rawJson: string,
    ingestedAt?: string,
  ): Promise<{ status: InsertStatus; eventId: string }>;
  searchImpressions(filters?: ImpressionFilters): Promise<CompactImpression[]>;
  getAdvertiserStats(filters?: AdvertiserStatsFilters): Promise<AdvertiserStatRow[]>;
  getAdvertiserOverviewData(resolvedAdvertiser: string): Promise<AdvertiserOverviewData>;
}

export function createSqliteStore(db: DatabaseClient): ImpressionStore {
  return {
    insertImpression: (record, rawJson, ingestedAt) =>
      sqliteInsert(db, record, rawJson, ingestedAt),
    searchImpressions: (filters) => sqliteSearch(db, filters),
    getAdvertiserStats: (filters) => sqliteStats(db, filters),
    getAdvertiserOverviewData: (resolvedAdvertiser) =>
      sqliteOverview(db, resolvedAdvertiser),
  };
}

export function createPostgresStore(db: PostgresDatabaseClient): ImpressionStore {
  return {
    insertImpression: (record, rawJson, ingestedAt) =>
      postgresInsert(db, record, rawJson, ingestedAt),
    searchImpressions: (filters) => postgresSearch(db, filters),
    getAdvertiserStats: (filters) => postgresStats(db, filters),
    getAdvertiserOverviewData: (resolvedAdvertiser) =>
      postgresOverview(db, resolvedAdvertiser),
  };
}
