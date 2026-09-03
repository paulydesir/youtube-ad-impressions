# ChatGPT Extension Data Tool — MVP Specification

## 1. Objective

Build a small local companion service that gives ChatGPT controlled, read-only
access to data captured by the YouTube Ad Impressions Chrome extension.

The completed system must let the user ask conversational questions such as:

> I have been seeing Coursera ads. What have I actually seen, and what is going
> on with that campaign?

ChatGPT should retrieve the user's local ad observations through MCP, combine
those observations with its normal reasoning and web-search capabilities, and
produce a useful answer. The system must keep observed facts distinct from
facts found elsewhere and from model inference.

The MVP is successful when ChatGPT can analyze the user's real ad history for
fun and answer questions about advertiser frequency, recent impressions,
headlines, promotions, timing, and skip behavior.

## 2. Guiding Principle

This project is a data-access bridge, not a semantic-search project.

ChatGPT performs the natural-language interpretation. The server exposes
structured database operations. SQLite performs ordinary filtering and
aggregation.

Vectors, embeddings, transcripts, and PostgreSQL are deliberately deferred
until real usage demonstrates that structured queries and compact record
retrieval are insufficient.

## 3. MVP Scope

The MVP includes:

- conversion of the existing repository into an npm-workspaces monorepo;
- the existing Chrome extension and IndexedDB database;
- a local Node.js and TypeScript companion server;
- SQLite persistence using Drizzle ORM;
- a versioned `AdImpressionV1` input contract;
- an HTTP API for ingesting completed impressions;
- a command for importing an existing extension JSON export;
- structured querying and advertiser analytics;
- a Streamable HTTP MCP endpoint;
- read-only MCP tools usable by ChatGPT;
- instructions for connecting the local MCP server to ChatGPT;
- automated unit, integration, and end-to-end tests.

## 4. Explicit Non-Goals

Do not add any of the following to the MVP:

- transcripts or audio transcription;
- embeddings or vector search;
- PostgreSQL or pgvector;
- bidirectional IndexedDB synchronization;
- conflict resolution across multiple devices;
- cloud hosting or multi-user accounts;
- advertiser identity normalization;
- automatic ad categorization with an LLM;
- a custom chat interface;
- arbitrary SQL access from ChatGPT;
- write or delete tools exposed to ChatGPT.

These may become later milestones, but they must not block the first working
ChatGPT connection.

## 5. System Architecture

```text
YouTube
   |
   v
Chrome extension
   |-- save locally --> IndexedDB
   |
   `-- POST completed impression --> Local Node.js server
                                        |
                                        v
                                 Drizzle ORM + SQLite
                                        ^
                                        |
                                  read-only services
                                        ^
                                        |
                                  MCP endpoint
                                        ^
                                        |
                                     ChatGPT
