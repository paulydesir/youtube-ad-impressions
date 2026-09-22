import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { ImpressionStore } from "../src/repositories/store.js";

const adId = "fa3951f6-7d34-4de6-a644-b96b86fbba28";
const userId = "9c3f24dd-50ab-4f8c-a389-a860dd3053ae";
const transcript = {
  adId, source: "youtube", adVideoId: "video-123", transcript: "Try our new running shoes.",
  transcriptLanguage: "en", transcriptionModel: "whisper", transcribedAt: "2026-09-22T12:00:00.000Z", jobStatus: "completed",
};
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

async function setup() {
  const getAdTranscript = vi.fn<ImpressionStore["getAdTranscript"]>().mockResolvedValue(transcript);
  const getAdTranscripts = vi.fn<ImpressionStore["getAdTranscripts"]>().mockResolvedValue([transcript]);
  const server = createMcpServer({ getAdTranscript, getAdTranscripts } as unknown as ImpressionStore, userId);
  const client = new Client({ name: "transcript-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(() => client.close(), () => server.close());
  return { client, getAdTranscript, getAdTranscripts };
}

it("advertises adId lookup and returns the linked transcript as structured content", async () => {
  const { client, getAdTranscript } = await setup();
  const listed = await client.listTools();
  const tool = listed.tools.find(tool => tool.name === "get_ad_transcript")!;
  expect(tool.inputSchema.properties).toHaveProperty("adId");
  expect(tool.annotations?.readOnlyHint).toBe(true);
  const result = await client.callTool({ name: "get_ad_transcript", arguments: { adId } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ status: "found", ...transcript });
  expect(getAdTranscript).toHaveBeenCalledExactlyOnceWith(userId, { adId });
});

it("retains video ID lookup and scopes it to the authenticated user", async () => {
  const { client, getAdTranscript } = await setup();
  const result = await client.callTool({ name: "get_ad_transcript", arguments: { adVideoId: " video-123 " } });
  expect(result.structuredContent).toEqual({ status: "found", ...transcript });
  expect(getAdTranscript).toHaveBeenCalledExactlyOnceWith(userId, { adVideoId: "video-123" });
});

it("distinguishes a pending transcript from an absent or inaccessible ad", async () => {
  const { client, getAdTranscript } = await setup();
  getAdTranscript.mockResolvedValueOnce({ ...transcript, transcript: null, transcribedAt: null, jobStatus: "pending" });
  const pending = await client.callTool({ name: "get_ad_transcript", arguments: { adId } });
  expect(pending.structuredContent).toMatchObject({ status: "found", transcript: null, jobStatus: "pending" });
  getAdTranscript.mockResolvedValueOnce(null);
  const missing = await client.callTool({ name: "get_ad_transcript", arguments: { adId } });
  expect(missing.structuredContent).toMatchObject({ status: "not_found", adId, transcript: null, jobStatus: null });
});

it("rejects missing, conflicting and malformed IDs before querying the store", async () => {
  const { client, getAdTranscript } = await setup();
  for (const args of [{}, { adId, adVideoId: "video-123" }, { adId: "bad" }, { adVideoId: " " }]) {
    const result = await client.callTool({ name: "get_ad_transcript", arguments: args });
    expect(result.isError).toBe(true);
  }
  expect(getAdTranscript).not.toHaveBeenCalled();
});

it("does not expose database errors to clients", async () => {
  const { client, getAdTranscript } = await setup();
  getAdTranscript.mockRejectedValueOnce(new Error("private database details"));
  const result = await client.callTool({ name: "get_ad_transcript", arguments: { adId } });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private database details");
});

it("advertises bulk retrieval and preserves order, duplicates and missing results", async () => {
  const { client, getAdTranscripts, getAdTranscript } = await setup();
  const pendingId = "ab3951f6-7d34-4de6-a644-b96b86fbba28";
  const missingId = "bc3951f6-7d34-4de6-a644-b96b86fbba28";
  const pending = { ...transcript, adId: pendingId, transcript: null, jobStatus: "pending", transcribedAt: null };
  getAdTranscripts.mockResolvedValueOnce([transcript, pending]);
  const listed = await client.listTools();
  const tool = listed.tools.find(tool => tool.name === "get_ad_transcripts")!;
  expect(tool.inputSchema.properties).toHaveProperty("adIds");
  expect(tool.annotations?.readOnlyHint).toBe(true);
  const adIds = [pendingId, missingId, adId.toUpperCase(), adId];
  const result = await client.callTool({ name: "get_ad_transcripts", arguments: { adIds } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ transcripts: [
    { status: "found", ...pending },
    { status: "not_found", adId: missingId, source: null, adVideoId: null, transcript: null,
      transcriptLanguage: null, transcriptionModel: null, transcribedAt: null, jobStatus: null },
    { status: "found", ...transcript }, { status: "found", ...transcript },
  ] });
  expect(getAdTranscripts).toHaveBeenCalledExactlyOnceWith(userId, adIds);
  expect(getAdTranscript).not.toHaveBeenCalled();
});

it("validates batch boundaries and IDs before querying", async () => {
  const { client, getAdTranscripts } = await setup();
  for (const args of [{}, { adIds: [] }, { adIds: ["bad"] }, { adIds: [adId, null] },
    { adIds: adId }, { adIds: Array(51).fill(adId) }]) {
    expect((await client.callTool({ name: "get_ad_transcripts", arguments: args })).isError).toBe(true);
  }
  expect(getAdTranscripts).not.toHaveBeenCalled();
  const result = await client.callTool({ name: "get_ad_transcripts", arguments: { adIds: Array(50).fill(adId) } });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ transcripts: Array(50).fill({ status: "found", ...transcript }) });
});

it("handles an entirely missing batch and hides query failures", async () => {
  const { client, getAdTranscripts } = await setup();
  getAdTranscripts.mockResolvedValueOnce([]);
  const result = await client.callTool({ name: "get_ad_transcripts", arguments: { adIds: [adId] } });
  expect(result.structuredContent).toMatchObject({ transcripts: [{ status: "not_found", adId }] });
  getAdTranscripts.mockRejectedValueOnce(new Error("private database details"));
  const failure = await client.callTool({ name: "get_ad_transcripts", arguments: { adIds: [adId] } });
  expect(failure.isError).toBe(true);
  expect(JSON.stringify(failure)).not.toContain("private database details");
});
