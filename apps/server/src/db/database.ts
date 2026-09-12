import type { ServerConfig } from "../config/env.js";
import {
  closePostgresDatabase,
  initializePostgresDatabase,
  isPostgresDatabaseReady,
} from "./postgres/client.js";
import { createPostgresStore, type ImpressionStore } from "../repositories/store.js";

export type DatabaseKind = "postgres";

export interface Database {
  kind: DatabaseKind;
  store: ImpressionStore;
  label: string;
  isReady(): Promise<boolean>;
  close(): Promise<void>;
}

type DatabaseSelector = Pick<ServerConfig, "DATABASE_URL">;

export async function openDatabase(config: DatabaseSelector): Promise<Database> {
  const client = await initializePostgresDatabase(config.DATABASE_URL);
  return {
    kind: "postgres",
    store: createPostgresStore(client),
    label: redactConnectionString(config.DATABASE_URL),
    isReady: () => isPostgresDatabaseReady(client),
    close: () => closePostgresDatabase(client),
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
