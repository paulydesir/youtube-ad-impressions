import assert from "node:assert/strict";
import test from "node:test";
import { createWatchTimeTracker } from "../src/content/watch-time.ts";

function setup(overrides: {
  paused?: boolean;
  adActive?: boolean;
  video?: { paused: boolean } | null;
} = {}) {
  const { paused = false, adActive = false } = overrides;
  const video = overrides.video === undefined ? { paused } : overrides.video;
  const sent: number[] = [];
  let time = 0;
  const tracker = createWatchTimeTracker({
    isAdActive: () => adActiveTrackerValue,
    getVideo: () => video,
    sendWatchTime: (milliseconds) => sent.push(milliseconds),
    now: () => time,
  });
  let adActiveTrackerValue = adActive;
  return {
    tracker,
    sent,
    advance: (ms: number) => {
      time += ms;
    },
    setAdActive: (value: boolean) => {
      adActiveTrackerValue = value;
    },
  };
}

test("accumulates watch time only for unpaused, non-ad playback", () => {
  const { tracker, sent, advance } = setup();

  tracker.sample();
  advance(1000);
  tracker.sample();
  advance(1000);
  tracker.sample();

  assert.equal(tracker.pendingMs, 2000);
  assert.deepEqual(sent, []);
  tracker.flush();
  assert.deepEqual(sent, [2000]);
  assert.equal(tracker.pendingMs, 0);
});

test("ignores paused video and active ads", () => {
  const paused = setup({ paused: true });
  paused.tracker.sample();
  paused.advance(1000);
  paused.tracker.sample();
  assert.equal(paused.tracker.pendingMs, 0);

  const ad = setup();
  ad.tracker.sample();
  ad.setAdActive(true);
  ad.advance(1000);
  ad.tracker.sample();
  assert.equal(ad.tracker.pendingMs, 0);

  const missing = setup({ video: null });
  missing.tracker.sample();
  missing.advance(5000);
  missing.tracker.sample();
  assert.equal(missing.tracker.pendingMs, 0);
});

test("caps single samples after sleep and auto-flushes at threshold", () => {
  const { tracker, sent, advance } = setup();

  tracker.sample();
  advance(60_000);
  tracker.sample();

  // One capped sample, well under the flush threshold.
  assert.equal(tracker.pendingMs, 2000);

  for (let i = 0; i < 4; i += 1) {
    advance(2000);
    tracker.sample();
  }

  assert.deepEqual(sent, [10000]);
  assert.equal(tracker.pendingMs, 0);
});

test("flush is a no-op without pending time", () => {
  const { tracker, sent } = setup();
  tracker.flush();
  assert.deepEqual(sent, []);
});
