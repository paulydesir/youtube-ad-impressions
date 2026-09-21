import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createMessageHandler } from "../src/message-handler.ts";
import type { MessageResponse } from "../src/message-handler.ts";
import { createServerImpressionStore } from "../src/storage/impression-store.ts";
import { sampleImpression } from "./sample-impression.ts";

test("dashboard totals include all 115 records across history pages", async () => {
  const urls: string[] = [];
  const rows = Array.from({ length: 115 }, (_, index) => ({
    eventId: `event-${index}`, startedAt: "2026-09-21T12:00:00.000Z",
    advertiserName: "Example", durationMs: 1000, skipped: index < 15,
  }));
  const cursor = JSON.stringify({ startedAt: rows[99]!.startedAt, eventId: rows[99]!.eventId });
  const store = createServerImpressionStore({
    endpoint: "https://example.com/api/v1/impressions",
    getToken: async () => "test-token",
    fetch: async url => {
      urls.push(String(url));
      return Response.json(new URL(String(url)).searchParams.has("cursor")
        ? { records: rows.slice(100), nextCursor: null }
        : { records: rows.slice(0, 100), nextCursor: cursor });
    },
  });
  const handler = createMessageHandler({
    impressionStore: store,
    watchTimeStore: { addWatchTime: async () => {}, getWatchTime: async () => 3_600_000, setWatchTime: async () => {} },
  });
  const response = await new Promise<MessageResponse>(resolve => handler({ type: "get-dashboard" }, resolve));
  assert.equal(response.ok, true);
  assert.ok("analytics" in response && response.analytics);
  assert.equal(response.analytics.totalImpressions, 115);
  assert.equal(response.analytics.totalAdMs, 115_000);
  assert.equal(response.analytics.skippedCount, 15);
  assert.equal(response.analytics.adsPerWatchHour, 115);
  assert.equal(response.analytics.advertisers[0]!.impressions, 115);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!).searchParams.get("cursor"), cursor);
});

test("a server without pagination cannot silently report a capped total", async () => {
  const store = createServerImpressionStore({
    endpoint: "https://example.com/api/v1/impressions",
    getToken: async () => "test-token",
    fetch: async () => Response.json({ records: Array.from({ length: 100 }, () => ({})) }),
  });
  await assert.rejects(store.getImpressions(), /pagination update/);
});

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
  assert.match(missing.error ?? "", /Sign in to your account/);
  assert.equal(requests.length, 0);

  token = "configured-test-secret";
  assert.deepEqual(await sendRecord(), { ok: true, id: record.event_id });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/v1/impressions");
  assert.equal(request.authorization, `Bearer ${token}`);
  assert.equal((request.body as { event_id: string }).event_id, record.event_id);
  assert.equal(logs.some(message => message.includes(token!)), false);
});

test("active store distinguishes a rejected token from an unreachable server", async () => {
  const store = createServerImpressionStore({
    endpoint: "http://127.0.0.1:8787/api/v1/impressions",
    getToken: async () => "wrong-token",
    fetch: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    info: () => {}, error: () => {},
  });
  await assert.rejects(store.getImpressions(), /session was rejected \(HTTP 401\)/);
  await assert.rejects(store.addImpression(sampleImpression()), /session was rejected \(HTTP 401\)/);
});

test("timed-out writes return a readable error and log once without credentials", async () => {
  const logs: string[] = [];
  let attempts = 0;
  const store = createServerImpressionStore({
    endpoint: "https://example.com/api/v1/impressions",
    getToken: async () => "private-test-token",
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      attempts += 1;
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }),
    error: message => logs.push(message),
  });
  // AbortSignal.timeout uses an unref'd timer in Node.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(store.addImpression(sampleImpression()), /example.com.*did not respond within 0.005 seconds/);
    assert.equal(attempts, 2, "delivery stops after one retry");
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /POST https:\/\/example.com\/api\/v1\/impressions failed/);
    assert.equal(logs[0]!.includes("private-test-token"), false);
    assert.equal(logs[0]!.includes("[object"), false);
  } finally {
    clearTimeout(keepAlive);
  }
});

for (const failure of ["timeout", "network", "gateway", "body-timeout"] as const) {
  test(`POST recovers from ${failure} using the original event ID and body`, async () => {
    const bodies: string[] = [];
    const signals: AbortSignal[] = [];
    const logs: string[] = [];
    const record = sampleImpression();
    const store = createServerImpressionStore({
      endpoint: "https://example.com/api/v1/impressions",
      getToken: async () => "test-token",
      error: message => logs.push(message),
      fetch: async (_url, init) => {
        bodies.push(String(init!.body));
        signals.push(init!.signal!);
        if (bodies.length === 1) {
          if (failure === "network") throw new TypeError("Failed to fetch");
          if (failure === "gateway") return new Response(null, { status: 503 });
          const timeout = new DOMException("The operation timed out", "TimeoutError");
          if (failure === "body-timeout") {
            return new Response(new ReadableStream({ start(controller) { controller.error(timeout); } }));
          }
          throw timeout;
        }
        return Response.json({ event_id: record.event_id, duplicate: true });
      },
    });
    assert.equal(await store.addImpression(record), record.event_id);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(JSON.parse(bodies[1]!).event_id, record.event_id);
    assert.notEqual(signals[0], signals[1], "retry gets a fresh timeout signal");
    assert.deepEqual(logs, [], "recovered failures stay quiet");
  });
}

for (const status of [400, 401, 403, 429]) {
  test(`POST does not retry HTTP ${status}`, async () => {
    let attempts = 0;
    const store = createServerImpressionStore({
      endpoint: "https://example.com/api/v1/impressions",
      getToken: async () => "test-token",
      error: () => {},
      fetch: async () => {
        attempts += 1;
        return Response.json({ error: "rejected" }, { status });
      },
    });
    await assert.rejects(store.addImpression(sampleImpression()), new RegExp(`HTTP ${status}`));
    assert.equal(attempts, 1);
  });
}