```

The extension remains useful when the companion server is unavailable. A
failed server request must never prevent local IndexedDB persistence.

## 6. Technology Choices

| Concern | Choice | Reason |
| --- | --- | --- |
| Monorepo | npm workspaces | Uses the package manager already present and keeps Step 0 small |
| Runtime | Node.js | Matches the extension's JavaScript ecosystem |
| Language | TypeScript | Makes API, database, and MCP contracts explicit |
| HTTP server | Express | Small, familiar, and sufficient for this service |
| Database | SQLite | Local, durable, zero administration |
| SQLite driver | `better-sqlite3` | Simple local execution and Drizzle support |
| ORM and migrations | Drizzle ORM + Drizzle Kit | Lightweight typed queries and explicit migrations |
| Validation | Zod | Shared runtime validation for API and MCP inputs |
| Chat integration | MCP over Streamable HTTP | Exposes focused tools to ChatGPT |
| Tests | Vitest + Supertest | Unit and HTTP integration testing |

## 7. Repository Layout

The current repository begins as a Chrome-extension repository. Before server
implementation, convert it into a private npm-workspaces monorepo. Move the
extension without changing its behavior, then add the server as a second app.

```text
youtube-ad-impressions/
├── apps/
│   ├── extension/
│   │   ├── src/                 # existing extension code
│   │   ├── popup/               # existing extension popup
│   │   ├── test/                # existing extension tests
│   │   ├── manifest.json
│   │   └── package.json
│   └── server/
│       ├── src/
│       │   ├── config/
│       │   ├── db/
│       │   ├── http/
│       │   ├── mcp/
│       │   ├── repositories/
│       │   ├── services/
│       │   └── index.ts
│       ├── migrations/
│       ├── scripts/
│       ├── test/
│       ├── data/                # ignored SQLite files
│       ├── .env.example
│       ├── drizzle.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── contracts/               # shared schemas and transport types
│       ├── src/
│       └── package.json
├── docs/
│   ├── chatgpt-connection.md
│   └── integration-log.md
├── package.json                 # private workspace root and orchestration scripts
├── package-lock.json            # single dependency lockfile
└── CHATGPT_EXTENSION_DATA_MVP_SPEC.md
```

Root workspace configuration:

```json
{
  "name": "youtube-ad-impressions",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

Use one root lockfile and one root `node_modules`. Each app or package owns its
runtime dependencies and scripts. Root scripts only orchestrate workspace
commands.

The extension currently runs directly as browser JavaScript without a bundler.
Step 0 must not introduce a bundler merely to share TypeScript code. The
contract package becomes the canonical server and transport contract, while a
compatibility test verifies that the extension's existing record builder emits
the same wire shape. A future extension build system may consume the package
directly if that later becomes worthwhile.

## 8. Data Contract

The server must accept the versioned record produced by the extension. The
contract lives in `packages/contracts` and must be represented by a Zod schema
and an inferred TypeScript type.

Minimum required fields:

```ts
type AdImpressionV1 = {
  schema_version: 1;
  event_id: string;
  source: "youtube";
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  host_video_id: string | null;
  advertiser_name: string | null;
  advertiser_domain: string | null;
  ad_headline: string | null;
  call_to_action: string | null;
  creative_title: string | null;
  creative_duration_ms: number | null;
  pod_id: string;
  pod_label: string | null;
  pod_position: number | null;
  pod_size: number | null;
  pod_impression_index: number;
  skipped: boolean;
  skip_clicked_at: string | null;
  end_reason: string | null;
};
```

The Zod schema may accept the remaining fields already produced by the
extension. Unknown fields should be preserved in `raw_json` rather than causing
data loss.

## 9. SQLite Schema

Use one table for the MVP. Do not create advertiser, campaign, creative,
embedding, or category tables yet.

```text
ad_impressions
────────────────────────────────
id                         integer primary key
event_id                   text unique not null
schema_version             integer not null
source                     text not null
started_at                 text not null
ended_at                   text
duration_ms                integer
host_video_id              text
advertiser_name            text
advertiser_domain          text
ad_headline                text
call_to_action             text
creative_title             text
creative_duration_ms       integer
pod_id                     text
pod_label                  text
pod_position               integer
pod_size                   integer
pod_impression_index       integer
skipped                    integer not null
skip_clicked_at            text
end_reason                 text
raw_json                   text not null
ingested_at                text not null
```

Required indexes:

- unique `event_id`;
- `started_at`;
- `advertiser_domain`;
- `host_video_id`.

Timestamps are stored as UTC ISO-8601 strings for the MVP. Boolean values are
stored using SQLite integers and mapped by Drizzle.

## 10. HTTP API

### `GET /healthz`

Returns server and database readiness.

```json
{
  "ok": true,
  "database": "ready"
}
```

### `POST /api/v1/impressions`

Accepts one `AdImpressionV1` record.

Requirements:

- validate the body with Zod;
- require `Authorization: Bearer <INGEST_API_TOKEN>`;
- insert using `event_id` as the idempotency key;
- return `201` for a new record;
- return `200` with `duplicate: true` when the event already exists;
- return `400` for an invalid record;
- never log the complete raw payload.

### `POST /api/v1/impressions/batch`

Accepts up to 500 records for backfill and retries. Each item must be handled
idempotently. The response reports accepted, duplicate, and rejected counts.

The batch route exists for extension-export imports and future retry support;
it is not a general synchronization protocol.

## 11. Existing Export Import

Provide a CLI command:

```sh
npm run import -- /path/to/youtube-ad-impressions-export.json
```

The importer must:

- understand the current export envelope containing `impressions` and `stats`;
- normalize legacy field names to `AdImpressionV1` names;
- generate a deterministic legacy event identifier from stable record content;
- preserve the original row in `raw_json`;
- be safe to run repeatedly without creating duplicates;
- print only summary counts;
- ignore the cumulative `stats` record for this MVP.

## 12. Query Service

Implement structured operations, not a fake semantic `query` parameter.

### `searchImpressions(filters)`

```ts
type ImpressionFilters = {
  advertiser?: string;
  terms?: string[];
  from?: string;
  to?: string;
  skipped?: boolean;
  limit?: number;
};
```

Behavior:

- `advertiser` performs case-insensitive substring matching against observed
  advertiser name and domain;
- `terms` performs case-insensitive lexical matching across advertiser,
  headline, CTA, and creative title;
- multiple terms use OR semantics for the MVP;
- date filters apply to `started_at`;
- default limit is 20 and maximum limit is 100;
- return newest records first;
- return compact records without `raw_json`, avatar URLs, or player metadata.

### `getAdvertiserStats(filters)`

Return advertiser-level aggregates:

```ts
type AdvertiserStats = {
  advertiser: string;
  impression_count: number;
  total_duration_ms: number;
  skipped_count: number;
  skip_rate: number;
  first_seen_at: string;
  last_seen_at: string;
};
```

Support optional `advertiser`, `from`, `to`, and `limit` filters.

### `getAdvertiserOverview(advertiser)`

Return one advertiser's aggregate statistics, recent impressions, and distinct
observed headlines and creative titles. This is a convenience operation for
questions such as “What is going on with the Coursera ads?”

## 13. MCP Tools

Expose exactly three read-only tools initially:

### `search_ad_impressions`

Calls `searchImpressions`. Use when the user asks about individual ads,
promotions, headlines, timing, or skip behavior.

### `get_advertiser_stats`

Calls `getAdvertiserStats`. Use when the user asks which advertisers appear
most frequently or requests counts, rankings, or rates.

### `get_advertiser_overview`

Calls `getAdvertiserOverview`. Use when the user names one advertiser and wants
a general explanation.

Every MCP tool must:

- have a narrow Zod input schema;
- return structured JSON;
- be annotated as read-only;
- enforce maximum result limits server-side;
- omit `raw_json` and irrelevant technical metadata;
- return observed data only;
- never perform web searches itself;
- never expose arbitrary SQL.

ChatGPT may independently use web search after retrieving local observations.
Its final answer should distinguish:

- what the extension observed;
- what public sources currently report;
- what the model is inferring.

## 14. Chrome Extension Integration

After an impression is successfully written to IndexedDB, the background
service worker should attempt to send the canonical record to:

```text
http://127.0.0.1:8787/api/v1/impressions
```

Requirements:

- add the local server origin to extension host permissions;
- perform the HTTP request from the background service worker;
- include the configured ingestion token;
- use a short timeout;
- do not block or roll back IndexedDB persistence when the server is offline;
- log a concise diagnostic without repeatedly spamming the console;
- do not add a durable retry queue in the first implementation.

Backfill during the MVP is handled by exporting IndexedDB and running the
server import command. A durable outbox is a later reliability improvement.

## 15. Configuration

The server must read configuration from environment variables and fail fast on
invalid values.

```dotenv
PORT=8787
HOST=127.0.0.1
DATABASE_FILE=./data/ad-impressions.sqlite
INGEST_API_TOKEN=replace-with-a-random-local-token
LOG_LEVEL=info
```

Commit `.env.example`. Ignore `.env`, SQLite files, WAL files, and temporary
database files.

The extension must not contain an OpenAI API key. The MVP requires only the
local ingestion token.

## 16. ChatGPT Connection

The server exposes its MCP transport at:

```text
http://127.0.0.1:8787/mcp
```

Document the currently supported connection process in
`docs/chatgpt-connection.md`. If ChatGPT cannot connect directly to the private
local endpoint, use the supported secure MCP tunnel workflow. Do not deploy the
database publicly merely to complete the demo.

The connection guide must include:

- how to start the server;
- how to run migrations;
- how to import the existing JSON export;
- how to start the private tunnel when required;
- how to register or connect the MCP endpoint in ChatGPT;
- how to verify that the three tools are visible;
- how to disconnect the tool and stop the tunnel;
- troubleshooting for server unavailable, authentication failure, and empty
  query results.

## 17. End-to-End Acceptance Scenario

Given these stored observations:

```json
[
  {
    "advertiser_name": "coursera.org",
    "ad_headline": "Save $70+",
    "call_to_action": "Start now",
    "creative_title": "Coursera: Grow Your Career"
  },
  {
    "advertiser_name": "coursera.org",
    "ad_headline": "Invest in Your Growth",
    "call_to_action": "Start now",
    "creative_title": "Coursera: Grow Your Career"
  }
]
```

When the user asks ChatGPT:

> I have been seeing Coursera ads. What have I actually seen?

Then ChatGPT must call an MCP tool and report that two matching observations
exist, including the two observed headlines.

If ChatGPT performs a web search afterward, it must not present an externally
found discount, deadline, or campaign detail as though the extension captured
it.

## 18. Automated Verification

The finished project must provide these commands:

```sh
npm run dev
npm run migrate
npm run import -- /path/to/export.json
npm test
npm run test:integration
npm run test:e2e
```

Tests must cover:

- contract validation;
- database migration against a temporary SQLite file;
- idempotent single and batch ingestion;
- deterministic legacy import IDs;
- search filters and result limits;
- advertiser aggregation;
- MCP tool schemas and read-only annotations;
- MCP tool calls against a real temporary database;
- an end-to-end Coursera ingestion and retrieval scenario;
- extension behavior when the local server is unavailable.

No test may modify the user's real SQLite database.

## 19. Agent Work Breakdown

Agents must work feature-first. An agent owns only the files listed for its
feature unless the integration agent explicitly resolves a cross-feature
problem. Every agent must run the relevant tests before handing work off.

### Feature Agent 0 — Monorepo Conversion

**Depends on:** nothing

**Owns:**

- root `package.json` and `package-lock.json`;
- root `.gitignore` and `README.md`;
- `apps/extension/` paths created by moving the existing extension;
- initial workspace directory structure.

**Deliverables:**

- private npm-workspaces root;
- existing extension moved with `git mv` into `apps/extension`;
- extension workspace package named `@ad-impressions/extension`;
- root scripts for running extension tests and all workspace tests;
- corrected test paths and local-loading documentation;
- ignored workspace dependencies, environment files, and SQLite artifacts;
- reserved `apps/server` and `packages/contracts` locations without
  implementing their features.

**Constraints:**

- make no impression-schema, storage, capture, popup, or server feature changes;
- do not introduce an extension bundler;
- preserve Git history through file moves;
- preserve the extension's manifest behavior and permissions;
- keep the extension loadable directly from `apps/extension`.

**Acceptance:** From the repository root, dependency installation succeeds,
`npm test` runs the existing extension tests, all existing tests pass, and the
unpacked extension can still be loaded from `apps/extension`.

### Feature Agent 1 — Server Foundation

**Depends on:** Feature 0

**Owns:**

- `apps/server/package.json`
- `apps/server/tsconfig.json`
- `apps/server/.env.example`
- `apps/server/src/config/`
- server scripts and ignore rules

**Deliverables:**

- TypeScript Node.js project;
- Express application factory separated from process startup;
- validated configuration;
- `GET /healthz` shell route;
- development and test commands.

**Acceptance:** The empty service starts on `127.0.0.1`, configuration errors
fail clearly, and its foundation tests pass.

### Feature Agent 2 — Contract, Database, and Repository

**Depends on:** Feature 1

**Owns:**

- `packages/contracts/`
- `apps/server/src/db/`
- `apps/server/src/repositories/`
- `apps/server/migrations/`
- `apps/server/drizzle.config.ts`

**Deliverables:**

- `AdImpressionV1` Zod schema and TypeScript type;
- Drizzle table and indexes;
- first migration;
- database initialization;
- repository insert, search, and aggregation methods.

**Acceptance:** A migration creates a fresh temporary database, inserts are
idempotent by `event_id`, and repository tests pass.

### Feature Agent 3 — Ingestion API

**Depends on:** Features 1 and 2

**Owns:**

- `apps/server/src/http/`
- ingestion API integration tests

**Deliverables:**

- bearer-token middleware;
- single-impression endpoint;
- batch-impression endpoint;
- validation and stable error responses;
- health route database readiness.

**Acceptance:** Supertest verifies new, duplicate, invalid, unauthorized, and
batch requests against a temporary database.

### Feature Agent 4 — Legacy Export Import

**Depends on:** Feature 2

**Owns:**

- `apps/server/scripts/import-export.ts`
- importer tests and fixtures

**Deliverables:**

- current export-envelope parser;
- legacy-to-V1 normalizer;
- deterministic legacy event IDs;
- repeat-safe import command;
- summary output.

**Acceptance:** Importing the provided sample twice produces exactly one stored
row per original impression and reports duplicates on the second run.

### Feature Agent 5 — Analysis Services

**Depends on:** Feature 2

**Owns:**

- `apps/server/src/services/`
- service tests

**Deliverables:**

- `searchImpressions`;
- `getAdvertiserStats`;
- `getAdvertiserOverview`;
- compact response DTOs;
- case-insensitive filtering and safe limits.

**Acceptance:** Tests answer representative questions using the sample fixture,
including Coursera history and the most frequent advertisers.

### Feature Agent 6 — MCP Interface

**Depends on:** Features 1, 2, and 5

**Owns:**

- `apps/server/src/mcp/`
- MCP integration tests

**Deliverables:**

- Streamable HTTP MCP transport at `/mcp`;
- exactly three read-only tools;
- tool descriptions, Zod inputs, structured outputs, and limits;
- MCP client integration test.

**Acceptance:** A test MCP client lists all three tools and retrieves real
Coursera observations from a temporary database.

### Feature Agent 7 — Chrome Extension Forwarding

**Depends on:** Features 2 and 3

**Owns:**

- `apps/extension/src/` background forwarding code;
- `apps/extension/` configuration related to the local service;
- `apps/extension/test/` unit tests;
- `apps/extension/manifest.json` host permissions

**Deliverables:**

- best-effort POST after local persistence;
- token and endpoint configuration;
- timeout and quiet failure behavior;
- no regression to existing local analytics.

**Acceptance:** Tests prove that successful local persistence is independent of
server availability and that repeated delivery is safe.

### Feature Agent 8 — ChatGPT Connection Documentation

**Depends on:** Feature 6

**Owns:**

- `docs/chatgpt-connection.md`

**Deliverables:**

- complete local setup and connection guide;
- secure private connection instructions;
- verification and disconnect steps;
- concise troubleshooting.

**Acceptance:** A developer starting from a clean checkout can follow the guide
without undocumented setup knowledge.

### Integration Agent — End-to-End Assembly

**Depends on:** Features 0 through 8

**Owns:**

- cross-module integration fixes;
- `apps/server/test/e2e/`;
- `docs/integration-log.md`;
- root-level developer instructions when necessary

**Deliverables:**

- install dependencies;
- run migrations;
- start the server;
- run existing extension tests;
- run server unit and integration tests;
- execute the Coursera MCP end-to-end scenario;
- document every integration mismatch and the minimal resolution.

**Acceptance:** All automated tests pass, the MCP tools operate against SQLite,
and the manual ChatGPT smoke test is documented with observed results.

## 20. Agent Handoff Requirements

Every feature agent must provide:

1. files changed;
2. commands run;
3. tests added and results;
4. assumptions made;
5. unresolved risks;
6. any contract changes needed by another feature.

Agents must not silently alter another feature's interface. Proposed contract
changes must be written down before the integration agent applies them.

## 21. Definition of Done

The MVP is done only when:

- the extension still records impressions locally;
- new impressions can reach the local SQLite database;
- the existing JSON export can be imported;
- duplicate events do not create duplicate rows;
- ChatGPT can list and call the three MCP tools;
- advertiser history and aggregate questions return correct data;
- the Coursera acceptance scenario passes;
- web-found information is not represented as locally observed data;
- every automated test passes from a clean checkout;
- setup, connection, limitations, and integration issues are documented.

At that point, use the system before adding vectors. Record questions it cannot
answer reliably. Those failures—not architectural curiosity—should determine
whether the next feature is full-text search, embeddings, better capture, or a
transcript pipeline.
