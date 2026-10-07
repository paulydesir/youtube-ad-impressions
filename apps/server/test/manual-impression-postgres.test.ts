import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import request from "supertest";
import * as schema from "../src/db/postgres/schema.js";
import { createPostgresStore } from "../src/repositories/store.js";
import { createApp } from "../src/http/app.js";
import { manualImpression } from "../../extension/popup/manual-impression.js";
import { toAdImpressionV1 } from "../../extension/src/api/impression-mapper.js";

it.skipIf(!process.env.DATABASE_URL)("manual offers persist as private impressions without creating ads or jobs", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const userId = randomUUID();
    if ((await client.query("select to_regclass('auth.users') as users")).rows[0].users) await client.query("insert into auth.users (id) values ($1)", [userId]);
    const store = createPostgresStore(drizzle(client, { schema }) as unknown as Parameters<typeof createPostgresStore>[0]);
    const app = createApp({ store, isDatabaseReady: async () => true, verifyAccessToken: async () => ({ userId, email: "test@example.com" }) });
    const before = (await client.query("select (select count(*) from ads) as ads, (select count(*) from transcription_jobs) as jobs")).rows[0];
    const body = await toAdImpressionV1(manualImpression("Bank", "Sign up for checking and get $400", "https://bank.example/bonus"));
    const post = (payload: object) => request(app).post("/api/v1/impressions").set("Authorization", "Bearer test-token").send(payload);
    expect((await request(app).post("/api/v1/impressions").send(body)).status).toBe(401);
    expect((await post(body)).status).toBe(201);
    expect((await post(body)).body.duplicate).toBe(true);
    expect((await post({ ...body, adVideoId: "dQw4w9WgXcQ" })).status).toBe(400);
    const history = await store.searchImpressions(userId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "manual", adHeadline: body.ad_headline, sourceUrl: body.source_url, adId: null, adVideoId: null, durationMs: null });
    expect(await store.searchImpressions(randomUUID())).toEqual([]);
    expect((await client.query("select (select count(*) from ads) as ads, (select count(*) from transcription_jobs) as jobs")).rows[0]).toEqual(before);
  } finally {
    await client.query("rollback"); client.release(); await pool.end();
  }
});
