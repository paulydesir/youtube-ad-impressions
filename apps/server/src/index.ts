import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/env.js";
import { loadRuntimeEnvironment } from "./config/runtime-environment.js";
import { openDatabase } from "./db/database.js";
import { createTokenVerifier } from "./http/supabase-auth.js";
import { createApp } from "./http/app.js";
import { createMcpTokenVerifier } from "./mcp/auth.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function reportFatal(error: unknown): never {
  // eslint-disable-next-line no-console -- startup failures must be visible
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    const appEnvironment = loadRuntimeEnvironment(serverDir);
    config = loadConfig({ ...process.env, APP_ENV: appEnvironment });
  } catch (error) {
    reportFatal(error);
  }

  let database: Awaited<ReturnType<typeof openDatabase>>;
  try {
    database = await openDatabase(config);
  } catch (error) {
    reportFatal(`Failed to open PostgreSQL database (DATABASE_URL): ${error instanceof Error ? error.message : error}`);
  }

  const app = createApp({
    verifyAccessToken: config.SUPABASE_PUBLISHABLE_KEY
      ? createTokenVerifier(config.SUPABASE_URL)
      : undefined,
    store: database.store,
    isDatabaseReady: () => database.isReady(),
    mcpAuth: {
      resourceUrl: config.MCP_RESOURCE_URL,
      supabaseUrl: config.SUPABASE_URL,
      verifyAccessToken: createMcpTokenVerifier(config.SUPABASE_URL, config.MCP_RESOURCE_URL),
    },
    consent: config.SUPABASE_PUBLISHABLE_KEY
      ? { supabaseUrl: config.SUPABASE_URL, publishableKey: config.SUPABASE_PUBLISHABLE_KEY }
      : undefined,
    requestLog: config.LOG_LEVEL === "debug" ? (message) => {
      // eslint-disable-next-line no-console -- debug-only request log
      console.info(`[Ad Impressions Server] ${message}`);
    } : undefined,
  });

  const server = app.listen(config.PORT, config.HOST);
  server.on("error", (error: NodeJS.ErrnoException) => {
    reportFatal(`Failed to listen on ${config.HOST}:${config.PORT}: ${error.message}`);
  });

  function shutdown(): void {
    void database
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch(reportFatal);
