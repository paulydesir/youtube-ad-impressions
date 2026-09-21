import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { sampleImpression } from "./sample-impression.ts";

const { outputFiles } = await build({
  entryPoints: [new URL("../src/background.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "iife", platform: "browser",
  define: { __SUPABASE_URL__: '"http://127.0.0.1:54321"', __SUPABASE_PUBLISHABLE_KEY__: '"test-key"', __SERVER_URL__: '"http://127.0.0.1:8787"' },
});

test("cold worker without a popup or DOM restores session and POSTs a content-script message", async t => {
  const values = { "sb-127-auth-token": JSON.stringify({
    access_token: "test-access-token", refresh_token: "test-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "test-user", email: "test@example.com" },
    token_type: "bearer",
  }) };
  const requests = [];
  const timers = new Set();
  const logs = [];
  let listener;
  let adRequestListener;
  let adRequestFilter;
  const context = {
    crypto: webcrypto, WebSocket, performance, URL, Headers, Request, Response, AbortController, AbortSignal,
    TextEncoder, TextDecoder, atob, btoa,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout,
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval,
    console: Object.fromEntries(["log", "info", "warn", "error", "debug"].map(level => [level, (...args) => logs.push(args)])),
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ event_id: JSON.parse(init.body).event_id }, { status: 201 });
    },
    chrome: {
      tabs: { query: async () => [], onUpdated: { addListener: () => {} } },
      storage: { local: {
        get: async key => ({ [key]: values[key] }),
        set: async data => Object.assign(values, data),
        remove: async key => { delete values[key]; },
        setAccessLevel: async () => {},
      } },
      runtime: { onMessage: { addListener: fn => { listener = fn; } } },
      webRequest: { onBeforeRequest: { addListener: (fn, filter) => {
        adRequestListener = fn;
        adRequestFilter = filter;
      } } },
    },
  };
  t.after(() => { for (const timer of timers) { clearInterval(timer); clearTimeout(timer); } });
  runInNewContext(outputFiles[0].text, context);
  assert.equal(typeof listener, "function", "listener is registered synchronously on worker startup");
  assert.equal(typeof adRequestListener, "function", "ad request listener is registered on worker startup");
  assert.equal(adRequestFilter.urls.length, 1);
  assert.equal(adRequestFilter.urls[0], "https://www.youtube.com/api/stats/ads*");
  const beforeTelemetry = logs.length;
  adRequestListener({ url: "https://www.youtube.com/api/stats/ads?content_v=B3eciVIAwPs" });
  adRequestListener({ url: "https://www.youtube.com/api/stats/ads?ad_v=" });
  assert.equal(logs.length, beforeTelemetry + 1, "missing IDs produce only one diagnostic per worker");
  assert.match(logs.at(-1)[0], /no ad_v/);
  adRequestListener({ url: "https://www.youtube.com/api/stats/ads?content_v=B3eciVIAwPs&ad_v=c60usiz-Z34" });
  assert.equal(logs.some(args => args[0] === "[YouTube Ad] video ID:" && args[1] === "c60usiz-Z34"), true);
  const record = sampleImpression();
  const send = () => new Promise(resolve => {
    assert.equal(listener({ type: "record-impression", record }, { tab: { id: 1 } }, resolve), true);
  });
  assert.equal((await send()).ok, true, JSON.stringify(logs));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, "POST");
  assert.equal(new Headers(requests[0].init.headers).get("Authorization"), "Bearer test-access-token");
  delete values["sb-127-auth-token"];
  assert.equal((await send()).ok, false);
  assert.equal(requests.length, 1);
});
