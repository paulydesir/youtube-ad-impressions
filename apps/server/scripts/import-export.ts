import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(serverDir, ".env") });

import { closeDatabase, initializeDatabase } from "../src/db/client.js";
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

const databaseFile = resolve(
  serverDir,
  process.env.DATABASE_FILE ?? "./data/ad-impressions.sqlite",
);
const db = initializeDatabase(databaseFile);
try {
  const summary = await importLegacyExport(db, data);
  // Summary counts only — never the payload.
  console.info(
    `Imported ${summary.accepted} impressions ` +
      `(${summary.duplicates} duplicates, ${summary.rejected} rejected).`,
  );
} catch (error) {
  console.error(`Import failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  closeDatabase(db);
}
