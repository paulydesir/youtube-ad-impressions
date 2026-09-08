import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import pg from "pg";
import { sampleImpression } from "../../extension/test/sample-impression.js";
import { createApp } from "../src/http/app.js";
import { createTokenVerifier } from "../src/http/supabase-auth.js";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/postgres/schema.js";
import { createPostgresStore } from "../src/repositories/store.js";

// jsdom belongs to the extension workspace; this test exercises its actual popup.
const require = createRequire(new URL("../../extension/package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const { build } = require("esbuild");
it.skipIf(process.env.AUTH_INTEGRATION !== "1")("local popup signup, profile trigger, login, restore, bearer /me, logout and cascade", async () => {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" }));
  const db = new pg.Pool({ connectionString: status.DB_URL });
  await db.query("select 1");

  const app = createApp({ store: createPostgresStore(drizzle(db, { schema })), isDatabaseReady: async () => true, mcpToken: "test-mcp", verifyAccessToken: createTokenVerifier(status.API_URL, status.ANON_KEY) });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const email = `auth-slice-${randomUUID()}@example.com`;
  const password = `Auth-${randomUUID()}!`;
  let userId: string | undefined;
  let dom: any;
  let worker: any;
  let workerMessage: any;
  const requests: Array<string | null> = [];
  const bundle = await build({ entryPoints: [new URL("../../extension/popup/popup.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: JSON.stringify(status.API_URL), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(status.ANON_KEY) } });
  const sharedStorage: Record<string, string> = {};
  const warnings: string[] = [];
  function mount(_storage?: Record<string, string>) {
    dom = new JSDOM('<div id="root"></div>', { runScripts: "outside-only", url: "https://extension.test" });

    dom.window.console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    dom.window.fetch = async (input: string, init?: RequestInit) => {
      if (String(input).startsWith("http://127.0.0.1:8787")) {
        requests.push(new Headers(init?.headers).get("Authorization"));
        input = String(input).replace("http://127.0.0.1:8787", base);
      }
      return fetch(input, init);
    };
    dom.window.chrome = { storage: { local: { get: async (key: string) => ({ [key]: sharedStorage[key] }), set: async (values: Record<string, string>) => { Object.assign(sharedStorage, values); }, remove: async (key: string) => { delete sharedStorage[key]; }, setAccessLevel: async () => {} } }, runtime: { sendMessage: (_: unknown, cb: (v: unknown) => void) => cb({ ok: false, error: "Test dashboard offline" }) } };
    dom.window.eval(bundle.outputFiles[0]!.text);
  }
  async function wait(check: () => boolean) {
    for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(r => setTimeout(r, 20)); }
    throw new Error(`UI timeout: ${dom.window.document.querySelector('.auth-panel')?.textContent}`);
  }
  const panel = () => dom.window.document.querySelector(".auth-panel");
  const text = () => panel()?.textContent ?? "";
  async function click(label: string) {
    const button = [...panel().querySelectorAll("button")].find((b: any) => b.textContent === label) as any;
    expect(button, label).toBeTruthy(); button.click();
    await new Promise(r => setTimeout(r, 0));
  }
  function submit(pass = password) {
    panel().querySelector('[name="email"]').value = email;
    panel().querySelector('[name="password"]').value = pass;
    const name = panel().querySelector('[name="name"]'); if (name) name.value = "Auth Test";
    panel().querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  }
  try {
    mount(); await wait(() => text().includes("Create an account"));
    await click("Check /me"); await wait(() => text().includes("401"));
    await click("Create an account");
    submit("x"); await wait(() => !!panel().querySelector('[role="alert"]')); // Supabase signup rejection
    submit(); await wait(() => text().includes("Account created."));
    const rows = await db.query("select u.id, u.email, p.id as profile_id, p.name from auth.users u join public.profiles p on p.id = u.id where u.email = $1", [email]);
    expect(rows.rows).toHaveLength(1); userId = rows.rows[0].id;
    expect(rows.rows[0]).toMatchObject({ profile_id: userId, name: "Auth Test", email });
    await click("Check /me"); await wait(() => text().includes(`(${userId})`));
    expect(requests.at(-1)).toMatch(/^Bearer ey/);
    // Run the actual background bundle in a separate context sharing Chrome storage.
    const workerBundle = await build({ entryPoints: [new URL("../../extension/src/background.ts", import.meta.url).pathname], bundle: true, write: false, format: "iife", platform: "browser", define: { __SUPABASE_URL__: JSON.stringify(status.API_URL), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(status.ANON_KEY) } });
    worker = new JSDOM("", { runScripts: "outside-only", url: "https://extension.test" });
    worker.window.console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    worker.window.fetch = dom.window.fetch;
    worker.window.AbortSignal = AbortSignal;
    worker.window.crypto.randomUUID = randomUUID;
    worker.window.chrome = { tabs: { query: async () => [], onUpdated: { addListener: () => {} } }, storage: dom.window.chrome.storage, runtime: { onMessage: { addListener: (listener: unknown) => { workerMessage = listener; } } } };
    worker.window.eval(workerBundle.outputFiles[0]!.text);
    const sendWorker = (message: unknown) => new Promise<any>(resolve => workerMessage(message, {}, resolve));
    const sessionKey = Object.keys(sharedStorage).find(key => {
      try { return Boolean(JSON.parse(sharedStorage[key]!).access_token); } catch { return false; }
    })!;
    const expiringSession = JSON.parse(sharedStorage[sessionKey]!);
    sharedStorage[sessionKey] = JSON.stringify({ ...expiringSession, expires_at: 1 });
    const saved = await sendWorker({ type: "record-impression", record: sampleImpression({ event_id: randomUUID() }) });
    expect(saved.ok).toBe(true);
    expect(JSON.parse(sharedStorage[sessionKey]!).expires_at).toBeGreaterThan(Date.now() / 1000);
    expect((await sendWorker({ type: "get-dashboard" })).ok).toBe(true);
    expect(requests.at(-1)).toMatch(/^Bearer ey/);
    for (const path of ["/api/v1/impressions", "/api/v1/impressions/batch"]) {
      for (const method of ["GET", "POST"]) {
        expect((await fetch(`${base}${path}`, { method, headers: { Authorization: "Bearer test-ingest" } })).status).toBe(401);
      }
    }

    const stored = Object.fromEntries(Object.keys(dom.window.localStorage).map(key => [key, dom.window.localStorage.getItem(key)]));
    dom.window.close(); mount(stored);
    await wait(() => text().includes(`Signed in as ${email}`));
    await click("Log out"); await wait(() => text().includes("Signed out."));
    await click("Check /me"); await wait(() => text().includes("401")); expect(requests.at(-1)).toBeNull();
    const countAfterLogout = requests.length;
    expect((await sendWorker({ type: "get-dashboard" })).ok).toBe(false);
    expect(requests).toHaveLength(countAfterLogout);
    submit("incorrect-password"); await wait(() => text().includes("Invalid login credentials"));
    submit(); await wait(() => text().includes("Signed in."));
    await click("Check /me"); await wait(() => text().includes(`(${userId})`));
    // A correctly signed but expired token must fail against real local Auth.
    const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ sub: userId, email, aud: "authenticated", role: "authenticated", iss: `${status.API_URL}/auth/v1`, exp: 1 })).toString("base64url");
    const expired = `${h}.${p}.${createHmac("sha256", status.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
    expect((await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(401);
    await click("Log out"); await wait(() => text().includes("Signed out."));
    expect(warnings.filter(message => message.includes('"lock" option'))).toEqual([]);
    await db.query("delete from auth.users where id = $1", [userId]);
    expect((await db.query("select id from public.profiles where id = $1", [userId])).rowCount).toBe(0);
  } finally {
    dom?.window.close(); worker?.window.close();
    await db.query("delete from auth.users where email = $1", [email]);
    await db.end();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}, 30000);
