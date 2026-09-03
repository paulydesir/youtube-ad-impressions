import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type DatabaseClient = BetterSQLite3Database<typeof schema>;

// Opens (creating parent directories as needed) and migrates the SQLite
// database, returning a typed Drizzle client.
export function initializeDatabase(databaseFile: string): DatabaseClient {
  mkdirSync(dirname(databaseFile), { recursive: true });
  const sqlite = new Database(databaseFile);
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "migrations",
    ),
  });
  return db;
}

// Closes the underlying SQLite connection. The `$client` accessor exists at
// runtime but is not on the public driver type, so the reach-through lives
// here instead of at call sites.
export function closeDatabase(db: DatabaseClient): void {
  const client = (db as unknown as { $client: { close(): void } }).$client;
  client.close();
}
