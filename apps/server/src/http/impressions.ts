import { Router, type Request, type Response } from "express";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import { ZodError } from "zod";
import type { DatabaseClient } from "../db/client.js";
import { insertImpression } from "../repositories/impressions.js";
import { requireIngestToken } from "./auth.js";

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

export function createImpressionsRouter(db: DatabaseClient, ingestToken: string): Router {
  const router = Router();
  router.use(requireIngestToken(ingestToken));

  // Single impression. 201 for a new record, 200 with duplicate:true when the
  // event_id was already stored, 400 for an invalid record.
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
    const { status, eventId } = await insertImpression(db, record, rawJson);
    if (status === "duplicate") {
      res.status(200).json({ event_id: eventId, duplicate: true });
      return;
    }
    res.status(201).json({ event_id: eventId, duplicate: false });
  });

  // Backfill/retries. Every item is handled idempotently; invalid items are
  // counted as rejected without aborting the batch.
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
        const { status } = await insertImpression(db, record, rawJson);
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
  });

  return router;
}
