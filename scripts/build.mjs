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
const dist = join(root, "dist");
const shared = {
  bundle: true,
  sourcemap: true,
  target: "es2022",
  logLevel: "info",
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

// Popup script: runs in a plain `<script>` tag, so IIFE as well.
await esbuild.build({
  ...shared,
  entryPoints: [join(root, "popup/popup.ts")],
  outfile: join(dist, "popup/popup.js"),
  format: "iife",
  platform: "browser",
});

await cp(join(root, "popup/popup.html"), join(dist, "popup/popup.html"));
await cp(join(root, "popup/popup.css"), join(dist, "popup/popup.css"));

console.info("Build complete: dist/{background,content}.js + dist/popup/");
