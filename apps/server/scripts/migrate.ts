import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(serverDir, ".env") });

import { closeDatabase, initializeDatabase } from "../src/db/client.js";

// Migration-only entry point: applies pending migrations and exits without
// requiring the ingestion token or starting the HTTP server.
const databaseFile = resolve(
  serverDir,
  process.env.DATABASE_FILE ?? "./data/ad-impressions.sqlite",
);
const db = initializeDatabase(databaseFile);
closeDatabase(db);
console.info(`Migrations applied to ${databaseFile}`);
