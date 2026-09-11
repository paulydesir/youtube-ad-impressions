import { Router, type RequestHandler } from "express";
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
  router.get([mcpMetadataPath(options.resourceUrl), "/.well-known/oauth-protected-resource"], (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*").json({
      resource: resource.href,
      authorization_servers: [`${options.supabaseUrl.replace(/\/$/, "")}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "YouTube Ad Impressions",
    });
  });
  return router;
}

export function requireMcpAuth(options?: McpAuthOptions): RequestHandler {
  const metadataUrl = options
    ? new URL(mcpMetadataPath(options.resourceUrl), options.resourceUrl).href : undefined;
  return requireSupabaseAuth(options?.verifyAccessToken, hasToken => {
    const parameters = [];
    if (metadataUrl) parameters.push(`resource_metadata="${metadataUrl}"`);
    if (hasToken) parameters.push('error="invalid_token"');
    return `Bearer${parameters.length ? ` ${parameters.join(", ")}` : ""}`;
  });
}
