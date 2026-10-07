import { z } from "zod";

export const adImpressionV1Schema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  source: z.enum(["youtube", "manual"]),
  source_url: z.url({ protocol: /^https?$/ }).max(2048).nullable().optional(),
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
}).superRefine((record, context) => {
  if (record.source !== "manual") return;
  if (!record.advertiser_name?.trim() || record.advertiser_name.length > 200) {
    context.addIssue({ code: "custom", path: ["advertiser_name"], message: "Enter an advertiser (up to 200 characters)." });
  }
  if (!record.ad_headline?.trim() || record.ad_headline.length > 10000) {
    context.addIssue({ code: "custom", path: ["ad_headline"], message: "Enter offer details (up to 10,000 characters)." });
  }
  if (record.adVideoId !== undefined) {
    context.addIssue({ code: "custom", path: ["adVideoId"], message: "Manual impressions must not create a video ad." });
  }
});

export type AdImpressionV1 = z.infer<typeof adImpressionV1Schema>;

export function toAdImpressionV1(input: unknown): {
  record: AdImpressionV1;
  rawJson: string;
} {
  return { record: adImpressionV1Schema.parse(input), rawJson: JSON.stringify(input) };
}
