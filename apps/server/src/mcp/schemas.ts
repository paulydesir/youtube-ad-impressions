import { z } from "zod";

const isoDateTime = z.iso
  .datetime({ offset: true })
  .describe("UTC or offset ISO-8601 date-time.");

// Narrow input schemas for the three read-only MCP tools. Limits are enforced
// here (max 100) and again in the repository layer, which clamps and defaults.
export const searchAdImpressionsInputSchema = z
  .object({
    advertiser: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring match against observed advertiser name and domain.",
      ),
    terms: z
      .preprocess(
        (value) => {
          if (value === undefined || value === null) return undefined;
          if (typeof value === "string") return value.trim() ? [value] : undefined;
          if (Array.isArray(value)) return value;
          // Some Inspector form states submit empty objects or keyed objects
          // (e.g. {} or {"0": "foo"}) instead of arrays.
          if (typeof value === "object") {
            const values = Object.values(value as Record<string, unknown>).filter(
              (entry): entry is string => typeof entry === "string",
            );
            return values.length > 0 ? values : undefined;
          }
          return value;
        },
        z.array(z.string()).optional(),
      )
      .describe(
        "Case-insensitive lexical match (OR semantics) across advertiser, headline, CTA, and creative title.",
      ),
    from: isoDateTime
      .optional()
      .describe("Inclusive lower bound for started_at as a UTC ISO-8601 string."),
    to: isoDateTime
      .optional()
      .describe("Inclusive upper bound for started_at as a UTC ISO-8601 string."),
    skipped: z
      .boolean()
      .optional()
      .describe("Filter by skip behavior when present."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum impressions to return (default 20, max 100)."),
  })
  .superRefine((filters, context) => {
    if (
      filters.from !== undefined &&
      filters.to !== undefined &&
      new Date(filters.from).getTime() > new Date(filters.to).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be at or after from",
      });
    }
  });

export const getAdvertiserStatsInputSchema = z
  .object({
    advertiser: z
      .string()
      .optional()
      .describe(
        "Optional case-insensitive substring match against observed advertiser name and domain.",
      ),
    from: isoDateTime
      .optional()
      .describe("Inclusive lower bound for started_at as a UTC ISO-8601 string."),
    to: isoDateTime
      .optional()
      .describe("Inclusive upper bound for started_at as a UTC ISO-8601 string."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum advertisers to return (default 50, max 100)."),
  })
  .superRefine((filters, context) => {
    if (
      filters.from !== undefined &&
      filters.to !== undefined &&
      new Date(filters.from).getTime() > new Date(filters.to).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "to must be at or after from",
      });
    }
  });

export const getAdvertiserOverviewInputShape = {
  advertiser: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Advertiser name or domain to look up (case-insensitive substring match against observed data).",
    ),
};

export type SearchAdImpressionsInput = z.infer<
  typeof searchAdImpressionsInputSchema
>;

export type GetAdvertiserStatsInput = z.infer<
  typeof getAdvertiserStatsInputSchema
>;

export type GetAdvertiserOverviewInput = {
  advertiser: string;
};

// Structured output schemas. Compact impression rows deliberately exclude
// raw_json, avatar URLs, and player metadata — those never leave the database.
const impressionSchema = z.object({
  eventId: z.string(),
  schemaVersion: z.number(),
  source: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  hostVideoId: z.string().nullable(),
  advertiserName: z.string().nullable(),
  advertiserDomain: z.string().nullable(),
  adHeadline: z.string().nullable(),
  callToAction: z.string().nullable(),
  creativeTitle: z.string().nullable(),
  creativeDurationMs: z.number().nullable(),
  podId: z.string().nullable(),
  podLabel: z.string().nullable(),
  podPosition: z.number().nullable(),
  podSize: z.number().nullable(),
  podImpressionIndex: z.number().nullable(),
  skipped: z.boolean(),
  skipClickedAt: z.string().nullable(),
  endReason: z.string().nullable(),
  ingestedAt: z.string(),
});

const advertiserStatsSchema = z.object({
  advertiser: z.string(),
  impressionCount: z.number(),
  totalDurationMs: z.number(),
  skippedCount: z.number(),
  skipRate: z.number(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});

export const searchAdImpressionsOutputSchema = z.object({
  impressions: z.array(impressionSchema),
});

export const getAdvertiserStatsOutputSchema = z.object({
  stats: z.array(advertiserStatsSchema),
});

export const getAdvertiserOverviewOutputSchema = z.object({
  status: z.enum(["found", "not_found", "ambiguous"]),
  query: z.string(),
  advertiser: z.string().nullable(),
  candidates: z.array(z.string()),
  stats: advertiserStatsSchema.nullable(),
  recent: z.array(impressionSchema),
  headlines: z.array(z.string()),
  creativeTitles: z.array(z.string()),
});
