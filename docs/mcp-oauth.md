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
5. Configure `apps/server/.env`:

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
