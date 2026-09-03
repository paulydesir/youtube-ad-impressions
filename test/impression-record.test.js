const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync("src/impression-record.js", "utf8"), context);
const { buildAdImpressionRecord } = context.YouTubeAdImpressionSchema;

test("builds the versioned canonical impression record", () => {
  const record = buildAdImpressionRecord({
    detail: {
      eventId: "6c5fc01b-b4c4-41bd-ad3a-da3bf9a7020e",
      podId: "8ffb30d8-0669-4370-9466-0ff49f96711f",
      podImpressionIndex: 2,
      startedAtMs: 1000,
      endedAtMs: 4500,
      durationMs: 3500,
      reason: "pod-ended",
    },
    metadata: {
      advertiserName: "Coursera",
      advertiserDomain: "coursera.org",
      disclosureLabel: "Ad",
      podLabel: "2 of 2",
      podPosition: 2,
      podSize: 2,
      skipped: false,
      skipAvailableAtCapture: true,
      creativeCurrentTimeMs: 120,
      creativeMutedAtCapture: false,
      creativePlaybackRate: 1,
    },
    hostVideoId: "host-video",
  });

  assert.equal(record.schema_version, 1);
  assert.equal(record.source, "youtube");
  assert.equal(record.event_id, "6c5fc01b-b4c4-41bd-ad3a-da3bf9a7020e");
  assert.equal(record.pod_id, "8ffb30d8-0669-4370-9466-0ff49f96711f");
  assert.equal(record.started_at, "1970-01-01T00:00:01.000Z");
  assert.equal(record.advertiser_domain, "coursera.org");
  assert.equal(record.pod_label, "2 of 2");
  assert.equal(record.pod_position, 2);
  assert.equal(record.pod_impression_index, 2);
  assert.equal(record.skip_available_at_start, true);
  assert.equal(record.creative_current_time_ms_at_start, 120);
  assert.equal(record.muted_at_start, false);
});

test("rejects records without global identity", () => {
  assert.throws(
    () => buildAdImpressionRecord({ detail: {}, metadata: {} }),
    /require event and pod IDs/,
  );
});
