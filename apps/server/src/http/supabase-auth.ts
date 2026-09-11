import { verifyCredentials } from "@supabase/server/core";
import type { JWTClaims } from "@supabase/server";
import { requireUserId } from "../repositories/tenant.js";
import type { RequestHandler, Request } from "express";

export interface AuthContext { userId: string; email: string }
export interface AuthenticatedRequest extends Request { auth?: AuthContext }
export type VerifyAccessToken = (token: string) => Promise<AuthContext>;
export type ClaimsValidator = (claims: JWTClaims, issuer: string) => AuthContext;

function extensionClaims(claims: JWTClaims, issuer: string): AuthContext {
  if (claims.iss !== issuer
    || !(Array.isArray(claims.aud) ? claims.aud.includes("authenticated") : claims.aud === "authenticated")
    || typeof claims.exp !== "number"
    || claims.client_id !== undefined
    || typeof claims.email !== "string") throw new Error("Invalid access token");
  return { userId: requireUserId(claims.sub), email: claims.email };
}

export function createTokenVerifier(url: string, validate: ClaimsValidator = extensionClaims): VerifyAccessToken {
  const issuer = `${url.replace(/\/$/, "")}/auth/v1`;
  return async token => {
    const { data, error } = await verifyCredentials({ token, apikey: null }, {
      auth: "user", env: { url, jwks: new URL(`${issuer}/.well-known/jwks.json`) },
    });
    if (error || !data?.jwtClaims) throw error ?? new Error("Invalid access token");
    return validate(data.jwtClaims, issuer);
  };
}

export function requireSupabaseAuth(
  verify?: VerifyAccessToken,
  challenge: (hasToken: boolean) => string = () => "Bearer",
): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    try {
      if (!match || !verify) throw new Error("Unauthorized");
      (req as AuthenticatedRequest).auth = await verify(match[1]!);
    } catch {
      res.set("WWW-Authenticate", challenge(Boolean(match))).status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
