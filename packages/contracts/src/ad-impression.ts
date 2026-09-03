import { z } from "zod";

// Canonical input contract for one completed ad impression.
// This is the wire shape the extension sends and the server ingests.
// Timestamps are UTC ISO-8601 strings; durations are milliseconds.
export const adImpressionV1Schema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  source: z.literal("youtube"),
  started_at: z.iso.datetime({ offset: true }),
  ended_at: z.iso.datetime({ offset: true }).nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  host_video_id: z.string().nullable(),
  advertiser_name: z.string().nullable(),
  advertiser_domain: z.string().nullable(),
  ad_headline: z.string().nullable(),
  call_to_action: z.string().nullable(),
  creative_title: z.string().nullable(),
  creative_duration_ms: z.number().int().nonnegative().nullable(),
  pod_id: z.string().min(1),
  pod_label: z.string().nullable(),
  pod_position: z.number().int().nullable(),
  pod_size: z.number().int().nullable(),
  pod_impression_index: z.number().int().nonnegative(),
  skipped: z.boolean(),
  skip_clicked_at: z.iso.datetime({ offset: true }).nullable(),
  end_reason: z.string().nullable(),
  // Extra fields the extension already captures. Accepted here so nothing
  // is rejected; they are preserved verbatim in `raw_json`, not columns.
  advertiser_url: z.string().nullable().optional(),
  skip_available: z.boolean().nullable().optional(),
  muted: z.boolean().nullable().optional(),
  playback_rate: z.number().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  player_version: z.string().nullable().optional(),
});

export type AdImpressionV1 = z.infer<typeof adImpressionV1Schema>;

// Validates one record and preserves the original input verbatim so unknown
// or future fields are never lost — the server stores it as `raw_json`.
// Throws a ZodError on invalid input.
export function toAdImpressionV1(input: unknown): {
  record: AdImpressionV1;
  rawJson: string;
} {
  return { record: adImpressionV1Schema.parse(input), rawJson: JSON.stringify(input) };
}
