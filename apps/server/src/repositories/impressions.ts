import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { and, count, desc, eq, gte, lte, max, min, or, sql, sum } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { DatabaseClient } from "../db/client.js";
import { adImpressions } from "../db/schema.js";

export type InsertStatus = "inserted" | "duplicate";

export interface ImpressionFilters {
  advertiser?: string;
  terms?: string[];
  from?: string;
  to?: string;
  skipped?: boolean;
  limit?: number;
}

export interface AdvertiserStatsFilters {
  advertiser?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// Compact row: every column except raw_json, which never leaves the database
// through this repository.
export type CompactImpression = Omit<typeof adImpressions.$inferSelect, "rawJson">;

export interface AdvertiserStatRow {
  advertiser: string;
  impressionCount: number;
  totalDurationMs: number;
  skippedCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdvertiserOverviewData {
  stats: AdvertiserStatRow | null;
  recent: CompactImpression[];
  headlines: string[];
  creativeTitles: string[];
}

const SEARCH_DEFAULT_LIMIT = 20;
const STATS_DEFAULT_LIMIT = 50;
const OVERVIEW_RECENT_LIMIT = 10;
const MAX_LIMIT = 100;
const UNKNOWN_ADVERTISER = "(unknown)";

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

// Case-insensitive substring match without LIKE wildcards, so user input
// never needs escaping.
function contains(column: SQLiteColumn, term: string) {
  return sql`instr(lower(${column}), lower(${term})) > 0`;
}

function advertiserConditions(advertiser: string) {
  const needle = advertiser.trim();
  if (!needle) return undefined;
  return or(
    contains(adImpressions.advertiserName, needle),
    contains(adImpressions.advertiserDomain, needle),
  );
}

function dateConditions(from?: string, to?: string) {
  const conditions = [];
  if (from !== undefined) conditions.push(gte(adImpressions.startedAt, from));
  if (to !== undefined) conditions.push(lte(adImpressions.startedAt, to));
  return conditions;
}

function termCondition(terms: string[]) {
  const needles = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  if (needles.length === 0) return undefined;
  return or(
    ...needles.flatMap((needle) => [
      contains(adImpressions.advertiserName, needle),
      contains(adImpressions.advertiserDomain, needle),
      contains(adImpressions.adHeadline, needle),
      contains(adImpressions.callToAction, needle),
      contains(adImpressions.creativeTitle, needle),
    ]),
  );
}

const compactColumns = {
  id: adImpressions.id,
  eventId: adImpressions.eventId,
  schemaVersion: adImpressions.schemaVersion,
  source: adImpressions.source,
  startedAt: adImpressions.startedAt,
  endedAt: adImpressions.endedAt,
  durationMs: adImpressions.durationMs,
  hostVideoId: adImpressions.hostVideoId,
  advertiserName: adImpressions.advertiserName,
  advertiserDomain: adImpressions.advertiserDomain,
  adHeadline: adImpressions.adHeadline,
  callToAction: adImpressions.callToAction,
  creativeTitle: adImpressions.creativeTitle,
  creativeDurationMs: adImpressions.creativeDurationMs,
  podId: adImpressions.podId,
  podLabel: adImpressions.podLabel,
  podPosition: adImpressions.podPosition,
  podSize: adImpressions.podSize,
  podImpressionIndex: adImpressions.podImpressionIndex,
  skipped: adImpressions.skipped,
  skipClickedAt: adImpressions.skipClickedAt,
  endReason: adImpressions.endReason,
  ingestedAt: adImpressions.ingestedAt,
};

// Display key: observed domain first, then name, then a placeholder so
// anonymous impressions still aggregate instead of vanishing.
const advertiserKey = sql<string>`coalesce(${adImpressions.advertiserDomain}, ${adImpressions.advertiserName}, ${UNKNOWN_ADVERTISER})`;

// Idempotent insert keyed on event_id. Returns "duplicate" instead of
// throwing when the event was already stored.
export async function insertImpression(
  db: DatabaseClient,
  record: AdImpressionV1,
  rawJson: string,
  ingestedAt: string = new Date().toISOString(),
): Promise<{ status: InsertStatus; eventId: string }> {
  const rows = await db
    .insert(adImpressions)
    .values({
      eventId: record.event_id,
      schemaVersion: record.schema_version,
      source: record.source,
      startedAt: record.started_at,
      endedAt: record.ended_at,
      durationMs: record.duration_ms,
      hostVideoId: record.host_video_id,
      advertiserName: record.advertiser_name,
      advertiserDomain: record.advertiser_domain,
      adHeadline: record.ad_headline,
      callToAction: record.call_to_action,
      creativeTitle: record.creative_title,
      creativeDurationMs: record.creative_duration_ms,
      podId: record.pod_id,
      podLabel: record.pod_label,
      podPosition: record.pod_position,
      podSize: record.pod_size,
      podImpressionIndex: record.pod_impression_index,
      skipped: record.skipped,
      skipClickedAt: record.skip_clicked_at,
      endReason: record.end_reason,
      rawJson,
      ingestedAt,
    })
    .onConflictDoNothing({ target: adImpressions.eventId })
    .returning({ eventId: adImpressions.eventId });
  return {
    status: rows.length > 0 ? "inserted" : "duplicate",
    eventId: record.event_id,
  };
}

export async function searchImpressions(
  db: DatabaseClient,
  filters: ImpressionFilters = {},
): Promise<CompactImpression[]> {
  const conditions = [
    ...dateConditions(filters.from, filters.to),
    ...(filters.skipped === undefined ? [] : [eq(adImpressions.skipped, filters.skipped)]),
  ];
  const advertiser = filters.advertiser === undefined ? undefined : advertiserConditions(filters.advertiser);
  if (advertiser) conditions.push(advertiser);
  const terms = filters.terms === undefined ? undefined : termCondition(filters.terms);
  if (terms) conditions.push(terms);

  return db
    .select(compactColumns)
    .from(adImpressions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adImpressions.startedAt), desc(adImpressions.id))
    .limit(clampLimit(filters.limit, SEARCH_DEFAULT_LIMIT));
}

export async function getAdvertiserStats(
  db: DatabaseClient,
  filters: AdvertiserStatsFilters = {},
): Promise<AdvertiserStatRow[]> {
  const conditions = dateConditions(filters.from, filters.to);
  const advertiser = filters.advertiser === undefined ? undefined : advertiserConditions(filters.advertiser);
  if (advertiser) conditions.push(advertiser);

  const rows = await db
    .select({
      advertiser: advertiserKey,
      impressionCount: count(adImpressions.id),
      totalDurationMs: sum(adImpressions.durationMs),
      skippedCount: sum(sql`case when ${adImpressions.skipped} then 1 else 0 end`),
      firstSeenAt: min(adImpressions.startedAt),
      lastSeenAt: max(adImpressions.startedAt),
    })
    .from(adImpressions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(advertiserKey)
    .orderBy(desc(count(adImpressions.id)))
    .limit(clampLimit(filters.limit, STATS_DEFAULT_LIMIT));

  return rows.map((row) => ({
    advertiser: row.advertiser,
    impressionCount: row.impressionCount,
    totalDurationMs: Number(row.totalDurationMs ?? 0),
    skippedCount: Number(row.skippedCount ?? 0),
    firstSeenAt: row.firstSeenAt ?? "",
    lastSeenAt: row.lastSeenAt ?? "",
  }));
}

async function distinctColumnValues(
  db: DatabaseClient,
  column: typeof adImpressions.adHeadline | typeof adImpressions.creativeTitle,
  advertiser: string,
): Promise<string[]> {
  const condition = advertiserConditions(advertiser);
  const rows = await db
    .selectDistinct({ value: column })
    .from(adImpressions)
    .where(
      and(
        sql`${column} is not null`,
        ...(condition ? [condition] : []),
      ),
    )
    .orderBy(column);
  return rows.map((row) => row.value).filter((value): value is string => value !== null);
}

export async function getAdvertiserOverviewData(
  db: DatabaseClient,
  advertiser: string,
): Promise<AdvertiserOverviewData> {
  const [stats] = await getAdvertiserStats(db, { advertiser, limit: 1 });
  const recent = await searchImpressions(db, {
    advertiser,
    limit: OVERVIEW_RECENT_LIMIT,
  });
  const [headlines, creativeTitles] = await Promise.all([
    distinctColumnValues(db, adImpressions.adHeadline, advertiser),
    distinctColumnValues(db, adImpressions.creativeTitle, advertiser),
  ]);
  return {
    stats: stats ?? null,
    recent,
    headlines,
    creativeTitles,
  };
}
