import { createRemoteJWKSet, jwtVerify } from "jose";
import { Router, type RequestHandler } from "express";
import type { AuthenticatedRequest, VerifyAccessToken } from "../http/supabase-auth.js";
import { requireUserId } from "../repositories/tenant.js";

export interface McpAuthOptions {
  resourceUrl: string;
  supabaseUrl: string;
  verifyAccessToken?: VerifyAccessToken;
}

// OAuth access tokens must target this resource. Supabase's default
// "authenticated" audience (including extension sessions) is insufficient.
export function createMcpTokenVerifier(supabaseUrl: string, resourceUrl: string): VerifyAccessToken {
  const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async token => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: resourceUrl,
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "exp", "iat", "client_id"],
    });
    if (typeof payload.client_id !== "string" || !payload.client_id
      || payload.role !== "authenticated" || payload.is_anonymous === true) {
      throw new Error("Invalid OAuth access token");
    }
    return { userId: requireUserId(payload.sub!), email: typeof payload.email === "string" ? payload.email : "" };
  };
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
  return async (req, res, next) => {
    const metadataUrl = options
      ? new URL(mcpMetadataPath(options.resourceUrl), options.resourceUrl).href : undefined;
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") ?? "");
    try {
      if (!match || !options?.verifyAccessToken) throw new Error("Unauthorized");
      (req as AuthenticatedRequest).auth = await options.verifyAccessToken(match[1]!);
    } catch {
      const parameters = [];
      if (metadataUrl) parameters.push(`resource_metadata="${metadataUrl}"`);
      if (match) parameters.push('error="invalid_token"');
      res.set("WWW-Authenticate", `Bearer${parameters.length ? ` ${parameters.join(", ")}` : ""}`)
        .status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
