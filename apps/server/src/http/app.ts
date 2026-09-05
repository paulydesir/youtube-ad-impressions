import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { ImpressionStore } from "../repositories/store.js";
import { createMcpRouter } from "../mcp/router.js";
import { requireBearerToken } from "./auth.js";
import { createImpressionsRouter } from "./impressions.js";

export interface AppOptions {
  store: ImpressionStore;
  // Backend readiness probe. Async because PostgreSQL checks require I/O.
  isDatabaseReady: () => Promise<boolean>;
  ingestToken: string;
  mcpToken: string;
  requestLog?: (message: string) => void;
  // Operational trace log (ingest outcomes, MCP tool calls). Defaults to
  // console.info; never receives request bodies or tokens.
  log?: (message: string) => void;
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
  if (options.requestLog) {
    app.use((req, res, next) => {
      const startedAt = performance.now();
      res.on("finish", () => {
        const durationMs = Math.round(performance.now() - startedAt);
        options.requestLog?.(
          `${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`,
        );
      });
      next();
    });
  }
  // Authenticate MCP before parsing potentially large request bodies. The
  // ingestion API retains its route-specific bearer check below.
  app.use("/mcp", requireBearerToken(options.mcpToken));
  // 500 records of ~1KB each fit comfortably; the default 100kb would not.
  app.use(express.json({ limit: "5mb" }));

  app.get("/healthz", async (_req, res) => {
    if (await options.isDatabaseReady()) {
      res.json({ ok: true, database: "ready" });
      return;
    }
    res.status(503).json({ ok: false, database: "unavailable" });
  });

  app.use("/api/v1/impressions", createImpressionsRouter(options.store, options.ingestToken, options.log));

  app.use("/mcp", createMcpRouter(options.store, options.log));

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(jsonErrorHandler);

  return app;
}
