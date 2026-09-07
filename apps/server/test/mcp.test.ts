import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import {
  closeDatabase,
  initializeDatabase,
  isDatabaseReady,
  type DatabaseClient,
} from "../src/db/client.js";
import { createApp } from "../src/http/app.js";
import { insertImpression } from "../src/repositories/impressions.js";
import { createSqliteStore } from "../src/repositories/store.js";

const INGEST_TOKEN = "ingest-test-token";
const MCP_TOKEN = "mcp-test-token";

function impression(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    event_id: eventId,
    source: "youtube",
    started_at: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15000,
    host_video_id: "abc123",
    advertiser_name: "coursera.org",
    advertiser_domain: "coursera.org",
    ad_headline: "Save $70+",
    call_to_action: "Start now",
    creative_title: "Coursera: Grow Your Career",
    creative_duration_ms: 15000,
    pod_id: "pod-1",
    pod_label: null,
    pod_position: 1,
    pod_size: 2,
    pod_impression_index: 0,
    skipped: false,
    skip_clicked_at: null,
    end_reason: "completed",
    ...overrides,
  };
}

let db: DatabaseClient;
let httpServer: Server;
let client: Client;
let transport: StreamableHTTPClientTransport;

async function store(input: Record<string, unknown>) {
  const { record, rawJson } = toAdImpressionV1(input);
  await insertImpression(db, record, rawJson);
}

// Coursera acceptance scenario (§17) plus a second advertiser for rankings.
async function seedScenario() {
  await store(impression("evt-c1", { ad_headline: "Save $70+" }));
  await store(
    impression("evt-c2", {
      started_at: "2026-09-02T12:00:00.000Z",
      ad_headline: "Invest in Your Growth",
    }),
  );
  await store(
    impression("evt-g1", {
      advertiser_name: "Granola",
      advertiser_domain: "granola.ai",
      ad_headline: "Get the doing done",
      creative_title: "Granola ad",
      skipped: true,
      started_at: "2026-09-03T12:00:00.000Z",
    }),
  );
}

async function startMcpClient(): Promise<Client> {
  const app = createApp({
    store: createSqliteStore(db),
    isDatabaseReady: () => Promise.resolve(isDatabaseReady(db)),
    ingestToken: INGEST_TOKEN,
    mcpToken: MCP_TOKEN,
  });
  httpServer = createServer(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  const nextClient = new Client({ name: "mcp-test-client", version: "0.0.0" });
  transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } } },
  );
  await nextClient.connect(transport);
  client = nextClient;
  return nextClient;
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "ad-impressions-mcp-"));
  db = initializeDatabase(join(dir, "test.sqlite"));
  await seedScenario();
  await startMcpClient();
});

afterEach(async () => {
  try {
    await client?.close();
  } catch {
    // Already closed.
  }
  try {
    await transport?.close();
  } catch {
    // Already closed.
  }
  if (httpServer !== undefined) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
  closeDatabase(db);
});

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  assert.ok(result.structuredContent !== undefined, "expected structured content");
  return result.structuredContent as Record<string, unknown>;
}

