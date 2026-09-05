import assert from "node:assert/strict";
import test from "node:test";
import type { ImpressionAnalytics } from "../src/analytics.ts";
import { buildBackupFile } from "../src/backup.ts";
import type { BackupFile, StoredImpression } from "../src/backup.ts";
import {
  createMessageHandler,
  persistThenForward,
} from "../src/message-handler.ts";
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
  impressions: StoredImpression[];
  forwarded: AdImpressionRecord[];
  getWatchTimeMs: () => number;
}

function createMemoryWorld(): MemoryWorld {
  const impressions: StoredImpression[] = [];
  const forwarded: AdImpressionRecord[] = [];
  let watchTimeMs = 0;
  let nextId = 1;

  const impressionStore: ImpressionStore = {
    addImpression: async (record) => {
      const id = nextId++;
      impressions.push({ ...record, id });
      return id;
    },
    getImpressions: async () =>
      impressions.map(({ id: _localId, ...record }) => record),
    getStoredImpressions: async () => [...impressions],
    bulkAdd: async (records) => {
      for (const record of records) impressions.push({ ...record, id: nextId++ });
    },
    replaceAll: async (records, incomingWatchTimeMs) => {
      impressions.length = 0;
      for (const { id: _localId, ...record } of records) {
        impressions.push({ ...record, id: nextId++ });
      }
      watchTimeMs = incomingWatchTimeMs;
    },
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
      forwardRecord: async (record) => {
        forwarded.push(record);
      },
    },
    impressions,
    forwarded,
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

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("local persistence succeeds without waiting for an unavailable server", async () => {
  const order: string[] = [];
  let releaseForward: (() => void) | undefined;
  const forwarding = new Promise<void>((resolve) => {
    releaseForward = resolve;
  });

  const id = await persistThenForward(
    sampleImpression(),
    async () => {
      order.push("persist");
      return 42;
    },
    async () => {
      order.push("forward");
      await forwarding;
    },
  );

  assert.equal(id, 42);
  assert.deepEqual(order, ["persist", "forward"]);
  releaseForward?.();
});

test("does not begin forwarding before local persistence completes", async () => {
  let finishPersistence: ((id: number) => void) | undefined;
  const persistence = new Promise<number>((resolve) => {
    finishPersistence = resolve;
  });
  let forwarded = false;

  const result = persistThenForward(
    sampleImpression(),
    async () => persistence,
    async () => {
      forwarded = true;
    },
  );

  await Promise.resolve();
  assert.equal(forwarded, false);
  finishPersistence?.(7);
  assert.equal(await result, 7);
  assert.equal(forwarded, true);
});

test("does not forward when local persistence fails", async () => {
  let forwarded = false;

  await assert.rejects(
    persistThenForward(
      sampleImpression(),
      async () => {
        throw new Error("IndexedDB unavailable");
      },
      async () => {
        forwarded = true;
      },
    ),
    /IndexedDB unavailable/,
  );

  assert.equal(forwarded, false);
});

test("record-impression persists locally, responds ok, and forwards detached", async () => {
  const world = createMemoryWorld();
  const record = sampleImpression();

  const { response, syncReturn } = await invoke(world.deps, {
    type: "record-impression",
    record,
  });

  assert.equal(syncReturn, true);
  assert.deepEqual(response, { ok: true, id: 1 });
  assert.equal(world.impressions.length, 1);
  assert.equal(world.impressions[0]?.event_id, record.event_id);
  await tick();
  assert.deepEqual(world.forwarded, [record]);
});

test("record-impression reports persistence failures without forwarding", async () => {
  const world = createMemoryWorld();
  world.deps.impressionStore.addImpression = async () => {
    throw new Error("IndexedDB unavailable");
  };

  const { response } = await invoke(world.deps, {
    type: "record-impression",
    record: sampleImpression(),
  });

  assert.deepEqual(response, { ok: false, error: "IndexedDB unavailable" });
  await tick();
  assert.deepEqual(world.forwarded, []);
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

test("export-data returns the backup envelope", async () => {
  const world = createMemoryWorld();
  await world.deps.impressionStore.addImpression(sampleImpression());
  await world.deps.watchTimeStore.addWatchTime(9000);

  const { response } = await invoke(world.deps, { type: "export-data" });

  assert.equal(response.ok, true);
  const exported = response as { ok: boolean; backup?: BackupFile };
  assert.equal(exported.backup?.impressions.length, 1);
  assert.equal(
    exported.backup?.stats.find((stat) => stat.key === "watch_time_ms")?.value,
    9000,
  );
});

test("import-data merge dedupes across repeated imports", async () => {
  const world = createMemoryWorld();
  const backup = buildBackupFile([sampleImpression()], 5000);

  const first = await invoke(world.deps, {
    type: "import-data",
    mode: "merge",
    data: backup,
  });
  assert.deepEqual(first.response, {
    ok: true,
    imported: 1,
    skipped: 0,
    totalImpressions: 1,
    watchTimeMs: 5000,
  });

  const second = await invoke(world.deps, {
    type: "import-data",
    mode: "merge",
    data: backup,
  });
  assert.deepEqual(second.response, {
    ok: true,
    imported: 0,
    skipped: 1,
    totalImpressions: 1,
    watchTimeMs: 5000,
  });
});

test("import-data replace swaps contents and watch time", async () => {
  const world = createMemoryWorld();
  await world.deps.impressionStore.addImpression(
    sampleImpression({ event_id: "stale" }),
  );
  await world.deps.watchTimeStore.addWatchTime(60_000);
  const backup = buildBackupFile([sampleImpression({ event_id: "fresh" })], 1000);

  const { response } = await invoke(world.deps, {
    type: "import-data",
    mode: "replace",
    data: backup,
  });

  assert.deepEqual(response, {
    ok: true,
    imported: 1,
    skipped: 0,
    totalImpressions: 1,
    watchTimeMs: 1000,
  });
  assert.deepEqual(
    world.impressions.map((record) => record.event_id),
    ["fresh"],
  );
  assert.equal(world.getWatchTimeMs(), 1000);
});

test("import-data rejects invalid modes and invalid files", async () => {
  const world = createMemoryWorld();

  const badMode = await invoke(world.deps, {
    type: "import-data",
    mode: "overwrite",
    data: {},
  } as unknown as ExtensionMessage);
  assert.equal(badMode.syncReturn, false);
  assert.equal(badMode.response.ok, false);

  const badFile = await invoke(world.deps, {
    type: "import-data",
    mode: "merge",
    data: { formatVersion: 999 },
  });
  assert.equal(badFile.syncReturn, true);
  assert.equal(badFile.response.ok, false);
});
