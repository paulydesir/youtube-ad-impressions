import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAutomaticTracking } from "../src/auto-tracking.ts";

test("automatically attaches existing and newly loaded YouTube tabs without opening popup", async () => {
  const injected: number[] = [];
  let updated: (id: number, change: { status: string }, tab: { url: string }) => void;
  const api = {
    tabs: {
      query: async (query: unknown) => {
        assert.deepEqual(query, { url: "https://www.youtube.com/*" });
        return [{ id: 1 }, { id: 2, discarded: true }];
      },
      onUpdated: { addListener: (fn: typeof updated) => { updated = fn; } },
    },
    scripting: { executeScript: async (options: { target: { tabId: number }; files: string[] }) => {
      assert.deepEqual(options.files, ["dist/content.js"]);
      injected.push(options.target.tabId);
    } },
  } as unknown as typeof chrome;
  registerAutomaticTracking(api);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(injected, [1]);
  updated!(3, { status: "complete" }, { url: "https://www.youtube.com/watch?v=test" });
  updated!(4, { status: "complete" }, { url: "https://example.com/" });
  updated!(5, { status: "loading" }, { url: "https://www.youtube.com/" });
  assert.deepEqual(injected, [1, 3]);
});
