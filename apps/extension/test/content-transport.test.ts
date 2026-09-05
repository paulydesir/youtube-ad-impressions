import assert from "node:assert/strict";
import test from "node:test";
import { createContentTransport } from "../src/content/transport.ts";
import type { ExtensionMessage } from "../src/types.ts";

test("sendRecordImpression forwards the record and reports failures", () => {
  const sent: ExtensionMessage[] = [];
  const errors: Array<{ message: string; detail?: unknown }> = [];
  const transport = createContentTransport({
    sender: (message, onResponse) => {
      sent.push(message);
      onResponse?.({ ok: false });
    },
    error: (message, detail) => errors.push({ message, detail }),
  });

  const record = {
    event_id: "event-1",
    pod_id: "pod-1",
    advertiser_name: "Example",
    advertiser_url: "example.com",
    host_video_id: "host-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:00:30.000Z",
    duration_ms: 30000,
    pod_position: "1 of 2",
    pod_index: 1,
    pod_size: 2,
    impression_index: 1,
    skipped: false,
    skip_clicked_at: null,
    skip_available: true,
    ad_headline: null,
    call_to_action: null,
    creative_title: null,
    creative_duration_ms: null,
    muted: null,
    playback_rate: null,
    avatar_url: null,
    player_version: null,
    end_reason: "pod-ended",
  };
  transport.sendRecordImpression(record);

  assert.deepEqual(sent, [{ type: "record-impression", record }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? "", /failed to save impression/);
});

test("sendRecordImpression stays quiet on success", () => {
  const errors: unknown[] = [];
  const transport = createContentTransport({
    sender: (_message, onResponse) => onResponse?.({ ok: true }),
    error: (message, detail) => errors.push([message, detail]),
  });

  transport.sendRecordImpression({
    event_id: "event-1",
    pod_id: "pod-1",
    advertiser_name: null,
    advertiser_url: null,
    host_video_id: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    ended_at: "2026-01-01T00:00:30.000Z",
    duration_ms: null,
    pod_position: null,
    pod_index: null,
    pod_size: null,
    impression_index: 1,
    skipped: false,
    skip_clicked_at: null,
    skip_available: false,
    ad_headline: null,
    call_to_action: null,
    creative_title: null,
    creative_duration_ms: null,
    muted: null,
    playback_rate: null,
    avatar_url: null,
    player_version: null,
    end_reason: "pod-ended",
  });

  assert.equal(errors.length, 0);
});

test("sendWatchTime forwards batched milliseconds", () => {
  const sent: ExtensionMessage[] = [];
  const transport = createContentTransport({
    sender: (message) => {
      sent.push(message);
    },
  });

  transport.sendWatchTime(12_345);

  assert.deepEqual(sent, [{ type: "add-watch-time", milliseconds: 12_345 }]);
});

test("publish emits a page event with host and observation time", () => {
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const logged: Array<{ message: string; detail?: unknown }> = [];
  const globalScope = globalThis as Record<string, unknown>;
  const savedDocument = globalScope["document"];
  const savedCustomEvent = globalScope["CustomEvent"];
  globalScope["document"] = {
    dispatchEvent: (event: { type: string; detail: unknown }) => {
      dispatched.push({ type: event.type, detail: event.detail });
      return true;
    },
  };
  globalScope["CustomEvent"] = class {
    readonly type: string;
    readonly detail: unknown;
    constructor(type: string, init: { detail: unknown }) {
      this.type = type;
      this.detail = init.detail;
    }
  };
  try {
    const transport = createContentTransport({
      eventName: "test-event",
      hostVideoId: () => "host-9",
      now: () => "2026-01-01T00:00:00.000Z",
      info: (message, detail) => logged.push({ message, detail }),
    });

    transport.publish("ad-start", { startedAtMs: 42 });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0]?.type, "test-event");
    assert.deepEqual(dispatched[0]?.detail, {
      type: "ad-start",
      hostVideoId: "host-9",
      observedAt: "2026-01-01T00:00:00.000Z",
      startedAtMs: 42,
    });
    assert.equal(logged.length, 1);
  } finally {
    globalScope["document"] = savedDocument;
    globalScope["CustomEvent"] = savedCustomEvent;
  }
});
