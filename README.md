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
`DATABASE_URL`, Supabase configuration, and the separate `MCP_API_TOKEN`.
Sign in through the extension popup. All extension requests to the Node API use
the current Supabase access token. There is no shared ingestion token to configure.

The popup and background worker share Supabase session storage in
`chrome.storage.local`, restricted to trusted extension contexts. Token refreshes
and logout use Supabase’s built-in coordination. Requests read the current session;
signed-out users cannot load or save impressions. Failed impressions are not
queued for replay. Inspect API calls in the extension service-worker DevTools.

Tracking attaches automatically to open YouTube tabs when the worker starts and
after navigation. No popup interaction is required. Old content scripts stop tracking
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

## Local email/password authentication

Start the existing stack with `npx supabase start`, then apply the profile migration
without resetting data: `npx supabase migration up --local`.

Run `npx supabase status` and copy its **publishable** (or legacy **anon**) key into
`SUPABASE_PUBLISHABLE_KEY` in both `apps/extension/.env` and `apps/server/.env`.
Set `SUPABASE_URL=http://127.0.0.1:54321` in both files. The extension example is
`apps/extension/.env.example`. Only these two public Supabase values are embedded
at build time; never use the service-role key, secret key, or JWT signing secret.
MCP retains its separate token; INGEST_API_TOKEN is no longer used.

Run `npm run dev` and `npm run build:extension`, then load/reload `apps/extension`
as an unpacked Chrome extension. Open the popup's Account section:

1. Create an account with email, password, and optional name. Local email
   confirmation is disabled in `supabase/config.toml`, so signup starts a session.
2. In local Studio (`http://127.0.0.1:54323`), confirm the Auth user and matching
   `public.profiles.id`. The trigger owns profile creation; its errors fail signup.
3. Log out and log in. Close and reopen the popup to check session restoration.
4. Click **Check /me**. It should show the email and UUID verified by the server.
5. Log out and click **Check /me** again. It should report `401`.

`GET /me` and all `/api/v1/impressions` routes use Supabase `auth.getClaims(token)` signature/expiry verification,
checks issuer and audience, and derives identity from the verified `sub` claim.
It ignores client user IDs. Profile RLS is enabled with no client policies because
this slice does not need direct profile access. If the server public key is absent,
these routes fail closed. Supabase access tokens already copied elsewhere may remain
valid until expiry after logout; the extension clears its session and sends no token.

Run `npm test` for normal tests. With local Supabase running and the migration
applied, run `AUTH_INTEGRATION=1 npm run test --workspace @ad-impressions/server`.
The integration test bundles the actual popup and exercises its forms in JSDOM
against real local Supabase and an HTTP Node server: signup success/failure,
profile UUID/name, login success/failure, restoration, bearer headers, `/me`,
logout/401, expired JWT rejection, and deletion cascade. It also runs the background
worker bundle in a separate context with shared extension storage, verifies ingestion
and history loading, refreshes an expired session, and checks logout blocks worker
requests. It removes its test user.
It does not replace the manual unpacked-extension check above.

Impression ownership, OAuth, and MCP authentication changes are outside this slice.
Authenticated accounts currently access the same impression history; per-user
record ownership and filtering remain a separate step.

## Next implementation

[Tenant ownership for ad impressions](docs/specs/next-tenant-ownership.md): require
JWT-derived `userId` at every repository boundary, scope writes/reads/analytics,
and verify isolation between two users.
