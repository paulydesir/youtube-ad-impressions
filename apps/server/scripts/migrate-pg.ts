import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeEnvironment } from "../src/config/runtime-environment.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
loadRuntimeEnvironment(serverDir);

import {
  closePostgresDatabase,
  initializePostgresDatabase,
} from "../src/db/postgres/client.js";

// Migration-only entry point for PostgreSQL: applies pending migrations from
// migrations-pg and exits without requiring ingestion tokens.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL must be set to run Postgres migrations.");
  process.exit(1);
}
const db = await initializePostgresDatabase(connectionString);
await closePostgresDatabase(db);
console.info("Postgres migrations applied.");
