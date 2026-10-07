import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = (await readFile(new URL('./zap-reload.js', import.meta.url), 'utf8'))
  .replace('__ZAP_BUILD__', JSON.stringify('current'));

test('reloads once for a new completed build; ignores missing markers and unrelated alarms', async () => {
  let handler;
  let marker = 'current';
  let reloads = 0;
  let missing = false;
  vm.runInNewContext(source, {
    chrome: {
      runtime: { getURL: p => p, reload: () => reloads++ },
      alarms: { onAlarm: { addListener: f => { handler = f; } }, create: () => Promise.resolve() },
    },
    fetch: async () => {
      if (missing) throw new Error('Build in progress');
      return { ok: true, json: async () => ({ build: marker }) };
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  assert.equal(reloads, 0);
  missing = true;
  handler({ name: 'zap:check-build' });
  await settle();
  assert.equal(reloads, 0);
  missing = false;
  marker = 'next';
  handler({ name: 'other' });
  await settle();
  assert.equal(reloads, 0);
  handler({ name: 'zap:check-build' });
  await settle();
  assert.equal(reloads, 1);
  handler({ name: 'zap:check-build' });
  await settle();
  assert.equal(reloads, 1);
});
