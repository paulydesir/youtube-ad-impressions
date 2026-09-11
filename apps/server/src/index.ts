import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import { createTokenVerifier } from "./http/supabase-auth.js";
import { createApp } from "./http/app.js";
import { createMcpTokenVerifier } from "./mcp/auth.js";

// Load apps/server/.env regardless of the working directory callers run
// from (e.g. `npm run dev` at the repo root). In dev this file sits next to
// src/; in the compiled build it sits next to dist/.
dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  let database;
  try {
    database = await openDatabase(config);
  } catch (error) {
    const target =
      config.DATABASE_URL !== undefined ? "PostgreSQL (DATABASE_URL)" : config.DATABASE_FILE;
    console.error(
      `Failed to open database at ${target}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  console.info(`Opened ${database.kind} database: ${database.label}`);
  console.info(`Database ready: ${await database.isReady()}`);

  const verbose = config.LOG_LEVEL === "debug" || config.LOG_LEVEL === "info";
  const app = createApp({
    verifyAccessToken: config.SUPABASE_PUBLISHABLE_KEY
      ? createTokenVerifier(config.SUPABASE_URL) : undefined,
    store: database.store,
    isDatabaseReady: () => database.isReady(),
    mcpAuth: {
      resourceUrl: config.MCP_RESOURCE_URL,
      supabaseUrl: config.SUPABASE_URL,
      verifyAccessToken: createMcpTokenVerifier(config.SUPABASE_URL, config.MCP_RESOURCE_URL),
    },
    consent: config.SUPABASE_PUBLISHABLE_KEY ? {
      supabaseUrl: config.SUPABASE_URL,
      publishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    } : undefined,
    requestLog: verbose
      ? (message) => console.info(`[Ad Impressions Server] ${message}`)
      : undefined,
    log: verbose ? (message) => console.info(`[Ad Impressions Server] ${message}`) : undefined,
  });
  const server = app.listen(config.PORT, config.HOST, () => {
    console.info(
      `Listening on http://${config.HOST}:${config.PORT} (${database.kind}: ${database.label})`,
    );
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Failed to listen on ${config.HOST}:${config.PORT}: ${error.message}`);
    process.exit(1);
  });

  // The PostgreSQL pool holds the event loop open; close it (or the SQLite
  // handle) before exiting so `docker stop` and Ctrl+C shut down cleanly.
  const shutdown = (signal: string) => {
    console.info(`Received ${signal}, closing database...`);
    void database
      .close()
      .catch((error: unknown) => {
        console.error(
          `Error closing database: ${error instanceof Error ? error.message : error}`,
        );
      })
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
