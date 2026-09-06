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

function mount(t, respond, saveToken = async () => {}) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: "outside-only", url: "https://extension.test" });
  t.after(() => dom.window.close());
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

test("missing token setup saves the worker's key and reconnects without reloading", async t => {
  let token;
  let reads = 0;
  const window = mount(t, (message, callback) => {
    assert.equal(message.type, "get-dashboard");
    reads++;
    callback(token ? dashboard([sampleImpression()]) : { ok: false, error: "Server API token is missing." });
  }, async values => {
    assert.deepEqual(Object.keys(values), ["localServerIngestToken"]);
    token = values.localServerIngestToken;
  });
  const document = window.document;
  await waitFor(() => document.querySelector("#status")?.textContent === "Server API token is missing.");
  assert.equal(document.querySelector(".server-connection").open, true);
  const input = document.querySelector("#server-token");
  assert.equal(input.type, "password");
  input.value = "  test-token  ";
  document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector("#total-impressions").textContent === "1");
  assert.equal(token, "test-token");
  assert.equal(reads, 2);
  assert.equal(input.value, "");
  assert.equal(document.querySelector(".server-connection").open, false);
});

test("token storage failures remain visible and do not retry the API", async t => {
  let reads = 0;
  const window = mount(t, (_message, callback) => {
    reads++;
    callback({ ok: false, error: "Server API token is missing." });
  }, async () => { throw new Error("Storage unavailable"); });
  const document = window.document;
  await waitFor(() => document.querySelector(".server-connection")?.open);
  document.querySelector("#server-token").value = "test-token";
  document.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes("Storage unavailable"));
  assert.equal(reads, 1);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
});
