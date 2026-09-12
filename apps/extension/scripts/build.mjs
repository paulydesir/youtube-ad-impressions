// Chrome requires the content script as an IIFE and the service worker as ESM.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production" : ".env";
try { process.loadEnvFile(join(root, envFile)); } catch (error) { if (error.code !== "ENOENT") throw error; }
const supabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const serverUrl = process.env.SERVER_URL || "http://127.0.0.1:8787";
if (!supabaseKey) throw new Error(`Set SUPABASE_PUBLISHABLE_KEY in apps/extension/${envFile} (use --prod for production).`);
if (supabaseKey.startsWith("sb_secret_") || (supabaseKey.split(".").length === 3 && JSON.parse(Buffer.from(supabaseKey.split(".")[1], "base64url")).role !== "anon")) {
  throw new Error("Extension requires a public anon/publishable key.");
}
const dist = join(root, "dist");
const shared = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: JSON.stringify(supabaseUrl), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabaseKey), __SERVER_URL__: JSON.stringify(serverUrl) },
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "popup"), { recursive: true });

await esbuild.build({
  ...shared,
  entryPoints: [join(root, "src/background.ts")],
  outfile: join(dist, "background.js"),
  format: "esm",
  platform: "browser",
});

await esbuild.build({
  ...shared,
  entryPoints: [join(root, "src/content.ts")],
  outfile: join(dist, "content.js"),
  format: "iife",
  platform: "browser",
});

await esbuild.build({
  ...shared,
  entryPoints: [join(root, "popup/popup.tsx")],
  define: { "process.env.NODE_ENV": '"production"', __SUPABASE_URL__: JSON.stringify(supabaseUrl), __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(supabaseKey), __SERVER_URL__: JSON.stringify(serverUrl) },
  minify: true,
  outfile: join(dist, "popup/popup.js"),
  format: "iife",
  platform: "browser",
});

await cp(join(root, "popup/popup.html"), join(dist, "popup/popup.html"));
await cp(join(root, "popup/popup.css"), join(dist, "popup/popup.css"));

console.info("Build complete: dist/{background,content}.js + dist/popup/");
