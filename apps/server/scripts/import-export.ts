import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(serverDir, ".env") });

import { createTokenVerifier } from "../src/http/supabase-auth.js";
import { openDatabase } from "../src/db/database.js";
import { importLegacyExport } from "../src/import/legacy-import.js";

function usage(): never {
  console.error("Usage: npm run import -- /path/to/youtube-ad-impressions-export.json");
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) usage();

let data: unknown;
try {
  data = JSON.parse(readFileSync(resolve(filePath), "utf8"));
} catch (error) {
  console.error(
    `Cannot read export file: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

// Imports use a verified user token too; file contents cannot choose ownership.
if (!process.env.IMPORT_ACCESS_TOKEN || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Set IMPORT_ACCESS_TOKEN and SUPABASE_PUBLISHABLE_KEY for an authenticated import.");
}
const { userId } = await createTokenVerifier(
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PUBLISHABLE_KEY,
)(process.env.IMPORT_ACCESS_TOKEN);

// Honors DATABASE_URL when set (PostgreSQL), otherwise the SQLite file.
const database = await openDatabase({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_FILE: resolve(serverDir, process.env.DATABASE_FILE ?? "./data/ad-impressions.sqlite"),
});
try {
  const summary = await importLegacyExport(database.store, userId, data);
  // Summary counts only — never the payload.
  console.info(
    `Imported ${summary.accepted} impressions ` +
      `(${summary.duplicates} duplicates, ${summary.rejected} rejected).`,
  );
} catch (error) {
  console.error(`Import failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
