import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthApiClient } from "../src/api/auth-api-client.ts";

test("authenticated API reads the current token on each request and omits it after logout", async () => {
  let token: string | null = "first-token";
  const client = { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null }, error: null }) } } as unknown as SupabaseClient;
  const seen: Array<string | null> = [];
  const api = createAuthApiClient(client, "http://local.test", async (url, init) => {
    assert.equal(url, "http://local.test/me");
    seen.push(new Headers(init?.headers).get("Authorization"));
    return token ? Response.json({ id: "verified-id", email: "test@example.com" }) : Response.json({ error: "unauthorized" }, { status: 401 });
  });
  assert.equal((await api.getMe()).id, "verified-id");
  token = "refreshed-token"; await api.getMe();
  token = null; await assert.rejects(api.getMe(), /401/);
  assert.deepEqual(seen, ["Bearer first-token", "Bearer refreshed-token", null]);
});

test("session errors prevent API requests", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: new Error("Refresh failed") }) } } as unknown as SupabaseClient;
  const api = createAuthApiClient(client, "http://local.test", async () => { assert.fail("must not fetch"); });
  await assert.rejects(api.getMe(), /Refresh failed/);
});
