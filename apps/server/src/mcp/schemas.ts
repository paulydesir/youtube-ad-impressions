import { z } from "zod";

// Narrow input schemas for the three read-only MCP tools. Limits are enforced
// here (max 100) and again in the repository layer, which clamps and defaults.
export const searchAdImpressionsInputShape = {
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
  from: z
    .string()
    .optional()
    .describe("Inclusive lower bound for started_at as a UTC ISO-8601 string."),
  to: z
    .string()
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
};

export const getAdvertiserStatsInputShape = {
  advertiser: z
    .string()
    .optional()
    .describe(
      "Optional case-insensitive substring match against observed advertiser name and domain.",
    ),
  from: z
    .string()
    .optional()
    .describe("Inclusive lower bound for started_at as a UTC ISO-8601 string."),
  to: z
    .string()
    .optional()
    .describe("Inclusive upper bound for started_at as a UTC ISO-8601 string."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum advertisers to return (default 50, max 100)."),
};

export const getAdvertiserOverviewInputShape = {
  advertiser: z
    .string()
    .min(1)
    .describe(
      "Advertiser name or domain to look up (case-insensitive substring match against observed data).",
    ),
};

export type SearchAdImpressionsInput = {
  advertiser?: string;
  terms?: string[];
  from?: string;
  to?: string;
  skipped?: boolean;
  limit?: number;
};

export type GetAdvertiserStatsInput = {
  advertiser?: string;
  from?: string;
  to?: string;
  limit?: number;
};

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
  stats: advertiserStatsSchema.nullable(),
  recent: z.array(impressionSchema),
  headlines: z.array(z.string()),
  creativeTitles: z.array(z.string()),
});
