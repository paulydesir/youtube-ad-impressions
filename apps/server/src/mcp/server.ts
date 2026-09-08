import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ImpressionStore } from "../repositories/store.js";
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
export function createMcpServer(_store: ImpressionStore, _log: (message: string) => void = console.info): McpServer {
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
    async () => ({
      isError: true,
      content: [{ type: "text" as const, text: "Tenant authentication required. Impression tools are temporarily unavailable with the shared MCP token." }],
    }),
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
    async () => ({
      isError: true,
      content: [{ type: "text" as const, text: "Tenant authentication required. Impression tools are temporarily unavailable with the shared MCP token." }],
    }),
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
    async () => ({
      isError: true,
      content: [{ type: "text" as const, text: "Tenant authentication required. Impression tools are temporarily unavailable with the shared MCP token." }],
    }),
  );

  return server;
}
