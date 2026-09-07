import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/postgres/schema.ts",
  out: "./migrations-pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://ad_impressions:ad_impressions@127.0.0.1:5432/ad_impressions",
  },
});
