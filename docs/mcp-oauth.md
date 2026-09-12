# User-scoped MCP OAuth

`/mcp` uses Supabase's OAuth 2.1 authorization-code flow with PKCE and the
existing extension accounts. All three read-only tools run as the verified
token's `sub`, through the same tenant-scoped repositories as the extension.
`MCP_API_TOKEN` is retired and is never accepted.

The server publishes OAuth protected-resource metadata at
`/.well-known/oauth-protected-resource/mcp` and the root alias. Its 401 challenge
points clients to that metadata. Supabase handles authorization codes, client
registration, token issuance, consent grants, refresh rotation, and revocation.
The app serves a sign-in and consent page at `/oauth/consent`.

The Express adapter uses `resourceMetadataResponse`, `unauthorizedResponse`,
and `fromSupabaseUrl` from the pinned `@supabase/server@1.6.0` package.
`withOAuthProtectedResource` wraps Fetch handlers and serves a different
metadata path; using its response helpers retains the existing well-known
URLs, Express streaming transport, JWT verifier, and authenticated repository
access. Both metadata routes support public GET and OPTIONS discovery.

## Production URLs and curl checks

Production uses the existing project `snyecvnutlrhyicvwzfh`. Set these variables
in the Render service environment (also shown in `.env.production.example`):

```dotenv
SUPABASE_URL=https://snyecvnutlrhyicvwzfh.supabase.co
MCP_RESOURCE_URL=https://youtube-ad-impressions.onrender.com/mcp
```

Keep the existing production publishable key and database connection.
This change adds no migration and does not change extension/API authentication.

