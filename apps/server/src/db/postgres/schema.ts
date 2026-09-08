import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Supabase owns profile creation through its auth.users trigger. This minimal
// declaration exists only so application tables can reference public.profiles.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
});

// PostgreSQL port of the SQLite MVP table in ../schema.ts. Column names and
// nullability match intentionally so the SQLite and Postgres repositories
// stay side-by-side comparable. Timestamps remain UTC ISO-8601 strings and
// booleans use a native boolean column (SQLite uses integer-mapped booleans).
export const adImpressions = pgTable(
  "ad_impressions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    source: text("source").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMs: integer("duration_ms"),
    hostVideoId: text("host_video_id"),
    advertiserName: text("advertiser_name"),
    advertiserDomain: text("advertiser_domain"),
    adHeadline: text("ad_headline"),
    callToAction: text("call_to_action"),
    creativeTitle: text("creative_title"),
    creativeDurationMs: integer("creative_duration_ms"),
    podId: text("pod_id"),
    podLabel: text("pod_label"),
    podPosition: integer("pod_position"),
    podSize: integer("pod_size"),
    podImpressionIndex: integer("pod_impression_index"),
    skipped: boolean("skipped").notNull(),
    skipClickedAt: text("skip_clicked_at"),
    endReason: text("end_reason"),
    rawJson: text("raw_json").notNull(),
    ingestedAt: text("ingested_at").notNull(),
  },
  (table) => [
    uniqueIndex("ad_impressions_user_id_event_id_unique").on(table.userId, table.eventId),
    index("ad_impressions_started_at_idx").on(table.startedAt),
    index("ad_impressions_advertiser_domain_idx").on(table.advertiserDomain),
    index("ad_impressions_host_video_id_idx").on(table.hostVideoId),
  ],
);

export type AdImpressionRow = typeof adImpressions.$inferSelect;
export type NewAdImpressionRow = typeof adImpressions.$inferInsert;
