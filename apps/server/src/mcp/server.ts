import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseClient } from "../db/client.js";
import {
  getAdvertiserOverview,
  getAdvertiserStats,
  searchImpressions,
} from "../services/impressions.js";
import {
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
] as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Builds a server with exactly three read-only tools over observed local ad
// data. Handlers call the structured query services only: no web search, no
// SQL, no writes. Limits are enforced by the Zod input schemas (max 100) and
// again by the repository layer.
export function createMcpServer(db: DatabaseClient): McpServer {
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
    async (args) => {
      const impressions = await searchImpressions(db, {
        advertiser: args.advertiser,
        terms: args.terms,
        from: args.from === undefined ? undefined : new Date(args.from).toISOString(),
        to: args.to === undefined ? undefined : new Date(args.to).toISOString(),
        skipped: args.skipped,
        limit: args.limit,
      });
      const output = { impressions };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
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
    async (args) => {
      const stats = await getAdvertiserStats(db, {
        advertiser: args.advertiser,
        from: args.from === undefined ? undefined : new Date(args.from).toISOString(),
        to: args.to === undefined ? undefined : new Date(args.to).toISOString(),
        limit: args.limit,
      });
      const output = { stats };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
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
    async (args) => {
      const overview = await getAdvertiserOverview(db, args.advertiser);
      const output = {
        status: overview.status,
        query: overview.query,
        advertiser: overview.advertiser,
        candidates: overview.candidates,
        stats: overview.stats,
        recent: overview.recent,
        headlines: overview.headlines,
        creativeTitles: overview.creativeTitles,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  return server;
}
