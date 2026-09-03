import express, { type Express } from "express";

// Shell health route. Feature 3 wires real database readiness here; until
// then the service reports that no database is configured yet.
export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, database: "not-configured" });
  });

  return app;
}
