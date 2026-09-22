import { Router, type RequestHandler } from "express";
import { fromSupabaseUrl, resourceMetadataResponse, unauthorizedResponse } from "@supabase/server/oauth-protected-resource";
import { createTokenVerifier, requireSupabaseAuth, type VerifyAccessToken } from "../http/supabase-auth.js";
import { requireUserId } from "../repositories/tenant.js";

export interface McpAuthOptions {
  resourceUrl: string;
  supabaseUrl: string;
  verifyAccessToken?: VerifyAccessToken;
}

function isValidMcpClaims(
  claims: { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown; client_id?: unknown; role?: unknown; is_anonymous?: unknown },
  issuer: string,
  resourceUrl: string,
): boolean {
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer) {
    return false;
  }
  if (!audience.includes(resourceUrl)) {
    return false;
  }
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
    return false;
  }
  if (typeof claims.client_id !== "string" || claims.client_id === "") {
    return false;
  }
  if (claims.role !== "authenticated" || claims.is_anonymous === true) {
    return false;
  }
  return true;
}

// OAuth access tokens must target this resource. Supabase's default
// "authenticated" audience (including extension sessions) is insufficient.
export function createMcpTokenVerifier(supabaseUrl: string, resourceUrl: string): VerifyAccessToken {
  return createTokenVerifier(supabaseUrl, (claims, issuer) => {
    if (!isValidMcpClaims(claims, issuer, resourceUrl)) {
      throw new Error("Invalid OAuth access token");
    }
    const email = typeof claims.email === "string" ? claims.email : "";
    return { userId: requireUserId(claims.sub), email };
  });
}

export function mcpMetadataPath(resourceUrl: string): string {
  const pathname = new URL(resourceUrl).pathname.replace(/\/$/, "");
  return `/.well-known/oauth-protected-resource${pathname}`;
}

export function createMcpMetadataRouter(options: McpAuthOptions): Router {
  const router = Router();
  const resource = new URL(options.resourceUrl);
  const paths = [mcpMetadataPath(options.resourceUrl), "/.well-known/oauth-protected-resource"];

  // The package's Fetch middleware uses a different metadata path. Compose
  // its response primitives with Express to retain our RFC 9728 well-known URLs
  // and existing JWT gate, without adapting the streaming MCP transport.
  router.get(paths, async (_req, res) => {
    const response = resourceMetadataResponse(new Request(resource), {
      resource: resource.href,
      authorizationServers: [fromSupabaseUrl(options.supabaseUrl)],
    });
    response.headers.forEach((value, name) => res.set(name, value));
    const payload = (await response.json()) as Record<string, unknown>;
    res.status(response.status).json({ ...payload, resource_name: "YouTube Ad Impressions" });
  });
  router.options(paths, (_req, res) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
    }).status(204).end();
  });
  return router;
}

function baseChallenge(options?: McpAuthOptions): { challenge: string; metadataUrl?: string } {
  if (!options) {
    return { challenge: "Bearer" };
  }
  const metadataUrl = new URL(mcpMetadataPath(options.resourceUrl), options.resourceUrl).href;
  const challenge = unauthorizedResponse(new Request(options.resourceUrl), { resourceMetadataUrl: metadataUrl })
    .headers.get("WWW-Authenticate");
  if (!challenge) {
    return { challenge: "Bearer", metadataUrl };
  }
  return { challenge, metadataUrl };
}

export function requireMcpAuth(options?: McpAuthOptions): RequestHandler {
  const { challenge, metadataUrl } = baseChallenge(options);
  return requireSupabaseAuth(options?.verifyAccessToken, (hasToken) => {
    if (!hasToken) {
      return challenge;
    }
    if (metadataUrl) {
      return `${challenge}, error="invalid_token"`;
    }
    return `${challenge} error="invalid_token"`;
  });
}
