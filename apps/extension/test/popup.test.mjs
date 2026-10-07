import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { aggregateImpressions } from "../src/analytics.ts";
import { sampleImpression } from "./sample-impression.ts";

const { outputFiles } = await build({
  stdin: { contents: `
    import {createRoot} from "react-dom/client";
    import {App} from "./App.tsx";
    import {AuthProvider} from "../src/auth/AuthProvider.tsx";
    const session = {user: {id: "test-user", email: "test@example.com"}};
    const client = {auth: {
      onAuthStateChange(callback) {
        queueMicrotask(() => callback("INITIAL_SESSION", session));
        return {data: {subscription: {unsubscribe() {}}}};
      },
      getSession: async () => ({data: {session}, error: null}),
      signOut: async () => ({error: null}),
    }};
    createRoot(document.getElementById("root")).render(<AuthProvider client={client}><App/></AuthProvider>);
  `, resolveDir: new URL("../popup/", import.meta.url).pathname, loader: "tsx" },
  jsx: "automatic", bundle: true, write: false, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: '"http://127.0.0.1:54321"', __SUPABASE_PUBLISHABLE_KEY__: '"test-key"', __SERVER_URL__: '"http://127.0.0.1:8787"' },
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
  dom.window.chrome = {
    runtime: { sendMessage: respond },
    storage: { local: { get: async () => ({}), set: saveToken, remove: async () => {} } },
  };
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
  assert.equal(window.document.querySelector("main > button").textContent, "Refresh history");
});

test("dashboard refresh updates totals beyond 100 and keeps recent history limited", async t => {
  let count = 115;
  const window = mount(t, (_message, callback) => callback(dashboard(
    Array.from({ length: count }, (_, index) => sampleImpression({ event_id: `event-${index}` })),
  )));
  await waitFor(() => window.document.querySelector("#total-impressions")?.textContent === "115");
  count = 117;
  window.document.querySelector("main > button").click();
  await waitFor(() => window.document.querySelector("#total-impressions")?.textContent === "117");
  assert.equal(window.document.querySelectorAll("#recent .recent-item").length, 10);
});

test("manual impression saves and displays the offer in recent history", async t => {
  let captured;
  const window = mount(t, (message, callback) => {
    if (message.type === "record-impression") {
      captured = message.record;
      callback({ ok: true, id: captured.event_id });
    } else callback(dashboard(captured ? [captured] : []));
  });
  await waitFor(() => window.document.querySelector("#impression-offer"));
  window.document.querySelector("#impression-advertiser").value = "Example Bank";
  window.document.querySelector("#impression-offer").value = "Sign up and get $400";
  window.document.querySelector("#impression-link").value = "https://bank.example/bonus";
  window.document.querySelector(".manual-impression form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.document.querySelector("#total-impressions")?.textContent === "1");
  assert.equal(captured.source, "manual");
  assert.equal(captured.adVideoId, undefined);
  assert.equal(window.document.querySelector("#recent .impression-offer").textContent, "Sign up and get $400");
  assert.equal(window.document.querySelector("#recent a").href, "https://bank.example/bonus");
  assert.match(window.document.querySelector(".manual-impression").textContent, /Impression saved/);
});

test("failed manual impression keeps input and reuses its event ID on retry", async t => {
  const attempts = [];
  const window = mount(t, (message, callback) => {
    if (message.type === "record-impression") {
      attempts.push(message.record);
      callback({ ok: false, error: "Server unavailable" });
    } else callback(dashboard([]));
  });
  await waitFor(() => window.document.querySelector("#impression-offer"));
  window.document.querySelector("#impression-advertiser").value = "Bank";
  const input = window.document.querySelector("#impression-offer");
  input.value = "Checking bonus";
  const submit = () => window.document.querySelector(".manual-impression form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  submit();
  await waitFor(() => window.document.querySelector(".manual-impression [role=alert]"));
  assert.equal(input.value, "Checking bonus");
  submit();
  await waitFor(() => attempts.length === 2);
  assert.equal(attempts[0].event_id, attempts[1].event_id);
});
