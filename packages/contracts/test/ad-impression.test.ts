import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { adImpressionV1Schema, toAdImpressionV1 } from "../src/index.js";

function validInput(): Record<string, unknown> {
  return {
    schema_version: 1,
    event_id: "evt-1",
    source: "youtube",
    started_at: "2026-09-01T12:00:00.000Z",
    ended_at: "2026-09-01T12:00:15.000Z",
    duration_ms: 15000,
    host_video_id: "abc123",
    advertiser_name: "coursera.org",
    advertiser_domain: "coursera.org",
    ad_headline: "Save $70+",
    call_to_action: "Start now",
    creative_title: "Coursera: Grow Your Career",
    creative_duration_ms: 15000,
    pod_id: "pod-1",
    pod_label: null,
    pod_position: 1,
    pod_size: 2,
    pod_impression_index: 0,
    skipped: false,
    skip_clicked_at: null,
    end_reason: "completed",
  };
}

describe("adImpressionV1Schema", () => {
  it("accepts a minimal valid record", () => {
    const record = adImpressionV1Schema.parse(validInput());
    assert.equal(record.event_id, "evt-1");
    assert.equal(record.schema_version, 1);
  });

  it("accepts extension carryover fields", () => {
    const record = adImpressionV1Schema.parse({
      ...validInput(),
      advertiser_url: "https://coursera.org",
      skip_available: true,
      muted: null,
      playback_rate: 1,
      avatar_url: null,
      player_version: "1.2.3",
    });
    assert.equal(record.player_version, "1.2.3");
  });

  it("rejects a wrong schema version", () => {
    assert.throws(() => adImpressionV1Schema.parse({ ...validInput(), schema_version: 2 }));
  });

  it("rejects a missing event id", () => {
    const { event_id: _omitted, ...rest } = validInput();
    assert.throws(() => adImpressionV1Schema.parse(rest));
  });

  it("rejects a non-ISO timestamp", () => {
    assert.throws(() =>
      adImpressionV1Schema.parse({ ...validInput(), started_at: "yesterday-ish" }),
    );
  });

  it("rejects a negative duration", () => {
    assert.throws(() =>
      adImpressionV1Schema.parse({ ...validInput(), duration_ms: -5 }),
    );
  });
});

describe("toAdImpressionV1", () => {
  it("preserves unknown fields verbatim in rawJson", () => {
    const { record, rawJson } = toAdImpressionV1({
      ...validInput(),
      future_field: "keep me",
    });
    assert.ok(!("future_field" in record));
    assert.equal((JSON.parse(rawJson) as Record<string, unknown>).future_field, "keep me");
  });

  it("throws a ZodError on invalid input", () => {
    expect(() => toAdImpressionV1({ nope: true })).toThrow(ZodError);
  });
});
