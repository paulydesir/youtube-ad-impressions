import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import request from "supertest";
import * as schema from "../src/db/postgres/schema.js";
import { createPostgresStore } from "../src/repositories/store.js";
import { createApp } from "../src/http/app.js";
import { createTokenVerifier } from "../src/http/supabase-auth.js";
import { getAdvertiserOverview, getAdvertiserStats, searchImpressions } from "../src/services/impressions.js";
import { sampleImpression } from "../../extension/test/sample-impression.js";
import { toAdImpressionV1 } from "../../extension/src/api/impression-mapper.js";

it.skipIf(process.env.AUTH_INTEGRATION !== "1")("real Supabase users have isolated Postgres writes, batches, analytics, idempotency and cascades", async () => {
  const config = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" }));
  const pool = new pg.Pool({ connectionString: config.DB_URL });
  const store = createPostgresStore(drizzle(pool, { schema }));
  const app = createApp({ store, isDatabaseReady: async () => true, mcpToken: "mcp-test", verifyAccessToken: createTokenVerifier(config.API_URL, config.ANON_KEY) });
  const users: Array<{ id: string; token: string }> = [];
  try {
    for (const name of ["alice", "bob"]) {
      const client = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.signUp({ email: `tenant-${name}-${randomUUID()}@example.com`, password: randomUUID() + "Aa1!" });
      expect(error).toBeNull();
      users.push({ id: data.user!.id, token: data.session!.access_token });
    }
    const [alice, bob] = users as [typeof users[number], typeof users[number]];
    const body = async (event: string, headline: string) => toAdImpressionV1(sampleImpression({ event_id: event, advertiser_url: "shared.example", ad_headline: headline, creative_title: headline }));
    const post = (user: typeof alice, payload: unknown, path = "") => request(app).post(`/api/v1/impressions${path}`).set("Authorization", `Bearer ${user.token}`).send(payload);
    const a1 = await body("shared-event", "Alice private");
    expect((await post(alice, { ...a1, userId: bob.id, user_id: bob.id })).status).toBe(201);
    expect((await post(alice, a1)).body.duplicate).toBe(true);
    expect((await post(alice, [await body("A2", "Alice second"), { invalid: true }], "/batch")).body).toMatchObject({ accepted: 1, rejected: 1 });
    expect((await post(bob, await body("shared-event", "Bob private"))).status).toBe(201);
    for (const [owner, other, expected] of [[alice, bob, ["A2", "shared-event"]], [bob, alice, ["shared-event"]]] as const) {
      const result = await request(app).get(`/api/v1/impressions?userId=${other.id}&user_id=${other.id}`).set("Authorization", `Bearer ${owner.token}`).set("X-User-Id", other.id);
      expect(result.status).toBe(200);
      expect(result.body.records.map((r: {eventId: string}) => r.eventId).sort()).toEqual([...expected].sort());
      expect(result.body.records.every((r: {adHeadline: string}) => r.adHeadline.startsWith(owner === alice ? "Alice" : "Bob"))).toBe(true);
      expect((await searchImpressions(store, owner.id, { terms: [owner === alice ? "Bob" : "Alice"] }))).toEqual([]);
      const stats = await getAdvertiserStats(store, owner.id);
      expect(stats[0]!.impressionCount).toBe(expected.length);
      const overview = await getAdvertiserOverview(store, owner.id, "shared");
      expect(overview.stats!.impressionCount).toBe(expected.length);
      expect(overview.headlines.every(h => h.startsWith(owner === alice ? "Alice" : "Bob"))).toBe(true);
      expect(overview.creativeTitles.every(h => h.startsWith(owner === alice ? "Alice" : "Bob"))).toBe(true);
    }
    const ownership = await pool.query("select user_id, count(*)::int as count from ad_impressions where user_id = any($1::uuid[]) group by user_id", [users.map(u => u.id)]);
    expect(ownership.rows.find(r => r.user_id === alice.id).count).toBe(2);
    expect(ownership.rows.find(r => r.user_id === bob.id).count).toBe(1);
    const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify({ sub: alice.id, exp: 1, aud: "authenticated", iss: `${config.API_URL}/auth/v1` })).toString("base64url");
    const expired = `${h}.${p}.${createHmac("sha256", config.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
    for (const token of [undefined, "invalid", expired]) {
      for (const [method, path] of [["get", ""], ["post", ""], ["post", "/batch"]] as const) {
        const call = request(app)[method](`/api/v1/impressions${path}`);
        if (token) call.set("Authorization", `Bearer ${token}`);
        expect((await call).status).toBe(401);
      }
    }
    await expect(store.searchImpressions(undefined as unknown as string)).rejects.toThrow(/userId/);
    await pool.query("delete from auth.users where id=$1", [alice.id]);
    expect((await pool.query("select id from profiles where id=$1", [alice.id])).rowCount).toBe(0);
    expect((await store.searchImpressions(alice.id))).toEqual([]);
    expect((await store.searchImpressions(bob.id))).toHaveLength(1);
  } finally {
    await pool.query("delete from auth.users where id = any($1::uuid[])", [users.map(u => u.id)]);
    await pool.end();
  }
}, 30000);
