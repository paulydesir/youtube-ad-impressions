import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createTokenVerifier, requireSupabaseAuth, type AuthenticatedRequest } from "../src/http/supabase-auth.js";
import { generateKeyPairSync, sign } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "ES256", use: "sig" };
const userId = "9c3f24dd-50ab-4f8c-a389-a860dd3053ae";
function jwt(overrides = {}, badSignature = false) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: userId, email: "auth@example.com", aud: "authenticated", iss: "http://localhost/auth/v1", exp: Math.floor(Date.now()/1000)+60, ...overrides })).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  if (badSignature) signature[0] ^= 255;
  return `${header}.${body}.${signature.toString("base64url")}`;
}
describe("Supabase JWT middleware", () => {
  it("verifies signatures and claims, rejects missing/malformed/expired tokens, derives identity", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    try {
      const app = express();
      app.get("/me", requireSupabaseAuth(createTokenVerifier("http://localhost")), (req, res) => {
        const auth = (req as AuthenticatedRequest).auth!;
        res.json({ id: auth.userId, email: auth.email });
      });
      expect((await request(app).get("/me")).status).toBe(401);
      for (const token of ["bad", jwt({}, true), jwt({ exp: 1 }), jwt({ exp: undefined }), jwt({ nbf: Math.floor(Date.now()/1000)+600 }), jwt({ email: undefined }), jwt({ iss: "http://other/auth/v1" }), jwt({ aud: "anon" }), jwt({ sub: "" }), jwt({ client_id: "oauth-client" }), jwt({ aud: "https://ads.example.com/mcp", client_id: "oauth-client" })]) {
        expect((await request(app).get("/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
      }
      expect((await request(app).get("/me").set("Authorization", "Basic abc")).status).toBe(401);
      const result = await request(app).get("/me?userId=attacker").set("Authorization", `Bearer ${jwt()}`);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ id: userId, email: "auth@example.com" });
    } finally { globalThis.fetch = original; }
  });
});
