import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ImpressionStore } from "../repositories/store.js";
import { requireUserId } from "../repositories/tenant.js";
import { getAdTranscripts, getAdTranscript, searchImpressions, getAdvertiserStats, getAdvertiserOverview } from "../services/impressions.js";
import {
  getAdTranscriptsInputSchema,
  getAdTranscriptsOutputSchema,
  getAdTranscriptInputSchema,
  getAdTranscriptOutputSchema,
  getAdvertiserOverviewInputShape,
  getAdvertiserOverviewOutputSchema,
  getAdvertiserStatsInputSchema,
  getAdvertiserStatsOutputSchema,
  searchAdImpressionsInputSchema,
  searchAdImpressionsOutputSchema,
} from "./schemas.js";

export const MCP_TOOL_NAMES = [
  "search_ad_impressions",
  "get_advertiser_stats",
  "get_advertiser_overview",
  "get_ad_transcript",
  "get_ad_transcripts",
] as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createMcpServer(store: ImpressionStore, userId: string): McpServer {
  requireUserId(userId);
  async function result(query: () => Promise<Record<string, unknown>>) {
    try {
      const structuredContent = await query();
      return { structuredContent, content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Unable to load impressions. Please try again." }] };
    }
  }
  const server = new McpServer(
    { name: "youtube-ad-impressions", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "search_ad_impressions",
    {
      description:
        "Search individual observed ad impressions by advertiser, keywords, date range, and skip behavior. " +
        "Use when the user asks about individual ads, promotions, headlines, timing, or skip behavior. " +
        "Returns observed local data only, newest first. Pass an impression’s adId to get_ad_transcript to learn what the ad says, or pass up to 50 adIds to get_ad_transcripts.",
      inputSchema: searchAdImpressionsInputSchema,
      outputSchema: searchAdImpressionsOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async filters => result(async () => ({ impressions: await searchImpressions(store, userId, filters) })),
  );

  server.registerTool(
    "get_advertiser_stats",
    {
      description:
        "Rank advertisers by observed impression frequency with counts, total watch time, skip counts, and skip rates. " +
        "Use when the user asks which advertisers appear most frequently or requests counts, rankings, or rates. " +
        "Returns observed local data only.",
      inputSchema: getAdvertiserStatsInputSchema,
      outputSchema: getAdvertiserStatsOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async filters => result(async () => ({ stats: await getAdvertiserStats(store, userId, filters) })),
  );

  server.registerTool(
    "get_advertiser_overview",
    {
      description:
        "Explain one advertiser: aggregate statistics plus recent observed impressions and the distinct headlines and creative titles actually seen. " +
        "Use when the user names one advertiser and wants a general explanation. Broad names may return an ambiguous status with observed candidate keys. " +
        "Returns observed local data only. Pass a recent impression’s adId to get_ad_transcript to read its content, or use get_ad_transcripts for multiple ads.",
      inputSchema: getAdvertiserOverviewInputShape,
      outputSchema: getAdvertiserOverviewOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async ({ advertiser }) => result(async () => ({ ...await getAdvertiserOverview(store, userId, advertiser) })),
  );

  server.registerTool(
    "get_ad_transcript",
    {
      description:
        "Read an ad from the ads table using an impression’s adId (preferred), or adVideoId, plus its full transcript, transcription metadata and job status. " +
        "Provide exactly one ID. Use after search_ad_impressions or get_advertiser_overview to understand what an ad says or promotes. " +
        "Only ads in your observed history are accessible. A found ad with a null transcript is not yet transcribed; check jobStatus.",
      inputSchema: getAdTranscriptInputSchema,
      outputSchema: getAdTranscriptOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async ({ adId, adVideoId }) => result(async () => {
      const lookup = adId !== undefined ? { adId } : { adVideoId: adVideoId! };
      const ad = await getAdTranscript(store, userId, lookup);
      return ad ? { status: "found", ...ad } : {
        status: "not_found",
        adId: adId ?? null,
        adVideoId: adVideoId ?? null,
        source: null,
        transcript: null,
        transcriptLanguage: null,
        transcriptionModel: null,
        transcribedAt: null,
        jobStatus: null,
      };
    }),
  );

  server.registerTool(
    "get_ad_transcripts",
    {
      description:
        "Read full transcripts and transcription metadata for 1–50 ad IDs from search_ad_impressions or get_advertiser_overview. " +
        "Use to compare or summarize multiple ads in one call. Returns one result per ID in input order, including duplicates. " +
        "Only ads in your observed history are accessible; missing or inaccessible IDs return not_found. " +
        "A found ad with a null transcript is not yet transcribed; check jobStatus.",
      inputSchema: getAdTranscriptsInputSchema,
      outputSchema: getAdTranscriptsOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async ({ adIds }) => result(async () => ({ transcripts: await getAdTranscripts(store, userId, adIds) })),
  );

  return server;
}
