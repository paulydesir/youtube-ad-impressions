import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Single MVP table. No advertiser/campaign/creative tables yet — aggregation
// happens in queries, not in the schema. Timestamps are UTC ISO-8601 strings;
// booleans are stored as SQLite integers and mapped by Drizzle.
export const adImpressions = sqliteTable(
  "ad_impressions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Unowned legacy SQLite rows stay inaccessible; every new repository write requires ownership.
    userId: text("user_id"),
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
    skipped: integer("skipped", { mode: "boolean" }).notNull(),
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
