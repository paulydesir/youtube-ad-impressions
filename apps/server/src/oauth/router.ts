import { Router } from "express";
import { fileURLToPath } from "node:url";

export interface ConsentOptions { supabaseUrl: string; publishableKey: string }

export function createConsentRouter(options: ConsentOptions): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${new URL(options.supabaseUrl).origin}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    });
    next();
  });
  router.get("/config", (_req, res) => res.json(options));
  const publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url));
  router.get("/consent", (_req, res) => res.sendFile("consent.html", { root: publicDirectory }));
  router.get("/consent.js", (_req, res) => res.sendFile("consent.js", { root: publicDirectory }));
  router.get("/consent.css", (_req, res) => res.sendFile("consent.css", { root: publicDirectory }));
  return router;
}
