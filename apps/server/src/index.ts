import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadConfig } from "./config/env.js";
import { initializeDatabase } from "./db/client.js";
import { createApp } from "./http/app.js";

// Load apps/server/.env regardless of the working directory callers run
// from (e.g. `npm run dev` at the repo root). In dev this file sits next to
// src/; in the compiled build it sits next to dist/.
dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env"),
});

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  let db;
  try {
    db = initializeDatabase(config.DATABASE_FILE);
  } catch (error) {
    console.error(
      `Failed to open database at ${config.DATABASE_FILE}: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  const app = createApp({
    db,
    ingestToken: config.INGEST_API_TOKEN,
    requestLog:
      config.LOG_LEVEL === "debug" || config.LOG_LEVEL === "info"
        ? (message) => console.info(`[Ad Impressions Server] ${message}`)
        : undefined,
  });
  const server = app.listen(config.PORT, config.HOST, () => {
    console.info(`Listening on http://${config.HOST}:${config.PORT}`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`Failed to listen on ${config.HOST}:${config.PORT}: ${error.message}`);
    process.exit(1);
  });
}

main();
