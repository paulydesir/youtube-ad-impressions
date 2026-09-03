const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync("src/analytics.js", "utf8"), context);
const { aggregateImpressions } = context.YouTubeAdAnalytics;

test("aggregates advertiser frequency, duration, and skips", () => {
  const result = aggregateImpressions(
    [
      { advertiser_name: "Acme", duration_ms: 10000, skipped: true },
      { advertiser_domain: "other.example", duration_ms: 5000, skipped: false },
      { advertiser_name: "Acme", duration_ms: 15000, skipped: false },
    ],
    1_800_000,
  );

  assert.equal(result.totalImpressions, 3);
  assert.equal(result.totalAdMs, 30000);
  assert.equal(result.averageAdMs, 10000);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.adsPerWatchHour, 6);
  assert.equal(result.advertisers[0].name, "Acme");
  assert.equal(result.advertisers[0].impressions, 2);
  assert.equal(result.advertisers[1].name, "other.example");
});
