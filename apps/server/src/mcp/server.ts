import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ImpressionStore } from "../repositories/store.js";
import { requireUserId } from "../repositories/tenant.js";
import { getAdTranscript, searchImpressions, getAdvertiserStats, getAdvertiserOverview } from "../services/impressions.js";
import {
  getAdTranscriptInputShape,
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
] as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createMcpServer(store: ImpressionStore, userId: string, log: (message: string) => void = console.info): McpServer {
  requireUserId(userId);
  async function result(name: string, query: () => Promise<Record<string, unknown>>) {
    try {
      const structuredContent = await query();
      log(`MCP tool=${name} outcome=success`);
      return { structuredContent, content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }] };
    } catch {
      log(`MCP tool=${name} outcome=error`);
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
        "Returns observed local data only, newest first.",
      inputSchema: searchAdImpressionsInputSchema,
      outputSchema: searchAdImpressionsOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async filters => result("search_ad_impressions", async () => ({ impressions: await searchImpressions(store, userId, filters) })),
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
    async filters => result("get_advertiser_stats", async () => ({ stats: await getAdvertiserStats(store, userId, filters) })),
  );

  server.registerTool(
    "get_advertiser_overview",
    {
      description:
        "Explain one advertiser: aggregate statistics plus recent observed impressions and the distinct headlines and creative titles actually seen. " +
        "Use when the user names one advertiser and wants a general explanation. Broad names may return an ambiguous status with observed candidate keys. " +
        "Returns observed local data only.",
      inputSchema: getAdvertiserOverviewInputShape,
      outputSchema: getAdvertiserOverviewOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async ({ advertiser }) => result("get_advertiser_overview", async () => ({ ...await getAdvertiserOverview(store, userId, advertiser) })),
  );

  server.registerTool(
    "get_ad_transcript",
    {
      description:
        "Fetch the full Whisper transcript for one YouTube ad video ID, plus transcription metadata and job status. " +
        "Use when the user asks what an ad says or wants to analyze ad content. Returns null transcript when not yet transcribed.",
      inputSchema: getAdTranscriptInputShape,
      outputSchema: getAdTranscriptOutputSchema,
      annotations: { ...READ_ONLY_ANNOTATIONS },
    },
    async ({ adVideoId }) => result("get_ad_transcript", async () => ({
      adVideoId,
      ...(await getAdTranscript(store, adVideoId) ?? {
        transcript: null,
        transcriptLanguage: null,
        transcriptionModel: null,
        transcribedAt: null,
        jobStatus: null,
      }),
    })),
  );

  return server;
}
