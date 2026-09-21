import { requireUserId } from "./tenant.js";
import type { AdImpressionV1 } from "@ad-impressions/contracts";
import { and, count, desc, eq, gte, lt, lte, max, min, or, sql, sum } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { PostgresDatabaseClient } from "../db/postgres/client.js";
import { adImpressions, profiles } from "../db/postgres/schema.js";

export type InsertStatus = "inserted" | "duplicate";

export interface ImpressionFilters {
  before?: { startedAt: string; eventId: string };
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

export type CompactImpression = Omit<
  typeof adImpressions.$inferSelect,
  "id" | "rawJson" | "userId" | "userId"
>;

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

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
}

function contains(column: PgColumn, term: string) {
  return sql`strpos(lower(${column}), lower(${term})) > 0`;
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
// anonymous impressions still aggregate instead of vanishing. The fallback is
// inlined as a literal (rather than bound as a param) so the SELECT and
// GROUP BY expressions are textually identical, as PostgreSQL requires.
const advertiserKey = sql<string>`coalesce(${adImpressions.advertiserDomain}, ${adImpressions.advertiserName}, '(unknown)')`;

function exactAdvertiserKeyCondition(value: string) {
  return sql`lower(${advertiserKey}) = lower(${value})`;
}

function toAdvertiserStatRow(row: {
  advertiser: string;
  impressionCount: number;
  totalDurationMs: string | number | null;
  skippedCount: string | number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}): AdvertiserStatRow {
  return {
    advertiser: row.advertiser,
    impressionCount: row.impressionCount,
    totalDurationMs: Number(row.totalDurationMs ?? 0),
    skippedCount: Number(row.skippedCount ?? 0),
    firstSeenAt: row.firstSeenAt ?? "",
    lastSeenAt: row.lastSeenAt ?? "",
  };
}

export async function insertImpression(
  db: PostgresDatabaseClient,
  userIdParam: string,
  record: AdImpressionV1,
  rawJson: string,
  ingestedAt: string = new Date().toISOString(),
): Promise<{ status: InsertStatus; eventId: string }> {
  const userId = requireUserId(userIdParam);
  // Standalone Postgres (e.g. Render) has no Supabase auth.users trigger to
  // create profiles rows. Upsert is a no-op where the trigger already ran.
  await db.insert(profiles).values({ id: userId }).onConflictDoNothing();
  const rows = await db
    .insert(adImpressions)
    .values({
      userId,
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
    .onConflictDoNothing({ target: [adImpressions.userId, adImpressions.eventId] })
    .returning({ eventId: adImpressions.eventId });
  return {
    status: rows.length > 0 ? "inserted" : "duplicate",
    eventId: record.event_id,
  };
}

export async function searchImpressions(
  db: PostgresDatabaseClient,
  userId: string,
  filters: ImpressionFilters = {},
): Promise<CompactImpression[]> {
  const conditions = [
    eq(adImpressions.userId, requireUserId(userId)),
    ...dateConditions(filters.from, filters.to),
    ...(filters.skipped === undefined ? [] : [eq(adImpressions.skipped, filters.skipped)]),
  ];
  if (filters.before) {
    conditions.push(or(
      lt(adImpressions.startedAt, filters.before.startedAt),
      and(eq(adImpressions.startedAt, filters.before.startedAt), lt(adImpressions.eventId, filters.before.eventId)),
    )!);
  }
  const advertiser = filters.advertiser === undefined ? undefined : advertiserConditions(filters.advertiser);
  if (advertiser) conditions.push(advertiser);
  const terms = filters.terms === undefined ? undefined : termCondition(filters.terms);
  if (terms) conditions.push(terms);

  return db
    .select(compactColumns)
    .from(adImpressions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adImpressions.startedAt), desc(adImpressions.eventId))
    .limit(clampLimit(filters.limit, SEARCH_DEFAULT_LIMIT));
}

export async function getAdvertiserStats(
  db: PostgresDatabaseClient,
  userId: string,
  filters: AdvertiserStatsFilters = {},
): Promise<AdvertiserStatRow[]> {
  const conditions = [eq(adImpressions.userId, requireUserId(userId)), ...dateConditions(filters.from, filters.to)];
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

  return rows.map(toAdvertiserStatRow);
}

async function distinctColumnValues(
  db: PostgresDatabaseClient,
  userId: string,
  column: typeof adImpressions.adHeadline | typeof adImpressions.creativeTitle,
  resolvedAdvertiser: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: column })
    .from(adImpressions)
    .where(
      and(
        eq(adImpressions.userId, requireUserId(userId)),
        sql`${column} is not null`,
        exactAdvertiserKeyCondition(resolvedAdvertiser),
      ),
    )
    .orderBy(column);
  return rows.map((row) => row.value).filter((value): value is string => value !== null);
}

export async function getAdvertiserOverviewData(
  db: PostgresDatabaseClient,
  userId: string,
  resolvedAdvertiser: string,
): Promise<AdvertiserOverviewData> {
  const condition = and(eq(adImpressions.userId, requireUserId(userId)), exactAdvertiserKeyCondition(resolvedAdvertiser));
  const [statsRow] = await db
    .select({
      advertiser: advertiserKey,
      impressionCount: count(adImpressions.id),
      totalDurationMs: sum(adImpressions.durationMs),
      skippedCount: sum(sql`case when ${adImpressions.skipped} then 1 else 0 end`),
      firstSeenAt: min(adImpressions.startedAt),
      lastSeenAt: max(adImpressions.startedAt),
    })
    .from(adImpressions)
    .where(condition)
    .groupBy(advertiserKey)
    .limit(1);
  const recent = await db
    .select(compactColumns)
    .from(adImpressions)
    .where(condition)
    .orderBy(desc(adImpressions.startedAt), desc(adImpressions.id))
    .limit(OVERVIEW_RECENT_LIMIT);
  const [headlines, creativeTitles] = await Promise.all([
    distinctColumnValues(db, userId, adImpressions.adHeadline, resolvedAdvertiser),
    distinctColumnValues(db, userId, adImpressions.creativeTitle, resolvedAdvertiser),
  ]);
  return {
    stats: statsRow === undefined ? null : toAdvertiserStatRow(statsRow),
    recent,
    headlines,
    creativeTitles,
  };
}