**Observed on September 11, 2026:** production resource discovery returned 200,
and missing/invalid MCP credentials returned the expected 401 challenges.
Supabase initially returned `404 feature_disabled`; after OAuth Server was
enabled, a repeat check returned `200` with the correct issuer, authorization,
token, and registration endpoints, plus S256 PKCE support.
In the [existing project's Auth settings](https://supabase.com/dashboard/project/snyecvnutlrhyicvwzfh/auth/oauth-server),
use Site URL `https://youtube-ad-impressions.onrender.com` and authorization
path `/oauth/consent`. Verify the existing audience hook and dedicated client
mapping described below; these remain required by the existing JWT validator.
Do not reapply the existing migration if it is already installed. Automatic
dynamic registration alone is insufficient because clients must be mapped.
No production settings were changed by this implementation.

1. Fetch resource discovery (no credentials required):

   ```sh
   curl -i https://youtube-ad-impressions.onrender.com/.well-known/oauth-protected-resource/mcp
   curl -i https://youtube-ad-impressions.onrender.com/.well-known/oauth-protected-resource
   ```

   Both return `200`, `Content-Type: application/json`,
   `Access-Control-Allow-Origin: *`, and:

   ```json
   {
     "resource": "https://youtube-ad-impressions.onrender.com/mcp",
     "authorization_servers": ["https://snyecvnutlrhyicvwzfh.supabase.co/auth/v1"],
     "bearer_methods_supported": ["header"],
     "resource_name": "YouTube Ad Impressions"
   }
   ```

2. Follow the issuer to Supabase authorization-server discovery:

   ```sh
   curl -i https://snyecvnutlrhyicvwzfh.supabase.co/.well-known/oauth-authorization-server/auth/v1
   ```

   After enabling OAuth Server, expect `200` JSON with
   `issuer: https://snyecvnutlrhyicvwzfh.supabase.co/auth/v1`, authorization and
   token endpoint URLs, and S256 PKCE support. A `404 feature_disabled` means
   Supabase OAuth Server still needs enabling; clients cannot complete OAuth.

3. Request MCP without a token:

   ```sh
   curl -i -X POST https://youtube-ad-impressions.onrender.com/mcp
   ```

   Expect `401`, body `{"error":"unauthorized"}`, and:

   ```http
   WWW-Authenticate: Bearer resource_metadata="https://youtube-ad-impressions.onrender.com/.well-known/oauth-protected-resource/mcp"
   ```

   Unauthenticated GET and DELETE return the same challenge.

4. Initialize MCP using a valid **OAuth access token** obtained through the
   registered client's authorization-code/PKCE flow. Set `MCP_ACCESS_TOKEN` in
   your shell to that token; an extension session token will be rejected.
   Its audience must include `https://youtube-ad-impressions.onrender.com/mcp`.

   ```sh
   curl -i -N https://youtube-ad-impressions.onrender.com/mcp \
     -H "Authorization: Bearer ${MCP_ACCESS_TOKEN}" \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-check","version":"1.0"}}}'
   ```

   Expect `200`, a `text/event-stream` response containing a JSON-RPC result
   with `serverInfo.name: youtube-ad-impressions`, and no `WWW-Authenticate`.
   The transport is stateless; no session ID is needed. Authenticated GET or
   DELETE returns `405`, so use POST initialization to check success.

5. Check invalid and expired tokens:

   ```sh
   curl -i -X POST https://youtube-ad-impressions.onrender.com/mcp \
     -H 'Authorization: Bearer invalid-token'
   # Set MCP_EXPIRED_ACCESS_TOKEN to a previously issued, now-expired OAuth token.
   curl -i -X POST https://youtube-ad-impressions.onrender.com/mcp \
     -H "Authorization: Bearer ${MCP_EXPIRED_ACCESS_TOKEN}"
   ```

   Both return `401`, body `{"error":"unauthorized"}`, and:

   ```http
   WWW-Authenticate: Bearer resource_metadata="https://youtube-ad-impressions.onrender.com/.well-known/oauth-protected-resource/mcp", error="invalid_token"
   ```

Authenticated and expired-token production checks require real OAuth tokens;
they were verified locally with signed test JWTs, not against production.

## Configure Supabase and the server

1. Apply `supabase/migrations/20260908160000_mcp_oauth_audience.sql` to the
   Supabase project that owns your users. For an existing local stack, use
   `npx supabase migration up --local`. This new migration creates an empty
   client-to-resource mapping and token hook; it does not modify impressions.
2. Enable **Authentication → OAuth Server**. Set the authorization path to
   `/oauth/consent` and the Auth Site URL to the app's public origin, for example
   `https://ads.example.com`. Local settings are already in `supabase/config.toml`
   with Site URL `http://127.0.0.1:8787`; restart local Supabase to load changes.
3. Enable **Authentication → Hooks → Custom Access Token** and select
   `public.mcp_oauth_access_token_hook`. The local config already selects it.
   If the hosted project already has an access-token hook, merge this function's
   audience mapping into that hook so its existing claims are preserved.
4. Use an asymmetric Supabase signing key (ES256 or RS256), available through
   the project's JWKS endpoint. MCP deliberately rejects HS256 and ID tokens.
5. Configure `apps/server/.env.development.local` for local development, or
   inject the same variables through the production host's environment:

   ```dotenv
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   MCP_RESOURCE_URL=https://ads.example.com/mcp
   ```

   `MCP_RESOURCE_URL` must exactly match the URL clients connect to and the
   audience mapping below. It is an explicit public URL, independent of the
   bind host/port and proxy headers. HTTPS is required except on loopback.
   Use `http://127.0.0.1:8787/mcp` locally. For remote clients, expose both the
   app and Supabase at reachable HTTPS URLs.
6. For Google sign-in, retain the project's existing Google provider settings
   and add `https://ads.example.com/oauth/consent` to Supabase's allowed redirect
   URLs. The local equivalent is already configured. Email/password sign-in
   uses the same account credentials as the extension. Accounts are created
   through the extension, not the consent page.

## Register a dedicated MCP client

Create an OAuth client in Supabase for each MCP client application. Register
the **exact callback URL supplied by that application**. Choose a public client
with token endpoint auth method `none` when supported; confidential clients
use the authentication method required by the application. Both use the
authorization-code flow with S256 PKCE.

Using a database administrator connection (for example Studio's SQL editor),
map that OAuth client ID to this MCP endpoint:

```sql
insert into private.mcp_oauth_clients (client_id, resource_url)
values ('YOUR_SUPABASE_OAUTH_CLIENT_ID', 'https://ads.example.com/mcp')
on conflict (client_id) do update set resource_url = excluded.resource_url;
```

Use a dedicated client registration for this resource. Supabase currently
issues `aud: authenticated` by default and does not bind audiences from the
`resource` request parameter. The hook supplies the audience from this
administrator-controlled mapping on both initial issuance and refresh. The
MCP server verifies the signature, issuer, expiry, exact resource audience,
OAuth `client_id`, authenticated role, and user UUID. Unmapped clients and
normal extension sessions cannot access MCP. OAuth tokens, including unmapped
ones, cannot use `/me` or the extension's `/api/v1/impressions` routes.

Dynamic registration is disabled by default: each client must be explicitly
registered and mapped. Configure your MCP application with the endpoint URL
and registered OAuth client ID (and client secret only for confidential
clients). Remove the old static Authorization header. Connect, sign in, review
the client and return address, and allow access. Each account will see only
its own impressions. All three tools share the same read permission; custom
per-tool OAuth scopes are not implemented.

## Verify and revoke

### ChatGPT: authentication succeeded, action discovery failed (401)

This means OAuth completed but the MCP request was rejected. Check the
dedicated client's audience mapping and that **Authentication → Hooks →
Custom Access Token** enables `public.mcp_oauth_access_token_hook`.
Dynamic registration creates an Auth client, but does not populate
`private.mcp_oauth_clients`. Map the exact client used by the connection using
the SQL above; do not allow all dynamically registered clients automatically.
Then reauthorize the existing ChatGPT connection to obtain a fresh token.
Deleting and recreating the connection can register a different client ID,
which needs its own mapping. Tokens already issued keep their old audience.

On September 11, 2026, the production mapping table was empty after ChatGPT's
first connection. Its registered client was mapped to the production MCP URL,
and direct hook execution verified the MCP audience while preserving the
ordinary extension audience. Hook activation in Auth settings and a fresh
ChatGPT login must still be verified end to end.

```sh
npm run dev
npm run typecheck --workspace @ad-impressions/server
npm test
npm run build --workspace @ad-impressions/server
```

The server's dev, build, and test commands bundle the consent script locally;
there are no CDN scripts. Deploy the `apps/server/public` directory alongside
`dist`. Only the Supabase public URL/key are exposed by `/oauth/config`.

With a local Supabase stack running and the migration/hook enabled:

```sh
MCP_OAUTH_INTEGRATION=1 npm run test --workspace @ad-impressions/server -- test/mcp-oauth-local.test.ts
```

To target an isolated CLI project, also set `MCP_OAUTH_SUPABASE_WORKDIR` to its
directory. This test creates and cleans up its own account, OAuth client, and
audience mapping. It exercises actual MCP SDK discovery, consent, PKCE, token
verification, tool execution, code replay rejection, refresh rotation, and
API separation. Unit tests cover two-user tool isolation and consent DOM
behavior. Manually check Google sign-in and the consent page in a browser,
including account switching, approval, denial, and your MCP application's
callback; Google authentication is not exercised by the automated tests.

Users can revoke a client through Supabase's
`supabase.auth.oauth.revokeGrant({ clientId })` using their normal app session.
Administrators can also remove its audience mapping to block future MCP token
issuance. Signature verification is stateless: already-issued access tokens
remain usable until expiry. Refresh tokens remain with the MCP client; this
app never stores or forwards them. The consent page keeps its separate sign-in
session in browser session storage and Supabase handles its PKCE flow.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[Supabase OAuth setup and audience customization](https://supabase.com/docs/guides/auth/oauth-server/getting-started),
[Supabase access-token hooks](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
