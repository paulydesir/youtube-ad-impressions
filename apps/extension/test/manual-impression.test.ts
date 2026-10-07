import assert from "node:assert/strict";
import { test } from "node:test";
import { manualImpression } from "../popup/manual-impression.ts";
import { toAdImpressionV1 } from "../src/api/impression-mapper.ts";
import { adImpressionV1Schema } from "@ad-impressions/contracts";
import { aggregateImpressions } from "../src/analytics.ts";

test("a bank offer maps to a manual impression, with no video or watch duration", async () => {
  const record = manualImpression(" Bank ", " Get $400 for signing up. ", "https://bank.example/bonus");
  const payload = adImpressionV1Schema.parse(await toAdImpressionV1(record));
  assert.equal(payload.source, "manual");
  assert.equal(payload.ad_headline, "Get $400 for signing up.");
  assert.equal(payload.source_url, "https://bank.example/bonus");
  assert.equal(payload.adVideoId, undefined);
  assert.equal(payload.duration_ms, null);
  const stats = aggregateImpressions([record, { duration_ms: 10000, skipped: true }], 3600000);
  assert.equal(stats.totalImpressions, 2);
  assert.equal(stats.averageAdMs, 10000);
  assert.equal(stats.skipRate, 1);
  assert.equal(stats.adsPerWatchHour, 1);
  assert.throws(() => adImpressionV1Schema.parse({ ...payload, adVideoId: "dQw4w9WgXcQ" }));
});

test("manual input requires details and an optional safe link", () => {
  assert.equal(manualImpression("Bank", "Offer", "").source_url, null);
  assert.throws(() => manualImpression(" ", "Offer", ""));
  assert.throws(() => manualImpression("Bank", " ", ""));
  assert.throws(() => manualImpression("Bank", "Offer", "javascript:alert(1)"));
});
