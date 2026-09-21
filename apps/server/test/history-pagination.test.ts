import assert from "node:assert/strict";
import { it } from "vitest";
import express from "express";
import request from "supertest";
import { createImpressionsRouter } from "../src/http/impressions.js";
import type { CompactImpression, ImpressionStore } from "../src/repositories/store.js";

it("pages authenticated history beyond 100 using a validated cursor", async () => {
  const rows = Array.from({ length: 115 }, (_, index) => ({
    eventId: String(115 - index).padStart(3, "0"), startedAt: "2026-09-21T12:00:00.000Z",
  })) as CompactImpression[];
  const store = {
    searchImpressions: async (userId, filters) => {
      assert.equal(userId, "test-owner");
      return rows.filter(row => !filters?.before || row.eventId < filters.before.eventId).slice(0, filters?.limit);
    },
  } as ImpressionStore;
  const app = express();
  app.use("/impressions", createImpressionsRouter(store, async () => ({ userId: "test-owner", email: "test@example.com" })));
  const first = await request(app).get("/impressions?limit=1000").set("Authorization", "Bearer test");
  assert.equal(first.status, 200);
  assert.equal(first.body.records.length, 100);
  const second = await request(app).get("/impressions").query({ cursor: first.body.nextCursor }).set("Authorization", "Bearer test");
  assert.equal(second.status, 200);
  assert.equal(second.body.records.length, 15);
  assert.equal(second.body.nextCursor, null);
  assert.equal(new Set([...first.body.records, ...second.body.records].map(row => row.eventId)).size, 115);
  assert.equal((await request(app).get("/impressions").query({ cursor: "invalid" }).set("Authorization", "Bearer test")).status, 400);
  assert.equal((await request(app).get("/impressions")).status, 401);
});
