import assert from "node:assert/strict";
import test from "node:test";
import { adImpressionV1Schema } from "@ad-impressions/contracts";
import { toAdImpressionV1 } from "../src/api/impression-mapper.ts";
import { sampleImpression } from "./sample-impression.ts";

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
