# YouTube Ad Impressions

A privacy-first Chrome extension for observing, storing, and analyzing YouTube
video-ad impressions. Impression history is stored by the local companion
server in PostgreSQL when `DATABASE_URL` is configured.

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

Start the companion server with `npm run dev`, using `apps/server/.env` for
`DATABASE_URL`, `INGEST_API_TOKEN`, and the separate `MCP_API_TOKEN`.
Click the extension toolbar icon, expand **Server connection**, paste the value
of `INGEST_API_TOKEN` into **Server API token**, and click **Save & connect**.
The extension saves this as `localServerIngestToken` in `chrome.storage.local`
and immediately fetches the dashboard. New impressions use the same token.
The extension cannot read the server's `.env` file automatically.

A missing token prevents both GET and POST requests from being sent. A wrong
token produces HTTP 401. The popup displays these errors and lets you update
the token or retry. Inspect API calls in the extension's service-worker DevTools
(the **service worker** link on `chrome://extensions`), rather than the YouTube
tab's Network panel. Content dispatch logs appear in the YouTube tab console.
Impressions that failed before configuration are not automatically replayed.

After rebuilding and reloading the extension, refresh existing YouTube tabs too.
Old content scripts cannot reconnect to the reloaded extension; they stop tracking
and expose `reload-required` in the watcher diagnostic until the tab is refreshed.

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
- `apps/extension/popup/popup.tsx` — React entry point; `App.tsx` contains the dashboard components; `popup.html`/`popup.css` are copied as-is.
- `apps/extension/dist/` — gitignored build output (`background.js`, `content.js`, `popup/`).
- `apps/extension/test/*.test.ts` — `node:test` suites importing `../src/*.ts` directly.
- `apps/server/` — reserved for the local companion server (Feature 1+).
- `packages/contracts/` — reserved for shared schemas and transport types (Feature 2+).

The popup uses React and React DOM, bundled locally in production mode with esbuild.
No remote scripts or additional Chrome permissions are required.

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
- Sends completed impressions to the authenticated local server API.
- Tracks non-ad playback time to calculate ads per watch hour.
- Shows impression count, total ad time, skip rate, advertiser rankings, and
  recent history in the extension popup.
- Reads popup history from the server; browser database backup/restore is retired.
- Calculates elapsed duration on the end transition.
- Reattaches when YouTube replaces the player during SPA navigation.
- Ends an active lifecycle if the player is replaced or the page is hidden.

The actual advertiser landing URL is not available in the observed DOM; the
extension stores the displayed advertiser domain instead.
