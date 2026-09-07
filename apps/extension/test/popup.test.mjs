import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { aggregateImpressions } from "../src/analytics.ts";
import { sampleImpression } from "./sample-impression.ts";

const { outputFiles } = await build({
  stdin: { contents: 'import {createRoot} from "react-dom/client"; import {App} from "./App.tsx"; createRoot(document.getElementById("root")).render(<App/>);', resolveDir: new URL("../popup/", import.meta.url).pathname, loader: "tsx" },
  jsx: "automatic", bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: '"http://127.0.0.1:54321"', __SUPABASE_PUBLISHABLE_KEY__: '"test-key"' },
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Popup did not reach the expected state");
}

function mount(t, respond, saveToken = async () => {}) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: "outside-only", url: "https://extension.test" });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => { throw new Error("Unexpected fetch"); };
  dom.window.chrome = { runtime: { sendMessage: respond }, storage: { local: { set: saveToken } } };
  dom.window.eval(outputFiles[0].text);
  return dom.window;
}

const dashboard = records => ({ ok: true, records, analytics: aggregateImpressions(records, 3_600_000) });

test("React popup renders analytics, escaped advertiser text and recent history", async t => {
  const record = sampleImpression({ advertiser_name: "<b>Advertiser</b>", skipped: true });
  const window = mount(t, (_message, callback) => callback(dashboard([record])));
  await waitFor(() => window.document.querySelector("#total-impressions")?.textContent === "1");
  const document = window.document;
  assert.equal(document.querySelector("#total-time").textContent, "15s");
  assert.equal(document.querySelector("#ads-per-hour").textContent, "1.0");
  assert.equal(document.querySelector("#skip-rate").textContent, "100%");
  assert.equal(document.querySelector("#advertisers .name").textContent, "<b>Advertiser</b>");
  assert.equal(document.querySelector("#advertisers b"), null);
  assert.equal(document.querySelector("#recent .badge").textContent, "Skipped");
});

test("React popup reports worker connection errors", async t => {
  const window = mount(t, () => { throw new Error("Disconnected"); });
  await waitFor(() => window.document.querySelector("#status")?.textContent.includes("Disconnected"));
});

test("dashboard offers refresh without a shared-token form", async t => {
  const window = mount(t, (_message, callback) => callback(dashboard([])));
  await waitFor(() => window.document.querySelector("#total-impressions")?.textContent === "0");
  assert.equal(window.document.querySelector("#server-token"), null);
  assert.equal(window.document.querySelector("button").textContent, "Refresh history");
});
