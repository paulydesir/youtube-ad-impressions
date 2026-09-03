import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { isDatabaseReady, type DatabaseClient } from "../db/client.js";
import { createMcpRouter } from "../mcp/router.js";
import { createImpressionsRouter } from "./impressions.js";

export interface AppOptions {
  db: DatabaseClient;
  ingestToken: string;
}

// Malformed JSON bodies must produce a stable JSON error, not Express's
// default HTML error page.
const jsonErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400 &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON." });
    return;
  }
  next(error);
};

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // 500 records of ~1KB each fit comfortably; the default 100kb would not.
  app.use(express.json({ limit: "5mb" }));

  app.get("/healthz", (_req, res) => {
    if (isDatabaseReady(options.db)) {
      res.json({ ok: true, database: "ready" });
      return;
    }
    res.status(503).json({ ok: false, database: "unavailable" });
  });

  app.use("/api/v1/impressions", createImpressionsRouter(options.db, options.ingestToken));

  app.use("/mcp", createMcpRouter(options.db));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(jsonErrorHandler);

  return app;
}
