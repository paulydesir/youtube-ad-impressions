# YouTube Ad Impressions

A Chrome extension that monitors the YouTube video player and captures metadata about the ads served to you. That data is stored in a database, and a backend server exposes it through an MCP server, allowing any compatible MCP client—such as ChatGPT—to query and interact with your personal ad history.

## Install

### Production Installation

The production version uses the hosted backend and database. Users do not need to install PostgreSQL, Supabase, Docker, or run the server themselves.

### Requirements

- Google Chrome
- An MCP-compatible client, such as ChatGPT
- A Google account for authentication

#### 1. Install the Chrome Extension

Install the extension from the Chrome Web Store.

> Chrome Web Store link coming soon.

Once installed, open the extension and sign in.

Authentication associates the ads captured by the extension with your account.

To record an offer from any source, open the signed-in popup and use **Add
impression**. Enter the advertiser and offer details, optionally add a source
link, then select **Save impression**. For example: “Bank — sign up for checking
and get $400.” It appears in Recent Impressions with a Manual label and counts
as an impression. No separate ad or transcription job is created. Manual entries
do not contribute to the popup's video duration, skip rate, or ads-per-watch-hour
metrics. The server must run the updated shared contract accepting `source:
"manual"`; no database migration is needed. Hosted use requires deploying the
updated backend.

#### 2. Use YouTube Normally

Open YouTube and watch videos as usual.

When YouTube serves an advertisement, the extension monitors the video player and captures available metadata about the ad.

This may include:

- Advertiser name
- Advertiser domain
- Ad headline
- Call to action
- Creative title
- Ad duration
- Whether the ad was skipped
- When the ad was shown

The extension sends this information to the hosted application server, where it is stored in the application's database.

#### 3. Connect an MCP Client

The application exposes an MCP server that allows compatible AI clients to interact with your ad history.

Add the production MCP server to your MCP client:

```text
<MCP_SERVER_URL>
```

For example, in ChatGPT, add the application as an MCP integration using the production server URL.

#### 4. Authenticate

When the MCP client first attempts to access your data, you will be asked to authenticate.

A browser window will open where you can sign in and authorize access.

The MCP client can then securely access the ad history associated with your account.

To read what an ad says, the client can call `search_ad_impressions` or
`get_advertiser_overview`, then pass an impression's `adId` to
`get_ad_transcript`: `{"adId":"<ad UUID>"}`. The tool reads the linked `ads`
record and returns its transcript, language, model, transcription timestamp,
and job status. It also accepts `{"adVideoId":"<YouTube video ID>"}`; provide
exactly one ID. Only ads linked to your impressions are accessible.
`status: "found"` with a null transcript means transcription is not yet
available; `jobStatus` indicates processing progress or failure.
`status: "not_found"` means no accessible ad matched the ID.

For multiple ads, call `get_ad_transcripts` with `{"adIds":["<ad UUID>","<another ad UUID>"]}`
(1–50 IDs). The `transcripts` array contains one result per requested ID, in input
order, including duplicates. Each result has the same fields and status as the
single-ad tool. Missing or inaccessible IDs return `not_found` without preventing
other results. The batch uses one database query with the same ownership checks.

#### 5. Ask Questions About Your Ads

Once connected, you can interact with your ad history using natural language.

For example:

```text
What ads have I been seeing lately?
```

```text
Which advertiser has shown me the most ads?
```

```text
What was that AI product I kept getting ads for?
```

```text
Which ads do I usually skip?
```

```text
What kinds of products are being advertised to me?
```

The MCP server queries your stored ad impressions and returns the relevant data to the client for analysis.

### How It Works

```text
YouTube
   ↓
Chrome Extension
   ↓
Hosted Application Server
   ↓
PostgreSQL Database
   ↓
MCP Server
   ↓
ChatGPT or another MCP client
```

The Chrome extension collects the data, the hosted application stores it, and MCP-compatible clients provide the interface for exploring it.

No local server or database setup is required.

## Switch environments with Zap

From this checkout (Python 3.9+, Node/npm, and Docker Desktop required):

```bash
./zap dev          # Start the local stack and build the dev extension
./zap prod         # Build for the hosted backend and stop local services
./zap stop         # Stop local services without rebuilding
./zap status       # Show the server Zap manages and its log path
./zap dev --dry-run
```

To use `zap` from any directory, add this alias to your shell configuration:

```bash
alias zap='/absolute/path/to/youtube-ad-impressions/zap'
```

Zap uses the existing root `.env` (including the Google OAuth secret), server
`.env` / `.env.development.local`, and extension `.env.production`. Create missing
files from their examples. Dev rejects non-local database and Supabase URLs and
gets the extension's public key directly from the running local Supabase stack.
Production requires explicit hosted HTTPS URLs and a public key in the extension's
production file. `zap prod` selects the hosted environment; it does not deploy it.

`zap dev` starts Docker Desktop if necessary, starts local Supabase, applies its
local migrations, starts the Compose Postgres service, runs the server migrations,
and starts the server in the background. It waits for the server's database health
check before building the extension. Logs and process state live in `.zap/`.
Dependencies are installed if the repo-local Supabase CLI is missing. First startup
can take longer while Docker downloads images.

**One-time Chrome setup:** after the first Zap build, open `chrome://extensions`,
enable Developer mode, and load `apps/extension` as an unpacked extension (or click
Reload if that folder is already loaded). Load the extension folder, not `dist`.
Zap builds include a helper that checks for a completed new build every 30 seconds
and reloads the extension. Chrome may delay alarms. Normal npm builds do not include
this helper; reload once manually after returning to Zap from a normal build.
Refresh existing YouTube tabs after switching so their content scripts also update.
You may need to sign in again when changing Supabase environments.

Builds are staged before copying into the loaded extension, so a failed build keeps
the previous extension files. Production builds finish before local services stop.
Stopping retains database volumes and only stops this project's Supabase/Compose
services and the server process group started by Zap. Other Docker projects keep
running. If you already have a manually started server on the same port, stop that
server once before using `zap dev`.

Checks for Zap itself (no live services required):

```bash
python3 -m unittest discover -s scripts -p 'test_zap.py'
node --test scripts/test-zap-reload.mjs
```
