import { Router, type Request, type Response } from "express";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import { ZodError } from "zod";
import type { ImpressionStore } from "../repositories/store.js";
import { requireSupabaseAuth, type AuthenticatedRequest, type VerifyAccessToken } from "./supabase-auth.js";

const MAX_BATCH_SIZE = 500;

interface BatchItemError {
  index: number;
  message: string;
}

function validationMessage(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export function createImpressionsRouter(
  store: ImpressionStore,
  verifyAccessToken: VerifyAccessToken | undefined,
  log: (message: string) => void = console.info,
): Router {
  const router = Router();
  router.use(requireSupabaseAuth(verifyAccessToken));

  router.get("/", async (req: Request, res: Response) => {
    const requested = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(requested) ? requested : 100;
    const records = await store.searchImpressions((req as AuthenticatedRequest).auth!.userId, { limit });
    res.json({ records });
  });

  router.post("/", async (req: Request, res: Response) => {
    let record;
    let rawJson;
    try {
      ({ record, rawJson } = toAdImpressionV1(req.body));
    } catch (error) {
      res.status(400).json({
        error: "invalid_record",
        message: error instanceof ZodError ? validationMessage(error) : "Invalid record.",
      });
      return;
    }
    const { status, eventId } = await store.insertImpression((req as AuthenticatedRequest).auth!.userId, record, rawJson);
    log(`[ingest] ${status} event_id=${eventId}`);
    if (status === "duplicate") {
      res.status(200).json({ event_id: eventId, duplicate: true });
      return;
    }
    res.status(201).json({ event_id: eventId, duplicate: false });
  });

  router.post("/batch", async (req: Request, res: Response) => {
    if (!Array.isArray(req.body)) {
      res.status(400).json({ error: "invalid_batch", message: "Batch body must be an array." });
      return;
    }
    if (req.body.length > MAX_BATCH_SIZE) {
      res.status(413).json({
        error: "batch_too_large",
        message: `Batch accepts at most ${MAX_BATCH_SIZE} records.`,
      });
      return;
    }
    let accepted = 0;
    let duplicates = 0;
    const errors: BatchItemError[] = [];
    for (let index = 0; index < req.body.length; index += 1) {
      try {
        const { record, rawJson } = toAdImpressionV1(req.body[index]);
        const { status } = await store.insertImpression((req as AuthenticatedRequest).auth!.userId, record, rawJson);
        if (status === "duplicate") duplicates += 1;
        else accepted += 1;
      } catch (error) {
        errors.push({
          index,
          message: error instanceof ZodError ? validationMessage(error) : "Invalid record.",
        });
      }
    }
    res.status(200).json({ accepted, duplicates, rejected: errors.length, errors });
    log(`[ingest] batch size=${req.body.length} accepted=${accepted} duplicates=${duplicates} rejected=${errors.length}`);
  });

  return router;
}
