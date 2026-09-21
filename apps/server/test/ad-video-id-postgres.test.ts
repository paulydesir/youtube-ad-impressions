import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import request from "supertest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/postgres/schema.js";
import { createPostgresStore } from "../src/repositories/store.js";
import { createApp } from "../src/http/app.js";
import { sampleImpression } from "../../extension/test/sample-impression.js";
import { toAdImpressionV1 } from "../../extension/src/api/impression-mapper.js";

it.skipIf(!process.env.DATABASE_URL)("POST persists optional adVideoId and rejects invalid types", async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Roll back all fixtures, including the profile, after exercising real SQL.
    const userId = randomUUID();
    if ((await client.query("select to_regclass('auth.users') as users")).rows[0].users) {
      await client.query("insert into auth.users (id) values ($1)", [userId]);
    }
    const store = createPostgresStore(drizzle(client, { schema }) as unknown as Parameters<typeof createPostgresStore>[0]);
    const app = createApp({ store, isDatabaseReady: async () => true,
      verifyAccessToken: async () => ({ userId, email: "test@example.com" }) });
    for (const adVideoId of ["c60usiz-Z34", undefined]) {
      const body = await toAdImpressionV1(sampleImpression({ event_id: randomUUID(), adVideoId }));
      const response = await request(app).post("/api/v1/impressions").set("Authorization", "Bearer test-token").send(body);
      expect(response.status).toBe(201);
      const result = await client.query("select ad_video_id, raw_json from ad_impressions where user_id=$1 and event_id=$2", [userId, body.event_id]);
      expect(result.rows[0].ad_video_id).toBe(adVideoId ?? null);
      expect(JSON.parse(result.rows[0].raw_json).adVideoId).toBe(adVideoId);
      const invalid = await request(app).post("/api/v1/impressions").set("Authorization", "Bearer test-token").send({ ...body, adVideoId: 123 });
      expect(invalid.status).toBe(400);
    }
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
});
