import { verifyCredentials } from "@supabase/server/core";
import type { JWTClaims } from "@supabase/server";
import { requireUserId } from "../repositories/tenant.js";
import type { RequestHandler, Request } from "express";

export interface AuthContext {
  userId: string;
  email: string;
}
export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
export type VerifyAccessToken = (token: string) => Promise<AuthContext>;
export type ClaimsValidator = (claims: JWTClaims, issuer: string) => AuthContext;

function hasAuthenticatedAudience(claims: JWTClaims): boolean {
  if (Array.isArray(claims.aud)) {
    return claims.aud.includes("authenticated");
  }
  return claims.aud === "authenticated";
}

function extensionClaims(claims: JWTClaims, issuer: string): AuthContext {
  if (claims.iss !== issuer) {
    throw new Error("Invalid access token");
  }
  if (!hasAuthenticatedAudience(claims)) {
    throw new Error("Invalid access token");
  }
  if (typeof claims.exp !== "number") {
    throw new Error("Invalid access token");
  }
  if (claims.client_id !== undefined) {
    throw new Error("Invalid access token");
  }
  if (typeof claims.email !== "string") {
    throw new Error("Invalid access token");
  }
  return { userId: requireUserId(claims.sub), email: claims.email };
}

export function createTokenVerifier(url: string, validate: ClaimsValidator = extensionClaims): VerifyAccessToken {
  const issuer = `${url.replace(/\/$/, "")}/auth/v1`;
  return async (token) => {
    const { data, error } = await verifyCredentials(
      { token, apikey: null },
      { auth: "user", env: { url, jwks: new URL(`${issuer}/.well-known/jwks.json`) } },
    );
    if (error) {
      throw error;
    }
    if (!data?.jwtClaims) {
      throw new Error("Invalid access token");
    }
    return validate(data.jwtClaims, issuer);
  };
}

export function requireSupabaseAuth(
  verify?: VerifyAccessToken,
  challenge: (hasToken: boolean) => string = () => "Bearer",
): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    if (!match || !verify) {
      res.set("WWW-Authenticate", challenge(Boolean(match))).status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      (req as AuthenticatedRequest).auth = await verify(match[1] as string);
    } catch {
      res.set("WWW-Authenticate", challenge(true)).status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
