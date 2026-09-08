import { MCP_TOOL_NAMES } from "../src/mcp/server.js";
const TEST_USER = "9c3f24dd-50ab-4f8c-a389-a860dd3053ae";
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
  await insertImpression(db, TEST_USER, record, rawJson);
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
    verifyAccessToken: async token => {
      if (token !== INGEST_TOKEN) throw new Error("Invalid token");
      return { userId: "9c3f24dd-50ab-4f8c-a389-a860dd3053ae", email: "test@example.com" };
    },
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

describe("MCP tools", () => {
  it("lists tools but refuses user-data access until tenant authentication exists", async () => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...MCP_TOOL_NAMES].sort());
    for (const name of MCP_TOOL_NAMES) {
      const result = await client.callTool({ name, arguments: name === "get_advertiser_overview" ? { advertiser: "coursera" } : {} });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /Tenant authentication required/);
      assert.equal(result.structuredContent, undefined);
    }
  });
  it("rejects unknown tools", async () => {
    assert.equal((await client.callTool({ name: "run_sql", arguments: {} })).isError, true);
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
