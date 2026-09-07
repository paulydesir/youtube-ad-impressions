// Extension bundler: typechecked by `tsc --noEmit`, emitted by esbuild.
//
// Why a bundler instead of plain `tsc` emit? Chrome content scripts load as
// classic scripts and throw on static `import` statements, so `content.ts`
// (+ its `ad-state-machine.ts` dependency) must be inlined into one IIFE.
// The service worker keeps ESM format to match `"type": "module"` in the
// manifest. Output `dist/` is what gets loaded via "Load unpacked".
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(join(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!supabaseKey) throw new Error("Set SUPABASE_PUBLISHABLE_KEY in apps/extension/.env (local Supabase anon/publishable key).");
if (supabaseKey.startsWith("sb_secret_") || (supabaseKey.split(".").length === 3 && JSON.parse(Buffer.from(supabaseKey.split(".")[1], "base64url")).role !== "anon")) {
  throw new Error("Extension requires a public anon/publishable key.");
}
const dist = join(root, "dist");
const shared = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: JSON.stringify(supabaseUrl), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabaseKey) },
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "popup"), { recursive: true });

// Service worker: ESM to match manifest `"type": "module"`.
await esbuild.build({
  ...shared,
  entryPoints: [join(root, "src/background.ts")],
  outfile: join(dist, "background.js"),
  format: "esm",
  platform: "browser",
});

// Content script: classic-script IIFE, dependencies inlined (no imports left).
await esbuild.build({
  ...shared,
  entryPoints: [join(root, "src/content.ts")],
  outfile: join(dist, "content.js"),
  format: "iife",
  platform: "browser",
});

// React popup: bundle the production runtime locally for Manifest V3.
await esbuild.build({
  ...shared,
  entryPoints: [join(root, "popup/popup.tsx")],
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: JSON.stringify(supabaseUrl), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabaseKey) },
  minify: true,
  outfile: join(dist, "popup/popup.js"),
  format: "iife",
  platform: "browser",
});

await cp(join(root, "popup/popup.html"), join(dist, "popup/popup.html"));
await cp(join(root, "popup/popup.css"), join(dist, "popup/popup.css"));

console.info("Build complete: dist/{background,content}.js + dist/popup/");
