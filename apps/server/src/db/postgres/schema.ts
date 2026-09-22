import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Supabase owns profile creation through its auth.users trigger. This minimal
// declaration exists only so application tables can reference public.profiles.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
});

export const ads = pgTable(
  "ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceAdId: text("source_ad_id").notNull(),
    transcript: text("transcript"),
    transcriptLanguage: text("transcript_language"),
    transcriptionModel: text("transcription_model"),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ads_source_source_ad_id_unique").on(table.source, table.sourceAdId),
  ],
);

export const transcriptionJobs = pgTable(
  "transcription_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transcription_jobs_ad_id_unique").on(table.adId),
    index("transcription_jobs_status_idx").on(table.status),
  ],
);

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
    adVideoId: text("ad_video_id"),
    adId: uuid("ad_id").references(() => ads.id, { onDelete: "set null" }),
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
    index("ad_impressions_ad_id_idx").on(table.adId),
    index("ad_impressions_ad_video_id_idx").on(table.adVideoId),
  ],
);

export type AdImpressionRow = typeof adImpressions.$inferSelect;
export type NewAdImpressionRow = typeof adImpressions.$inferInsert;
export type AdRow = typeof ads.$inferSelect;
export type TranscriptionJobRow = typeof transcriptionJobs.$inferSelect;
