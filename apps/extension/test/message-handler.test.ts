import assert from "node:assert/strict";
import test from "node:test";
import type { ImpressionAnalytics } from "../src/analytics.ts";
import { createMessageHandler } from "../src/message-handler.ts";
import type {
  MessageHandlerDeps,
  MessageResponse,
} from "../src/message-handler.ts";
import type { ImpressionStore } from "../src/storage/impression-store.ts";
import type { WatchTimeStore } from "../src/storage/watch-time-store.ts";
import type { AdImpressionRecord, ExtensionMessage } from "../src/types.ts";
import { sampleImpression } from "./sample-impression.ts";

interface MemoryWorld {
  deps: MessageHandlerDeps;
  impressions: AdImpressionRecord[];
  getWatchTimeMs: () => number;
}

function createMemoryWorld(): MemoryWorld {
  const impressions: AdImpressionRecord[] = [];
  let watchTimeMs = 0;
  let nextId = 1;

  const impressionStore: ImpressionStore = {
    addImpression: async (record) => {
      const id = nextId++;
      impressions.push(record);
      return String(id);
    },
    getImpressions: async () => [...impressions],
  };

  const watchTimeStore: WatchTimeStore = {
    addWatchTime: async (milliseconds) => {
      watchTimeMs += milliseconds;
    },
    getWatchTime: async () => watchTimeMs,
    setWatchTime: async (value) => {
      watchTimeMs = value;
    },
  };

  return {
    deps: {
      impressionStore,
      watchTimeStore,
    },
    impressions,
    getWatchTimeMs: () => watchTimeMs,
  };
}

function invoke(
  deps: MessageHandlerDeps,
  message: ExtensionMessage,
): Promise<{ response: MessageResponse; syncReturn: boolean }> {
  return new Promise((resolve) => {
    const result = {} as { response: MessageResponse; syncReturn: boolean };
    // Assign the return value first: invalid import mode responds
    // synchronously inside `handler`, before it returns.
    result.syncReturn = createMessageHandler(deps)(message, (response) => {
      result.response = response;
      resolve(result);
    });
  });
}

test("record-impression persists on the server and responds ok", async () => {
  const world = createMemoryWorld();
  const record = sampleImpression();

  const { response, syncReturn } = await invoke(world.deps, {
    type: "record-impression",
    record,
  });

  assert.equal(syncReturn, true);
  assert.deepEqual(response, { ok: true, id: "1" });
  assert.equal(world.impressions.length, 1);
  assert.equal(world.impressions[0]?.event_id, record.event_id);
});

test("record-impression reports server persistence failures", async () => {
  const world = createMemoryWorld();
  world.deps.impressionStore.addImpression = async () => {
    throw new Error("PostgreSQL unavailable");
  };

  const { response } = await invoke(world.deps, {
    type: "record-impression",
    record: sampleImpression(),
  });

  assert.deepEqual(response, { ok: false, error: "PostgreSQL unavailable" });
});

test("get-dashboard returns newest-first records with analytics", async () => {
  const world = createMemoryWorld();
  await world.deps.impressionStore.addImpression(
    sampleImpression({
      event_id: "old",
      timestamp: "2026-09-01T12:00:00.000Z",
    }),
  );
  await world.deps.impressionStore.addImpression(
    sampleImpression({
      event_id: "new",
      timestamp: "2026-09-02T12:00:00.000Z",
    }),
  );
  await world.deps.watchTimeStore.addWatchTime(3_600_000);

  const { response } = await invoke(world.deps, { type: "get-dashboard" });

  assert.equal(response.ok, true);
  const dashboard = response as {
    ok: boolean;
    records?: AdImpressionRecord[];
    analytics?: ImpressionAnalytics;
  };
  assert.deepEqual(
    dashboard.records?.map((record) => record.event_id),
    ["new", "old"],
  );
  assert.equal(dashboard.analytics?.totalImpressions, 2);
  assert.equal(dashboard.analytics?.watchTimeMs, 3_600_000);
});

test("add-watch-time accumulates milliseconds", async () => {
  const world = createMemoryWorld();

  const { response, syncReturn } = await invoke(world.deps, {
    type: "add-watch-time",
    milliseconds: 1500,
  });

  assert.equal(syncReturn, true);
  assert.deepEqual(response, { ok: true });
  assert.equal(world.getWatchTimeMs(), 1500);
});
