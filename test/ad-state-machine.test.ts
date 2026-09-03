import assert from "node:assert/strict";
import test from "node:test";
import {
  AdStateMachine,
  DomainImpressionTracker,
  playerIsShowingAd,
} from "../src/ad-state-machine.ts";

test("recognizes both known YouTube ad classes", () => {
  const player = {
    classList: { contains: (name: string) => name === "ad-interrupting" },
  };
  assert.equal(playerIsShowingAd(player), true);
  assert.equal(playerIsShowingAd(null), false);
  assert.equal(playerIsShowingAd(undefined), false);
});

test("emits exactly one lifecycle for repeated observations", () => {
  let time = 1000;
  const starts: Array<{ startedAtMs: number }> = [];
  const ends: Array<{ durationMs: number | null }> = [];
  const state = new AdStateMachine({
    now: () => time,
    onStart: (event) => starts.push(event),
    onEnd: (event) => ends.push(event),
  });

  state.update(false);
  state.update(true, { marker: "start" });
  state.update(true);
  time = 4750;
  state.update(false, { marker: "end" });
  state.update(false);

  assert.equal(starts.length, 1);
  assert.equal(starts[0]?.startedAtMs, 1000);
  assert.equal(ends.length, 1);
  assert.equal(ends[0]?.durationMs, 3750);
});

test("reset closes an active lifecycle", () => {
  let time = 10;
  const ends: Array<{ durationMs: number | null; reason?: unknown }> = [];
  const state = new AdStateMachine({
    now: () => time,
    onEnd: (event) => ends.push(event),
  });

  state.update(true);
  time = 25;
  state.reset({ reason: "player-replaced" });

  assert.equal(state.active, false);
  assert.equal(ends[0]?.durationMs, 15);
  assert.equal(ends[0]?.reason, "player-replaced");
});

test("tracks each advertiser-domain change within one ad pod", () => {
  let time = 100;
  const starts: Array<{ advertiserDomain: string; impressionIndex: number }> = [];
  const ends: Array<{ durationMs: number; reason: string }> = [];
  const tracker = new DomainImpressionTracker({
    now: () => time,
    onStart: (event) => starts.push(event),
    onEnd: (event) => ends.push(event),
  });

  tracker.beginPod();
  tracker.updateDomain(" DataCamp.com ");
  tracker.updateDomain("datacamp.com");
  time = 1100;
  tracker.updateDomain("example.org");
  time = 2100;
  tracker.endPod({ reason: "pod-ended" });

  assert.deepEqual(
    starts.map(({ advertiserDomain, impressionIndex }) => ({
      advertiserDomain,
      impressionIndex,
    })),
    [
      { advertiserDomain: "datacamp.com", impressionIndex: 1 },
      { advertiserDomain: "example.org", impressionIndex: 2 },
    ],
  );
  assert.equal(ends.length, 2);
  assert.equal(ends[0]?.durationMs, 1000);
  assert.equal(ends[0]?.reason, "advertiser-changed");
  assert.equal(ends[1]?.reason, "pod-ended");
});
