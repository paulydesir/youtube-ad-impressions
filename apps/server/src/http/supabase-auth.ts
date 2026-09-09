import { createClient } from "@supabase/supabase-js";
import type { RequestHandler, Request } from "express";

export interface AuthContext { userId: string; email: string }
export interface AuthenticatedRequest extends Request { auth?: AuthContext }
export type VerifyAccessToken = (token: string) => Promise<AuthContext>;

export function createTokenVerifier(url: string, key: string): VerifyAccessToken {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return async token => {
    const { data, error } = await client.auth.getClaims(token);
    const claims = data?.claims;
    if (error || !claims || claims.iss !== `${url.replace(/\/$/, "")}/auth/v1`
      || !(Array.isArray(claims.aud) ? claims.aud.includes("authenticated") : claims.aud === "authenticated")
      || !claims.exp || claims.exp <= Date.now() / 1000
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)
      || claims.client_id !== undefined
      || typeof claims.email !== "string") throw new Error("Invalid access token");
    return { userId: claims.sub, email: claims.email };
  };
}

export function requireSupabaseAuth(verify?: VerifyAccessToken): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    try {
      if (!match || !verify) throw new Error("Unauthorized");
      (req as AuthenticatedRequest).auth = await verify(match[1]!);
    } catch {
      res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
