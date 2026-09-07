import assert from "node:assert/strict";
import test from "node:test";
import {
  createImpressionApiClient,
  LOCAL_SERVER_ENDPOINT,
} from "../src/api/impression-api-client.ts";
import { toAdImpressionV1 } from "../src/api/impression-mapper.ts";
import { sampleImpression } from "./sample-impression.ts";

test("posts the canonical record with the configured bearer token", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const messages: string[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 201 });
  };
  const send = createImpressionApiClient({
    getToken: async () => "test-token",
    fetch: fetchStub,
    info: (message) => messages.push(message),
  });

  const canonical = await toAdImpressionV1(sampleImpression());
  await send(canonical);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, LOCAL_SERVER_ENDPOINT);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(requests[0]?.init?.headers, {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(requests[0]?.init?.body));
  assert.equal(body.schema_version, 1);
  assert.equal(body.ad_headline, "Save $70+");
  assert.deepEqual(messages, [
    `[YouTube Ad Impressions] forwarding impression ${body.event_id}`,
    `[YouTube Ad Impressions] forwarded impression ${body.event_id} (HTTP 201)`,
  ]);
});

test("repeated delivery reuses the event ID for server idempotency", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchStub: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 200 });
  };
  const send = createImpressionApiClient({
    getToken: async () => "test-token",
    fetch: fetchStub,
  });
  const canonical = await toAdImpressionV1(sampleImpression());

  await send(canonical);
  await send(canonical);

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]?.["event_id"], bodies[1]?.["event_id"]);
});

test("offline delivery is quiet after one concise diagnostic", async () => {
  const warnings: string[] = [];
  const fetchStub: typeof fetch = async () => {
    throw new Error("connection refused");
  };
  const send = createImpressionApiClient({
    getToken: async () => "test-token",
    fetch: fetchStub,
    warn: (message) => warnings.push(message),
  });

  await send(await toAdImpressionV1(sampleImpression()));
  await send(
    await toAdImpressionV1(
      sampleImpression({ timestamp: "2026-09-02T12:00:00.000Z" }),
    ),
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /local forwarding unavailable: connection refused/);
});

test("aborts a server request after the configured short timeout", async () => {
  const warnings: string[] = [];
  const fetchStub: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("request aborted")),
      );
    });
  const send = createImpressionApiClient({
    getToken: async () => "test-token",
    fetch: fetchStub,
    timeoutMs: 5,
    warn: (message) => warnings.push(message),
  });

  await send(await toAdImpressionV1(sampleImpression()));

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /request aborted/);
});

test("a missing token disables forwarding without a request or warning", async () => {
  let requests = 0;
  const messages: string[] = [];
  const warnings: string[] = [];
  const send = createImpressionApiClient({
    getToken: async () => null,
    fetch: async () => {
      requests += 1;
      return new Response(null, { status: 201 });
    },
    info: (message) => messages.push(message),
    warn: (message) => warnings.push(message),
  });

  await send(await toAdImpressionV1(sampleImpression()));
  await send(await toAdImpressionV1(sampleImpression()));

  assert.equal(requests, 0);
  assert.deepEqual(messages, [
    "[YouTube Ad Impressions] local forwarding disabled: set localServerIngestToken",
  ]);
  assert.deepEqual(warnings, []);
});
