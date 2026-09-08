# Next implementation spec: tenant ownership for ad impressions

Status: next implementation task; not yet implemented.

## Objective

Implement tenant ownership for ad impressions so every authenticated user can only create, read, and analyze their own impression data.

```text
Supabase JWT
    ↓
server verifies token
    ↓
req.auth.userId
    ↓
HTTP/service/repository layer
    ↓
all writes tagged with user_id
all reads filtered by user_id
```

The authenticated user ID must always come from the verified JWT. Never trust a client-supplied `userId`.

**Make `userId` required at the repository boundary.** This provides a compile-time guard against accidentally adding an unscoped query later.

## Target data model

Current:

```text
auth.users
    ↓ 1:1
public.profiles

public.ad_impressions
```

Target:

```text
auth.users
    ↓ 1:1
public.profiles
    ↓ 1:N
public.ad_impressions
```

Add to `ad_impressions`:

```sql
user_id uuid not null
references public.profiles(id)
on delete cascade
```

The value must correspond to the Supabase authenticated user's UUID.

## Feature 1 — Add user_id to Postgres schema

Update the Drizzle Postgres schema for `ad_impressions`:

```ts
userId: uuid("user_id")
  .notNull()
  .references(() => profiles.id, {
    onDelete: "cascade",
  })
```

If `profiles` is not currently represented in the Drizzle schema, add the minimal table declaration necessary for the foreign-key relationship without attempting to make Drizzle responsible for Supabase Auth.

Do not create or manage `auth.users` through Drizzle.

## Feature 2 — Migration strategy

Existing impression rows may not have ownership. Do not blindly add `NOT NULL` if existing data would cause the migration to fail.

Choose the simplest appropriate local-development strategy:

1. If existing impression data is disposable test data, clear existing impressions and add `user_id NOT NULL`.
2. If existing data must be preserved, add nullable `user_id`, backfill rows to a known development user, verify all rows have ownership, then make the column `NOT NULL`.

Document whichever strategy is used.

## Feature 3 — Tenant-aware idempotency

Change existing `UNIQUE(event_id)` uniqueness to:

```text
UNIQUE(user_id, event_id)
```

Idempotency means “this user has already submitted this event,” not “no user anywhere may submit this event.” Update repository duplicate detection accordingly.

## Feature 4 — Thread authenticated user through HTTP

The impressions router already authenticates requests. Extract the authenticated user for every user-owned impressions endpoint:

```ts
const { userId } = (req as AuthenticatedRequest).auth!;
```

Do not read `userId` from request bodies, query parameters, headers other than the verified JWT, or impression payloads. JWT-derived identity is authoritative.

## Feature 5 — Tenant-aware writes

Update:

```ts
store.insertImpression(record, rawJson)
```

To require authenticated ownership, such as:

```ts
store.insertImpression(userId, record, rawJson)
```

Or an equivalent typed object:

```ts
store.insertImpression({ userId, record, rawJson })
```

The repository must always write `ad_impressions.user_id = authenticated userId`. The client must never choose the owning user. Apply the same rule to batch ingestion.

## Feature 6 — Tenant-aware reads

Update all impression reads to require a user ID:

```ts
store.searchImpressions({ userId, limit })
```

The repository query must include:

```sql
WHERE user_id = $authenticatedUserId
```

before any other filters. All dashboard/history endpoints must return only the current user's rows.

## Feature 7 — Repository contract changes

Update `ImpressionStore` and repository interfaces so tenant ownership is mandatory. Avoid APIs where user scoping is optional.

Bad:

```ts
searchImpressions({ userId?: string })
```

Good:

```ts
searchImpressions({ userId: string, limit?: number })
```

The type system should make it difficult to accidentally execute an unscoped user-data query.

Apply this principle to every impression-specific operation in the current repository interface, including insertion, search, advertiser stats, advertiser history, aggregates, deletes, and exports.

## Feature 8 — Service layer

Thread `userId` explicitly through any service layer between HTTP/MCP and repositories:

```text
HTTP → userId
service → userId
repository → WHERE user_id = ...
```

Do not hide authenticated identity in global state or module-level variables. Pass tenant context explicitly.

## Feature 9 — Extension behavior

Do not add a user ID to the impression payload. Continue sending:

```http
POST /api/v1/impressions
Authorization: Bearer <access-token>
```

with the normal impression body. The server derives ownership from the token.

Do not modify the public impression contract to include `user_id`. Ownership is server metadata, not part of the captured YouTube ad event.

## Feature 10 — Two-user isolation test

Add an integration test using two Supabase Auth users: Alice and Bob.

Insert:

```text
Alice → A1
Alice → A2
Bob   → B1
```

Verify:

```text
GET as Alice → A1, A2; never B1
GET as Bob   → B1; never A1 or A2
```

Also verify Alice and Bob may each submit the same `event_id` with tenant-scoped uniqueness.

## Feature 11 — Authorization failure tests

Verify:

1. Missing JWT → `401`.
2. Invalid JWT → `401`.
3. Expired JWT → `401`.
4. Valid Alice JWT cannot access Bob-owned rows.
5. Valid Bob JWT cannot access Alice-owned rows.
6. Client-supplied `userId` is ignored if somehow present.
7. Batch ingestion assigns every accepted row to the authenticated user.

## Feature 12 — Cascade behavior

Verify that deleting a Supabase Auth user cascades through:

```text
auth.users row → profile → owned impressions
```

Add an integration test if practical.

## Important security invariant

Every operation touching user-owned impression data must satisfy:

```text
authenticated user → verified JWT → userId → tenant-scoped repository query
```

There must be no code path equivalent to the following for a user-facing endpoint:

```sql
SELECT * FROM ad_impressions;
```

It must always be equivalent to:

```sql
SELECT * FROM ad_impressions
WHERE user_id = $authenticatedUserId;
```

The same applies to writes and analytics.

## MCP scope

Do not redesign MCP authentication unless required to keep the project compiling. The existing MCP shared-token model may remain temporarily.

Repository API changes must make tenant context explicit so MCP can later be migrated cleanly.

If MCP code cannot compile because repository methods now require `userId`, do not use an arbitrary user's UUID. Instead either introduce an explicit temporary system/internal repository method, or update MCP in the smallest clearly marked way necessary.

Document that MCP tenant authentication remains a future feature. Do not silently make MCP queries cross-tenant.

## Acceptance criteria

1. `ad_impressions.user_id` exists.
2. It references `public.profiles.id`.
3. New impressions receive ownership from the verified JWT.
4. The impression payload does not contain a trusted user ID.
5. All impression reads are scoped to the authenticated user.
6. Batch ingestion is tenant-scoped.
7. Duplicate detection is tenant-aware.
8. Alice cannot read Bob's impressions.
9. Bob cannot read Alice's impressions.
10. Existing auth tests continue to pass.
11. New two-user isolation tests pass.
12. The extension can still capture, upload, and display impressions after login.

## Out of scope

Do not implement Google OAuth, GitHub OAuth, production deployment, billing, teams/organizations, shared accounts, admin dashboards, multi-tenant RLS policies for direct browser access, MCP user authentication, roles/permissions beyond user ownership, or organization/workspace IDs.

This task is strictly: one authenticated user owns many ad impressions and can access only those impressions.
