import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const { outputFiles } = await build({
  entryPoints: [new URL("../src/content.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "iife", platform: "browser",
});

test("continuous player mutations do not prevent a completed impression reaching the worker", async t => {
  const dom = new JSDOM('<div id="movie_player"><span class="ytp-ad-simple-ad-badge"></span><span class="ytp-ad-text ytp-ad-preview-container"></span><span class="ytp-visit-advertiser-link__text">example.com</span><span id="timer"></span></div>', { runScripts: "outside-only", url: "https://www.youtube.com/watch?v=test" });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const messages = [];

  dom.window.chrome = { runtime: { id: "test-extension", onMessage: { addListener: () => {}, removeListener: () => {} }, sendMessage: (message, callback) => { messages.push(message); callback?.({ ok: true, id: message.record?.event_id }); } } };
  dom.window.console.info = () => {};
  dom.window.eval(outputFiles[0].text);
  dom.window.eval(outputFiles[0].text);
  const player = dom.window.document.querySelector('#movie_player');
  player.classList.add('ad-showing');
  for (let i = 0; i < 12; i++) {
    dom.window.document.querySelector('#timer').textContent = String(i);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  player.querySelector('.ytp-visit-advertiser-link__text').remove();
  player.classList.remove('ad-showing');
  await new Promise(resolve => setTimeout(resolve, 30));
  const records = messages.filter(message => message.type === 'record-impression');
  assert.equal(records.length, 1);
  assert.equal(records[0].record.advertiser_url, 'example.com');
  assert.ok(records[0].record.duration_ms > 0);
});

test("telemetry reaches the active impression before debounce and does not leak into the next pod", async t => {
  const dom = new JSDOM('<div id="movie_player"><span class="ytp-ad-simple-ad-badge"></span><span class="ytp-ad-text ytp-ad-preview-container"></span><span class="ytp-visit-advertiser-link__text">example.com</span><span id="timer"></span></div>', { runScripts: "outside-only", url: "https://www.youtube.com/watch?v=test" });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const messages = [];
  let onMessage;
  dom.window.chrome = { runtime: { id: "test-extension", onMessage: { addListener: fn => { onMessage = fn; }, removeListener: () => {} }, sendMessage: (message, callback) => { messages.push(message); callback?.({ ok: true, id: message.record?.event_id }); } } };
  dom.window.console.info = () => {};
  dom.window.eval(outputFiles[0].text);
  dom.window.eval(outputFiles[0].text);
  const player = dom.window.document.querySelector('#movie_player');
  player.classList.add('ad-showing');
  onMessage({ type: 'ad-video-id', adVideoId: 'c60usiz-Z34' });
  for (let i = 0; i < 12; i++) {
    dom.window.document.querySelector('#timer').textContent = String(i);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  player.querySelector('.ytp-visit-advertiser-link__text').remove();
  player.classList.remove('ad-showing');
  await new Promise(resolve => setTimeout(resolve, 30));
  const records = messages.filter(message => message.type === 'record-impression');
  assert.equal(records.length, 1);
  assert.equal(records[0].record.advertiser_url, 'example.com');
  assert.equal(records[0].record.adVideoId, 'c60usiz-Z34');
  onMessage({ type: 'ad-video-id', adVideoId: 'stale-id' });
  player.insertAdjacentHTML('beforeend', '<span class="ytp-visit-advertiser-link__text">second.com</span>');
  player.classList.add('ad-showing');
  await new Promise(resolve => setTimeout(resolve, 250));
  player.classList.remove('ad-showing');
  await new Promise(resolve => setTimeout(resolve, 30));
  const next = messages.filter(message => message.type === 'record-impression');
  assert.equal(next.length, 2);
  assert.equal(next[1].record.adVideoId, undefined);
});
