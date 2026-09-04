import assert from "node:assert/strict";
import test from "node:test";
import { adImpressionV1Schema } from "@ad-impressions/contracts";
import {
  createCompanionForwarder,
  LOCAL_SERVER_ENDPOINT,
  persistThenForward,
  toAdImpressionV1,
} from "../src/server-forwarding.ts";
import type { AdImpressionRecord } from "../src/types.ts";

function sampleImpression(
  overrides: Partial<AdImpressionRecord> = {},
): AdImpressionRecord {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    pod_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    advertiser_name: "coursera.org",
    advertiser_url: "coursera.org",
    host_video_id: "abc123",
    timestamp: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15_000,
    pod_position: "1 of 2",
    pod_index: 1,
    pod_size: 2,
    impression_index: 0,
    skipped: false,
    skip_clicked_at: null,
    skip_available: true,
    ad_headline: "Save $70+",
    call_to_action: "Start now",
    creative_title: "Coursera: Grow Your Career",
    creative_duration_ms: 15_000,
    muted: false,
    playback_rate: 1,
    avatar_url: null,
    player_version: "test-player",
    end_reason: "completed",
    ...overrides,
  };
}

test("preserves extension-owned UUIDs in the shared contract", async () => {
  const record = sampleImpression();
  const canonical = await toAdImpressionV1(record);

  assert.deepEqual(adImpressionV1Schema.parse(canonical), canonical);
  assert.equal(canonical.event_id, record.event_id);
  assert.equal(canonical.pod_id, record.pod_id);
  assert.equal(canonical.started_at, record.timestamp);
  assert.equal(canonical.advertiser_domain, record.advertiser_url);
  assert.equal(canonical.pod_label, record.pod_position);
  assert.equal(canonical.pod_position, record.pod_index);
});

test("builds deterministic, ungrouped identities only for legacy rows", async () => {
  const records = await Promise.all([
    toAdImpressionV1(
      sampleImpression({
        event_id: undefined,
        pod_id: undefined,
        timestamp: "2026-09-01T12:00:00.000Z",
        pod_index: 1,
      }),
    ),
    toAdImpressionV1(
      sampleImpression({
        event_id: undefined,
        pod_id: undefined,
        timestamp: "2026-09-01T12:00:30.000Z",
        pod_index: 2,
      }),
    ),
    toAdImpressionV1(
      sampleImpression({
        event_id: undefined,
        pod_id: undefined,
        timestamp: "2026-09-02T12:00:00.000Z",
        pod_index: 1,
      }),
    ),
  ]);

  assert.equal(new Set(records.map((record) => record.pod_id)).size, 3);
  assert.ok(records.every((record) => /^legacy-[a-f0-9]{64}$/.test(record.event_id)));
  assert.ok(
    records.every((record) => record.pod_id === `legacy-pod:${record.event_id}`),
  );
});

test("posts the canonical record with the configured bearer token", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const messages: string[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 201 });
  };
  const forward = createCompanionForwarder({
    getToken: async () => "test-token",
    fetch: fetchStub,
    info: (message) => messages.push(message),
  });

  await forward(sampleImpression());

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
  const forward = createCompanionForwarder({
    getToken: async () => "test-token",
    fetch: fetchStub,
  });
  const record = sampleImpression();

  await forward(record);
  await forward(record);

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]?.["event_id"], bodies[1]?.["event_id"]);
});

test("offline delivery is quiet after one concise diagnostic", async () => {
  const warnings: string[] = [];
  const fetchStub: typeof fetch = async () => {
    throw new Error("connection refused");
  };
  const forward = createCompanionForwarder({
    getToken: async () => "test-token",
    fetch: fetchStub,
    warn: (message) => warnings.push(message),
  });

  await forward(sampleImpression());
  await forward(sampleImpression({ timestamp: "2026-09-02T12:00:00.000Z" }));

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
  const forward = createCompanionForwarder({
    getToken: async () => "test-token",
    fetch: fetchStub,
    timeoutMs: 5,
    warn: (message) => warnings.push(message),
  });

  await forward(sampleImpression());

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /request aborted/);
});

test("a missing token disables forwarding without a request or warning", async () => {
  let requests = 0;
  const messages: string[] = [];
  const warnings: string[] = [];
  const forward = createCompanionForwarder({
    getToken: async () => null,
    fetch: async () => {
      requests += 1;
      return new Response(null, { status: 201 });
    },
    info: (message) => messages.push(message),
    warn: (message) => warnings.push(message),
  });

  await forward(sampleImpression());
  await forward(sampleImpression());

  assert.equal(requests, 0);
  assert.deepEqual(messages, [
    "[YouTube Ad Impressions] local forwarding disabled: set localServerIngestToken",
  ]);
  assert.deepEqual(warnings, []);
});

test("local persistence succeeds without waiting for an unavailable server", async () => {
  const order: string[] = [];
  let releaseForward: (() => void) | undefined;
  const forwarding = new Promise<void>((resolve) => {
    releaseForward = resolve;
  });

  const id = await persistThenForward(
    sampleImpression(),
    async () => {
      order.push("persist");
      return 42;
    },
    async () => {
      order.push("forward");
      await forwarding;
    },
  );

  assert.equal(id, 42);
  assert.deepEqual(order, ["persist", "forward"]);
  releaseForward?.();
});

test("does not begin forwarding before local persistence completes", async () => {
  let finishPersistence: ((id: number) => void) | undefined;
  const persistence = new Promise<number>((resolve) => {
    finishPersistence = resolve;
  });
  let forwarded = false;

  const result = persistThenForward(
    sampleImpression(),
    async () => persistence,
    async () => {
      forwarded = true;
    },
  );

  await Promise.resolve();
  assert.equal(forwarded, false);
  finishPersistence?.(7);
  assert.equal(await result, 7);
  assert.equal(forwarded, true);
});

test("does not forward when local persistence fails", async () => {
  let forwarded = false;

  await assert.rejects(
    persistThenForward(
      sampleImpression(),
      async () => {
        throw new Error("IndexedDB unavailable");
      },
      async () => {
        forwarded = true;
      },
    ),
    /IndexedDB unavailable/,
  );

  assert.equal(forwarded, false);
});
