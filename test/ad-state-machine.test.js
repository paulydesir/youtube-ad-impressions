const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync("src/ad-state-machine.js", "utf8"),
  context,
);

const { AdStateMachine, DomainImpressionTracker, playerIsShowingAd } =
  context.YouTubeAdWatcher;

test("recognizes both known YouTube ad classes", () => {
  const player = {
    classList: { contains: (name) => name === "ad-interrupting" },
  };
  assert.equal(playerIsShowingAd(player), true);
  assert.equal(playerIsShowingAd(null), false);
});

test("emits exactly one lifecycle for repeated observations", () => {
  let time = 1000;
  const starts = [];
  const ends = [];
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
  assert.equal(starts[0].startedAtMs, 1000);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].durationMs, 3750);
});

test("reset closes an active lifecycle", () => {
  let time = 10;
  const ends = [];
  const state = new AdStateMachine({
    now: () => time,
    onEnd: (event) => ends.push(event),
  });

  state.update(true);
  time = 25;
  state.reset({ reason: "player-replaced" });

  assert.equal(state.active, false);
  assert.equal(ends[0].durationMs, 15);
  assert.equal(ends[0].reason, "player-replaced");
});

test("tracks each advertiser-domain change within one ad pod", () => {
  let time = 100;
  const starts = [];
  const ends = [];
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
  assert.equal(ends[0].durationMs, 1000);
  assert.equal(ends[0].reason, "advertiser-changed");
  assert.equal(ends[1].reason, "pod-ended");
});
