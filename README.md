# YouTube Ad Impressions

A privacy-first Chrome extension for observing, storing, and analyzing YouTube
video-ad impressions. All history stays in extension-owned IndexedDB storage.

This repository is a private npm-workspaces monorepo. The extension lives in
`apps/extension`; `apps/server` and `packages/contracts` are reserved locations
for the local companion-server work described in
`CHATGPT_EXTENSION_DATA_MVP_SPEC.md`.

## Develop (TypeScript 7)

Requires Node 24+ (tests rely on native type-stripping).

```sh
npm install
npm run typecheck:extension  # tsc --noEmit for the extension workspace
npm run build:extension      # typecheck + esbuild bundles into apps/extension/dist/
npm test                     # all workspace tests (currently the extension tests)
npm run test:extension       # extension tests only
```

## Load locally

1. Run `npm run build:extension` so `apps/extension/dist/` exists (the manifest
   points at `dist/` relative to `apps/extension`).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `apps/extension` directory.
5. Open a YouTube watch page and then open DevTools.

Click the extension toolbar icon to open the local analytics dashboard.

The content script logs a startup message plus `ad-start` and `ad-end` payloads prefixed with
`[YouTube Ad Impressions]`. It also dispatches the same payloads on `document`:

```js
document.addEventListener("youtube-ad-impression-transition", (event) => {
  console.log(event.detail);
});
```

For a quick status check, select the extension's content-script context in the
DevTools console context dropdown and run:

```js
__youtubeAdImpressionWatcher.active
```

From the normal page context, this installation check should return `"ready"`:

```js
document.documentElement.dataset.youtubeAdImpressionWatcher
```

## Test

```sh
npm test
```

Run from the repository root; it delegates to each workspace. The extension
tests can also be run directly from `apps/extension` with `npm test`.

## Layout

- `apps/extension/src/*.ts` — ESM sources (`types.ts` holds the storage/message schema).
- `apps/extension/popup/popup.ts` — dashboard source; `popup.html`/`popup.css` are copied as-is.
- `apps/extension/dist/` — gitignored build output (`background.js`, `content.js`, `popup/`).
- `apps/extension/test/*.test.ts` — `node:test` suites importing `../src/*.ts` directly.
- `apps/server/` — reserved for the local companion server (Feature 1+).
- `packages/contracts/` — reserved for shared schemas and transport types (Feature 2+).

Bundling note: Chrome content scripts load as classic scripts and reject
static `import` statements, so `src/content.ts` (+ `ad-state-machine.ts`) is
bundled to a single IIFE. The service worker stays ESM (`"type": "module"`).

## Current behavior

- Watches `#movie_player` for `ad-showing` or `ad-interrupting`.
- Deduplicates repeated class mutations into a single lifecycle.
- Watches `.ytp-visit-advertiser-link__text` during a pod and emits a separate
  `ad-impression-start` / `ad-impression-end` lifecycle for each domain change.
- Captures advertiser name/domain, headline, CTA, creative title, disclosure,
  pod position/size, avatar, media duration/state, skip availability, and player
  version from the active overlay.
- Marks an impression when its skip button is clicked.
- Commits completed impressions to the `impressions` store in `AdTrackerDB`.
- Tracks non-ad playback time to calculate ads per watch hour.
- Shows impression count, total ad time, skip rate, advertiser rankings, and
  recent history in the extension popup.
- Exports the IndexedDB contents to a versioned JSON backup from the popup,
  and restores it via Merge (skips duplicates) or Replace (clears first).
- Calculates elapsed duration on the end transition.
- Reattaches when YouTube replaces the player during SPA navigation.
- Ends an active lifecycle if the player is replaced or the page is hidden.

The actual advertiser landing URL is not available in the observed DOM; the
extension stores the displayed advertiser domain instead.
