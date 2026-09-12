import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { createMcpTokenVerifier } from "../src/mcp/auth.js";
import type { ImpressionStore } from "../src/repositories/store.js";

const resourceUrl = "https://ads.example.com/mcp";
const userId = "9c3f24dd-50ab-4f8c-a389-a860dd3053ae";
const keys = await generateKeyPair("ES256");
const otherKeys = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(keys.publicKey), kid: "mcp-test", alg: "ES256" };
let jwksServer: Server;
let supabaseUrl: string;
let app: ReturnType<typeof createApp>;
const store: ImpressionStore = {
  insertImpression: vi.fn(), searchImpressions: vi.fn(),
  getAdvertiserStats: vi.fn(), getAdvertiserOverviewData: vi.fn(),
};

async function token(overrides: Record<string, unknown> = {}, badSignature = false) {
  return new SignJWT({
    iss: `${supabaseUrl}/auth/v1`, aud: resourceUrl, sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000),
    role: "authenticated", client_id: "dedicated-mcp-client", ...overrides,
  }).setProtectedHeader({ alg: "ES256", kid: "mcp-test" }).sign(badSignature ? otherKeys.privateKey : keys.privateKey);
}

beforeAll(async () => {
  jwksServer = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>(resolve => jwksServer.listen(0, "127.0.0.1", resolve));
  supabaseUrl = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
  app = createApp({
    store, isDatabaseReady: async () => true,
    mcpAuth: { resourceUrl, supabaseUrl, verifyAccessToken: createMcpTokenVerifier(supabaseUrl, resourceUrl) },
    consent: { supabaseUrl, publishableKey: "public-test-key" },
  });
});
afterAll(async () => { await new Promise<void>(resolve => jwksServer.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });

describe("MCP OAuth resource server", () => {
  it("advertises the canonical resource and issuer without trusting Host headers", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await request(app).get(path).set("Host", "evil.example").set("X-Forwarded-Host", "evil.example");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ resource: resourceUrl, authorization_servers: [`${supabaseUrl}/auth/v1`], bearer_methods_supported: ["header"] });
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }
  });

  it("points production discovery to the existing Supabase project", async () => {
    const env = parse(readFileSync(new URL("../.env.production.example", import.meta.url)));
    const production = createApp({ store, isDatabaseReady: async () => true,
      mcpAuth: { resourceUrl: env.MCP_RESOURCE_URL!, supabaseUrl: env.SUPABASE_URL! },
    });
    const response = await request(production).get("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(response.body.resource).toBe("https://youtube-ad-impressions.onrender.com/mcp");
    expect(response.body.authorization_servers).toEqual(["https://snyecvnutlrhyicvwzfh.supabase.co/auth/v1"]);
    const unauthorized = await request(production).post("/mcp");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="https://youtube-ad-impressions.onrender.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("allows browser preflight on both public metadata URLs", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await request(app).options(path)
        .set("Origin", "https://client.example.com")
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "mcp-protocol-version");
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
      expect(response.headers["access-control-allow-headers"]).toContain("mcp-protocol-version");
      expect(response.headers["www-authenticate"]).toBeUndefined();
    }
  });

  it("challenges missing and invalid credentials on every MCP HTTP method", async () => {
    for (const method of ["post", "get", "delete"] as const) {
      const response = await request(app)[method]("/mcp?access_token=old-shared-token");
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
      expect(response.headers["www-authenticate"]).toBe('Bearer resource_metadata="https://ads.example.com/.well-known/oauth-protected-resource/mcp"');
    }
    expect((await request(app).post("/mcp").set("Authorization", "Bearer old-shared-token").set("Content-Type", "application/json").send("{")).status).toBe(401);
    expect((await request(createApp({ store, isDatabaseReady: async () => true })).post("/mcp")).status).toBe(401);
  });

  it("verifies signatures, expiry, issuer, resource audience, OAuth client and user identity", async () => {
    const invalid = [
      await token({}, true), await token({ exp: 1 }), await token({ exp: undefined }),
      await token({ nbf: Math.floor(Date.now() / 1000) + 600 }),
      await token({ iss: "https://other.example/auth/v1" }),
      await token({ aud: "authenticated" }), await token({ aud: "https://other.example/mcp" }),
      await token({ sub: "not-a-user" }), await token({ client_id: undefined }),
      await token({ client_id: "" }), await token({ role: "service_role" }), await token({ is_anonymous: true }),
    ];
    for (const bearer of invalid) {
      const response = await request(app).post("/mcp").set("Authorization", `Bearer ${bearer}`)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_ad_impressions", arguments: {} } });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "unauthorized" });
      expect(response.headers["www-authenticate"]).toBe('Bearer resource_metadata="https://ads.example.com/.well-known/oauth-protected-resource/mcp", error="invalid_token"');
    }
    expect((await request(app).get("/mcp").set("Authorization", `bearer ${await token()}`)).status).toBe(405);
    expect(store.searchImpressions).not.toHaveBeenCalled();
  });

  it("initializes MCP and executes a tool as the verified token's user", async () => {
    const bearer = await token();
    const post = (body: object) => request(app).post("/mcp")
      .set("Authorization", `Bearer ${bearer}`)
      .set("Accept", "application/json, text/event-stream").send(body);
    const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "auth-test", version: "1.0" },
    } });
    expect(initialized.status).toBe(200);
    expect(initialized.text).toContain('"serverInfo":{"name":"youtube-ad-impressions"');
    expect(initialized.headers["www-authenticate"]).toBeUndefined();
    vi.mocked(store.searchImpressions).mockResolvedValueOnce([]);
    const result = await post({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "search_ad_impressions", arguments: {} },
    });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"structuredContent":{"impressions":[]}');
    expect(store.searchImpressions).toHaveBeenCalledExactlyOnceWith(userId, expect.any(Object));
  });

  it("serves consent assets with framing and referrer protection", async () => {
    const response = await request(app).get("/oauth/consent?authorization_id=test");
    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.text).toContain("Allow access");
    expect((await request(app).get("/oauth/consent.js")).status).toBe(200);
    expect((await request(app).get("/oauth/config")).body).toEqual({ supabaseUrl, publishableKey: "public-test-key" });
  });
});
