import { z } from "zod";

export const adImpressionV1Schema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  source: z.literal("youtube"),
  adVideoId: z.string().optional(),
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
  advertiser_url: z.string().nullable().optional(),
  skip_available: z.boolean().nullable().optional(),
  muted: z.boolean().nullable().optional(),
  playback_rate: z.number().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  player_version: z.string().nullable().optional(),
});

export type AdImpressionV1 = z.infer<typeof adImpressionV1Schema>;

export function toAdImpressionV1(input: unknown): {
  record: AdImpressionV1;
  rawJson: string;
} {
  return { record: adImpressionV1Schema.parse(input), rawJson: JSON.stringify(input) };
}
