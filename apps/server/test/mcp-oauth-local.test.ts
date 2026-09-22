import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pg from "pg";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { createMcpTokenVerifier } from "../src/mcp/auth.js";
import { createTokenVerifier } from "../src/http/supabase-auth.js";
import type { ImpressionStore } from "../src/repositories/store.js";

it.skipIf(process.env.MCP_OAUTH_INTEGRATION !== "1")("real Supabase OAuth: discovery, consent, S256 PKCE, replay protection, refresh and user-scoped MCP", async () => {
  const workdir = process.env.MCP_OAUTH_SUPABASE_WORKDIR ?? new URL("../../../", import.meta.url).pathname;
  const config = JSON.parse(execFileSync("npx", ["supabase", "status", "--workdir", workdir, "-o", "json"], { encoding: "utf8" }));
  const pool = new pg.Pool({ connectionString: config.DB_URL });
  const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const user = createClient(config.API_URL, config.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const http = createServer();
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const resourceUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  const calls: string[] = [];
  const store: ImpressionStore = {
    insertImpression: async () => { throw new Error("read only"); },
    searchImpressions: async id => { calls.push(id); return []; },
    getAdvertiserStats: async () => [], getAdvertiserOverviewData: async () => { throw new Error("unused"); },
    getAdTranscripts: async () => [],
  getAdTranscript: async () => null,
  };
  const verifyMcp = createMcpTokenVerifier(config.API_URL, resourceUrl);
  const app = createApp({
    store, isDatabaseReady: async () => true,
    verifyAccessToken: createTokenVerifier(config.API_URL),
    mcpAuth: { resourceUrl, supabaseUrl: config.API_URL, verifyAccessToken: verifyMcp },
  });
  http.on("request", app);
  let userId: string | undefined;
  let clientId: string | undefined;
  let mcp: Client | undefined;
  try {
    const signup = await user.auth.signUp({ email: `mcp-${randomUUID()}@example.com`, password: `${randomUUID()}Aa1!` });
    expect(signup.error).toBeNull();
    userId = signup.data.user!.id;
    const registrationParams = {
      client_name: "MCP integration test", client_type: "public", token_endpoint_auth_method: "none",
      redirect_uris: ["http://127.0.0.1:45678/callback"],
    } as const;
    const registration = await admin.auth.admin.oauth.createClient({ ...registrationParams, redirect_uris: [...registrationParams.redirect_uris] });
    expect(registration.error).toBeNull();
    clientId = registration.data!.client_id;
    await pool.query("insert into private.mcp_oauth_clients(client_id, resource_url) values($1,$2)", [clientId, resourceUrl]);
    let tokens: OAuthTokens | undefined;
    let authorizationUrl: URL | undefined;
    let verifier = "";
    const state = randomUUID();
    const provider: OAuthClientProvider = {
      redirectUrl: "http://127.0.0.1:45678/callback",
      clientMetadata: { redirect_uris: ["http://127.0.0.1:45678/callback"], token_endpoint_auth_method: "none" },
      clientInformation: () => ({ client_id: clientId! }),
      state: () => state,
      tokens: () => tokens,
      saveTokens: value => { tokens = value; },
      redirectToAuthorization: url => { authorizationUrl = url; },
      saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
    };
    expect(await auth(provider, { serverUrl: resourceUrl })).toBe("REDIRECT");
    expect(authorizationUrl!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl!.searchParams.get("resource")).toBe(resourceUrl);
    const badRedirect = new URL(authorizationUrl!);
    badRedirect.searchParams.set("redirect_uri", "https://evil.example/callback");
    const rejectedRedirect = await fetch(badRedirect, { redirect: "manual" });
    expect(rejectedRedirect.status).toBe(400);
    expect(rejectedRedirect.headers.get("location")).toBeNull();
    const missingPkce = new URL(authorizationUrl!);
    missingPkce.searchParams.delete("code_challenge");
    missingPkce.searchParams.delete("code_challenge_method");
    const rejectedPkce = await fetch(missingPkce, { redirect: "manual" });
    expect(rejectedPkce.status).toBe(302);
    const pkceError = new URL(rejectedPkce.headers.get("location")!);
    expect(pkceError.origin + pkceError.pathname).toBe(String(provider.redirectUrl));
    expect(pkceError.searchParams.get("error")).toBe("invalid_request");
    const authorization = await fetch(authorizationUrl!, { redirect: "manual" });
    expect(authorization.status).toBe(302);
    const authorizationId = new URL(authorization.headers.get("location")!).searchParams.get("authorization_id")!;
    const details = await user.auth.oauth.getAuthorizationDetails(authorizationId);
    expect(details.error).toBeNull();
    expect(details.data).toMatchObject({ user: { id: userId }, client: { id: clientId } });
    const consent = await user.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    expect(consent.error).toBeNull();
    const callback = new URL(consent.data!.redirect_url);
    expect(callback.searchParams.get("state")).toBe(state);
    const code = callback.searchParams.get("code")!;
    expect(await auth(provider, { serverUrl: resourceUrl, authorizationCode: code })).toBe("AUTHORIZED");
    expect((await verifyMcp(tokens!.access_token)).userId).toBe(userId);
    expect((await request(app).get("/me").set("Authorization", `Bearer ${tokens!.access_token}`)).status).toBe(401);
    expect((await request(app).post("/api/v1/impressions").set("Authorization", `Bearer ${tokens!.access_token}`).send({})).status).toBe(401);
    expect((await request(app).get("/mcp").set("Authorization", `Bearer ${signup.data.session!.access_token}`)).status).toBe(401);
    expect((await request(app).get("/me").set("Authorization", `Bearer ${signup.data.session!.access_token}`)).status).toBe(200);
    mcp = new Client({ name: "oauth-integration", version: "1" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(resourceUrl), { authProvider: provider }));
    expect((await mcp.callTool({ name: "search_ad_impressions", arguments: {} })).isError).toBeUndefined();
    expect(calls).toEqual([userId]);

    const exchange = (body: Record<string, string>) => fetch(`${config.API_URL}/auth/v1/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId!, resource: resourceUrl, ...body }),
    });
    expect((await exchange({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: String(provider.redirectUrl) })).status).toBe(400);
    const refreshed = await exchange({ grant_type: "refresh_token", refresh_token: tokens!.refresh_token! });
    expect(refreshed.status).toBe(200);
    const fresh = await refreshed.json() as OAuthTokens;
    expect(fresh.refresh_token).not.toBe(tokens!.refresh_token);
    expect((await verifyMcp(fresh.access_token)).userId).toBe(userId);

    await pool.query("delete from private.mcp_oauth_clients where client_id=$1", [clientId]);
    const unmapped = await (await exchange({ grant_type: "refresh_token", refresh_token: fresh.refresh_token! })).json() as OAuthTokens;
    await expect(verifyMcp(unmapped.access_token)).rejects.toThrow();

    tokens = undefined;
    expect(await auth(provider, { serverUrl: resourceUrl })).toBe("REDIRECT");
    const second = await fetch(authorizationUrl!, { redirect: "manual" });
    const secondId = new URL(second.headers.get("location")!).searchParams.get("authorization_id")!;
    const previousConsent = await user.auth.oauth.getAuthorizationDetails(secondId);
    expect(previousConsent.error).toBeNull();
    const redirect = previousConsent.data!;
    expect("redirect_url" in redirect).toBe(true);
    if (!("redirect_url" in redirect)) throw new Error("Expected previous consent");
    const secondCode = new URL(redirect.redirect_url).searchParams.get("code")!;
    expect((await exchange({ grant_type: "authorization_code", code: secondCode, code_verifier: "x".repeat(64), redirect_uri: String(provider.redirectUrl) })).status).toBe(400);

    expect((await user.auth.oauth.revokeGrant({ clientId: clientId! })).error).toBeNull();
    expect(await auth(provider, { serverUrl: resourceUrl })).toBe("REDIRECT");
    const deniedRequest = await fetch(authorizationUrl!, { redirect: "manual" });
    const deniedId = new URL(deniedRequest.headers.get("location")!).searchParams.get("authorization_id")!;
    expect((await user.auth.oauth.getAuthorizationDetails(deniedId)).error).toBeNull();
    const denied = await user.auth.oauth.denyAuthorization(deniedId, { skipBrowserRedirect: true });
    expect(denied.error).toBeNull();
    const deniedCallback = new URL(denied.data!.redirect_url);
    expect(deniedCallback.searchParams.get("error")).toBe("access_denied");
    expect(deniedCallback.searchParams.get("state")).toBe(state);
    expect(deniedCallback.searchParams.has("code")).toBe(false);
  } finally {
    await mcp?.close();
    if (clientId) {
      await pool.query("delete from private.mcp_oauth_clients where client_id=$1", [clientId]);
      await admin.auth.admin.oauth.deleteClient(clientId);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
    await pool.end();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
}, 30_000);
