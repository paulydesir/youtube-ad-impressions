import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type Pool as PgPool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

export type PostgresDatabaseClient = NodePgDatabase<typeof schema> & {
  $client: PgPool;
};

export async function initializePostgresDatabase(
  connectionString: string,
): Promise<PostgresDatabaseClient> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "migrations-pg",
    ),
  });
  return db;
}

export async function isPostgresDatabaseReady(
  db: PostgresDatabaseClient,
): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function closePostgresDatabase(
  db: PostgresDatabaseClient,
): Promise<void> {
  await db.$client.end();
}
