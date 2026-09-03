import assert from "node:assert/strict";
import test from "node:test";
import { aggregateImpressions } from "../src/analytics.ts";

test("aggregates advertiser frequency, duration, and skips", () => {
  const result = aggregateImpressions(
    [
      { advertiser_name: "Acme", duration_ms: 10000, skipped: true },
      { advertiser_name: "Other", duration_ms: 5000, skipped: false },
      { advertiser_name: "Acme", duration_ms: 15000, skipped: false },
    ],
    1_800_000,
  );

  assert.equal(result.totalImpressions, 3);
  assert.equal(result.totalAdMs, 30000);
  assert.equal(result.averageAdMs, 10000);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.adsPerWatchHour, 6);
  assert.equal(result.advertisers[0]?.name, "Acme");
  assert.equal(result.advertisers[0]?.impressions, 2);
});

test("handles empty histories without watch time", () => {
  const result = aggregateImpressions([], 0);

  assert.equal(result.totalImpressions, 0);
  assert.equal(result.averageAdMs, 0);
  assert.equal(result.skipRate, 0);
  assert.equal(result.adsPerWatchHour, null);
  assert.deepEqual(result.advertisers, []);
});
