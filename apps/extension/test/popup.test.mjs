import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { aggregateImpressions } from "../src/analytics.ts";
import { sampleImpression } from "./sample-impression.ts";

const { outputFiles } = await build({
  entryPoints: [new URL("../popup/popup.tsx", import.meta.url).pathname],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Popup did not reach the expected state");
}

function mount(t, respond) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: "outside-only", url: "https://extension.test" });
  t.after(() => dom.window.close());
  dom.window.chrome = { runtime: { sendMessage: respond } };
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
  await waitFor(() => window.document.querySelector("#status")?.textContent.includes("Could not open"));
});

test("React popup imports in selected mode, locks controls and refreshes history", async t => {
  let reads = 0;
  let finishImport;
  const window = mount(t, (message, callback) => {
    if (message.type === "get-dashboard") { reads++; callback(dashboard([])); }
    else {
      assert.equal(message.type, "import-data");
      assert.equal(message.mode, "replace");
      assert.deepEqual(JSON.parse(JSON.stringify(message.data)), { impressions: [] });
      finishImport = callback;
    }
  });
  await waitFor(() => window.document.querySelector("#advertisers .empty"));
  window.document.querySelector('input[value="replace"]').click();
  const input = window.document.querySelector("#import-file");
  Object.defineProperty(input, "files", { value: [{ name: "backup.json", text: async () => '{"impressions":[]}' }] });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => finishImport && window.document.querySelector("#export").disabled);
  finishImport({ ok: true, imported: 2, skipped: 1, totalImpressions: 2 });
  await waitFor(() => reads === 2 && !window.document.querySelector("#export").disabled);
  assert.match(window.document.querySelector("#backup-status").textContent, /Imported 2, skipped 1 duplicates/);
});

test("React popup reports invalid JSON without sending an import", async t => {
  const window = mount(t, (message, callback) => {
    assert.equal(message.type, "get-dashboard");
    callback(dashboard([]));
  });
  await waitFor(() => window.document.querySelector("#import-file"));
  const input = window.document.querySelector("#import-file");
  Object.defineProperty(input, "files", { value: [{ name: "bad.json", text: async () => "{" }] });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => window.document.querySelector("#backup-status").textContent.includes("File is not valid JSON"));
  assert.equal(window.document.querySelector("#export").disabled, false);
});