describe("MCP tools", () => {
  it("lists exactly the three read-only tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["get_advertiser_overview", "get_advertiser_stats", "search_ad_impressions"],
    );
    for (const tool of tools) {
      assert.ok(
        typeof tool.description === "string" && tool.description.length > 0,
        `${tool.name} should describe when to use it`,
      );
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.ok(tool.inputSchema !== undefined, `${tool.name} needs an input schema`);
    }
  });

  it("retrieves Coursera observations via search_ad_impressions", async () => {
    const result = await client.callTool({
      name: "search_ad_impressions",
      arguments: { advertiser: "coursera" },
    });
    assert.equal(result.isError, undefined);
    const body = structured(result);
    const impressions = body["impressions"] as Record<string, unknown>[];
    assert.equal(impressions.length, 2);
    assert.deepEqual(
      impressions.map((row) => row["adHeadline"]).sort(),
      ["Invest in Your Growth", "Save $70+"],
    );
    assert.ok(impressions.every((row) => !("rawJson" in row && "raw_json" in row)));
    assert.ok(impressions.every((row) => !("rawJson" in row)));
    assert.ok(impressions.every((row) => !("id" in row)));
  });

  it("treats Inspector's empty terms object as an omitted optional filter", async () => {
    const result = await client.callTool({
      name: "search_ad_impressions",
      arguments: { advertiser: "coursera", terms: {} },
    });

    assert.equal(result.isError, undefined);
    assert.equal((structured(result)["impressions"] as unknown[]).length, 2);
  });

  it("answers frequency questions via get_advertiser_stats", async () => {
    const result = await client.callTool({ name: "get_advertiser_stats", arguments: {} });
    assert.equal(result.isError, undefined);
    const body = structured(result);
    const stats = body["stats"] as Record<string, unknown>[];
    assert.equal(stats[0]?.["advertiser"], "coursera.org");
    assert.equal(stats[0]?.["impressionCount"], 2);
    assert.equal(stats[0]?.["skipRate"], 0);
    assert.equal(stats[1]?.["advertiser"], "granola.ai");
  });

  it("answers single-advertiser questions via get_advertiser_overview", async () => {
    const result = await client.callTool({
      name: "get_advertiser_overview",
      arguments: { advertiser: "Coursera" },
    });
    assert.equal(result.isError, undefined);
    const body = structured(result);
    assert.equal(body["status"], "found");
    assert.equal(body["advertiser"], "coursera.org");
    const stats = body["stats"] as Record<string, unknown>;
    assert.equal(stats["impressionCount"], 2);
    assert.equal((body["recent"] as unknown[]).length, 2);
    assert.deepEqual(body["headlines"], ["Invest in Your Growth", "Save $70+"]);
    assert.deepEqual(body["creativeTitles"], ["Coursera: Grow Your Career"]);
    assert.ok(!("rawJson" in (body["recent"] as Record<string, unknown>[])[0]!));
  });

  it("returns empty data for an unknown advertiser", async () => {
    const result = await client.callTool({
      name: "get_advertiser_overview",
      arguments: { advertiser: "nobody" },
    });
    const body = structured(result);
    assert.equal(body["status"], "not_found");
    assert.deepEqual(body["candidates"], []);
    assert.equal(body["stats"], null);
    assert.deepEqual(body["recent"], []);
    assert.deepEqual(body["headlines"], []);
  });

  it("enforces result limits server-side", async () => {
    const limited = await client.callTool({
      name: "search_ad_impressions",
      arguments: { limit: 1 },
    });
    assert.equal((structured(limited)["impressions"] as unknown[]).length, 1);
    const ranked = await client.callTool({
      name: "get_advertiser_stats",
      arguments: { limit: 1 },
    });
    assert.equal((structured(ranked)["stats"] as unknown[]).length, 1);
  });

  it("returns ambiguity instead of combining multiple advertiser keys", async () => {
    await store(
      impression("evt-google", {
        advertiser_name: "Google Search",
        advertiser_domain: "google.com",
        creative_title: "Search creative",
      }),
    );
    await store(
      impression("evt-cloud", {
        advertiser_name: "Google Cloud",
        advertiser_domain: "cloud.google.com",
        creative_title: "Cloud creative",
      }),
    );

    const result = await client.callTool({
      name: "get_advertiser_overview",
      arguments: { advertiser: "google" },
    });
    const body = structured(result);
    assert.equal(body["status"], "ambiguous");
    assert.deepEqual(
      (body["candidates"] as string[]).sort(),
      ["cloud.google.com", "google.com"],
    );
    assert.equal(body["stats"], null);
    assert.deepEqual(body["recent"], []);
  });

  it("validates date ranges and normalizes offsets to UTC", async () => {
    const invalid = await client.callTool({
      name: "search_ad_impressions",
      arguments: { from: "yesterday" },
    });
    const reversed = await client.callTool({
      name: "get_advertiser_stats",
      arguments: {
        from: "2026-09-03T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      },
    });
    const normalized = await client.callTool({
      name: "search_ad_impressions",
      arguments: {
        advertiser: "coursera",
        from: "2026-09-01T08:00:00-04:00",
        to: "2026-09-01T08:00:01-04:00",
      },
    });

    assert.equal(invalid.isError, true);
    assert.equal(reversed.isError, true);
    assert.equal(
      (structured(normalized)["impressions"] as unknown[]).length,
      1,
    );
  });

  it("rejects calls to unknown tools", async () => {
    const result = await client.callTool({ name: "run_sql", arguments: {} });
    assert.equal(result.isError, true);
  });
});

describe("MCP transport", () => {
  it("requires the dedicated MCP bearer token", async () => {
    const { port } = httpServer.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    const unauthorized = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const wrongToken = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INGEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    assert.equal(unauthorized.status, 401);
    assert.equal(wrongToken.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");
  });

  it("rejects GET /mcp with 405 in stateless mode", async () => {
    const { port } = httpServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { Authorization: `Bearer ${MCP_TOKEN}` },
    });
    assert.equal(response.status, 405);
  });
});
