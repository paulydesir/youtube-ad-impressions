import type { ServerConfig } from "../config/env.js";
import { closeDatabase, initializeDatabase, isDatabaseReady } from "./client.js";
import {
  closePostgresDatabase,
  initializePostgresDatabase,
  isPostgresDatabaseReady,
} from "./postgres/client.js";
import {
  createPostgresStore,
  createSqliteStore,
  type ImpressionStore,
} from "../repositories/store.js";

export type DatabaseKind = "sqlite" | "postgres";

export interface Database {
  kind: DatabaseKind;
  store: ImpressionStore;
  // Human-readable backend description for startup logs (credentials redacted).
  label: string;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

type DatabaseSelector = Pick<ServerConfig, "DATABASE_URL" | "DATABASE_FILE">;

// Selects the storage backend from config: DATABASE_URL set means PostgreSQL
// (migrated from apps/server/migrations-pg), otherwise the local SQLite file.
// Callers use `store` for data access and never touch the raw client.
export async function openDatabase(config: DatabaseSelector): Promise<Database> {
  if (config.DATABASE_URL !== undefined) {
    const client = await initializePostgresDatabase(config.DATABASE_URL);
    return {
      kind: "postgres",
      store: createPostgresStore(client),
      label: redactConnectionString(config.DATABASE_URL),
      isReady: () => isPostgresDatabaseReady(client),
      close: () => closePostgresDatabase(client),
    };
  }
  const client = initializeDatabase(config.DATABASE_FILE);
  return {
    kind: "sqlite",
    store: createSqliteStore(client),
    label: config.DATABASE_FILE,
    isReady: () => Promise.resolve(isDatabaseReady(client)),
    close: () => {
      closeDatabase(client);
      return Promise.resolve();
    },
  };
}

function redactConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "postgresql://...";
  }
}
