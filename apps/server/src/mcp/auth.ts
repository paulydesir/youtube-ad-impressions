import { Router, type RequestHandler } from "express";
import { fromSupabaseUrl, resourceMetadataResponse, unauthorizedResponse } from "@supabase/server/oauth-protected-resource";
import { createTokenVerifier, requireSupabaseAuth, type VerifyAccessToken } from "../http/supabase-auth.js";
import { requireUserId } from "../repositories/tenant.js";

export interface McpAuthOptions {
  resourceUrl: string;
  supabaseUrl: string;
  verifyAccessToken?: VerifyAccessToken;
}

// OAuth access tokens must target this resource. Supabase's default
// "authenticated" audience (including extension sessions) is insufficient.
export function createMcpTokenVerifier(supabaseUrl: string, resourceUrl: string): VerifyAccessToken {
  return createTokenVerifier(supabaseUrl, (claims, issuer) => {
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audience.includes(resourceUrl)
      || typeof claims.exp !== "number" || typeof claims.iat !== "number"
      || typeof claims.client_id !== "string" || !claims.client_id
      || claims.role !== "authenticated" || claims.is_anonymous === true) {
      throw new Error("Invalid OAuth access token");
    }
    return { userId: requireUserId(claims.sub), email: typeof claims.email === "string" ? claims.email : "" };
  });
}

export function mcpMetadataPath(resourceUrl: string): string {
  return `/.well-known/oauth-protected-resource${new URL(resourceUrl).pathname.replace(/\/$/, "")}`;
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
    res.status(response.status).json({
      ...await response.json() as Record<string, unknown>,
      resource_name: "YouTube Ad Impressions",
    });
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

export function requireMcpAuth(options?: McpAuthOptions): RequestHandler {
  const metadataUrl = options
    ? new URL(mcpMetadataPath(options.resourceUrl), options.resourceUrl).href : undefined;
  const challenge = options && metadataUrl
    ? unauthorizedResponse(new Request(options.resourceUrl), { resourceMetadataUrl: metadataUrl })
      .headers.get("WWW-Authenticate")!
    : "Bearer";
  return requireSupabaseAuth(options?.verifyAccessToken, hasToken => {
    return hasToken ? `${challenge}${metadataUrl ? "," : ""} error="invalid_token"` : challenge;
  });
}
