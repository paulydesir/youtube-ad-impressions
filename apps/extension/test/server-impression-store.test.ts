import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createMessageHandler } from "../src/message-handler.ts";
import type { MessageResponse } from "../src/message-handler.ts";
import { createServerImpressionStore } from "../src/storage/impression-store.ts";
import { sampleImpression } from "./sample-impression.ts";

test("active worker write path makes a real HTTP POST once the token is configured", async t => {
  let token: string | null = null;
  const requests: Array<{ method?: string; url?: string; authorization?: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { event_id: string };
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ event_id: body.event_id, duplicate: false }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const logs: string[] = [];
  const store = createServerImpressionStore({
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/impressions`,
    getToken: async () => token,
    info: message => logs.push(message),
    error: message => logs.push(message),
  });
  const handler = createMessageHandler({
    impressionStore: store,
    watchTimeStore: { addWatchTime: async () => {}, getWatchTime: async () => 0, setWatchTime: async () => {} },
  });
  const record = sampleImpression();
  const sendRecord = () => new Promise<MessageResponse>(resolve => {
    assert.equal(handler({ type: "record-impression", record }, resolve), true);
  });

  const missing = await sendRecord();
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? "", /token is missing/);
  assert.equal(requests.length, 0);

  token = "configured-test-secret";
  assert.deepEqual(await sendRecord(), { ok: true, id: record.event_id });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.url, "/api/v1/impressions");
  assert.equal(requests[0]?.authorization, `Bearer ${token}`);
  assert.equal((requests[0]?.body as { event_id: string }).event_id, record.event_id);
  assert.equal(logs.some(message => message.includes(token!)), false);
});

test("active store distinguishes a rejected token from an unreachable server", async () => {
  const store = createServerImpressionStore({
    endpoint: "http://127.0.0.1:8787/api/v1/impressions",
    getToken: async () => "wrong-token",
    fetch: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    info: () => {}, error: () => {},
  });
  await assert.rejects(store.getImpressions(), /rejected the API token \(HTTP 401\)/);
  await assert.rejects(store.addImpression(sampleImpression()), /rejected the API token \(HTTP 401\)/);
});
