import { Router, type Request, type Response } from "express";
import { toAdImpressionV1 } from "@ad-impressions/contracts";
import { z, ZodError } from "zod";
import type { ImpressionStore } from "../repositories/store.js";
import { requireSupabaseAuth, type AuthenticatedRequest, type VerifyAccessToken } from "./supabase-auth.js";

const MAX_BATCH_SIZE = 500;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const MAX_CURSOR_BYTES = 4096;

interface BatchItemError {
  index: number;
  message: string;
}

interface Cursor {
  startedAt: string;
  eventId: string;
}

const cursorSchema = z.object({
  startedAt: z.iso.datetime({ offset: true }),
  eventId: z.string().min(1),
});

function validationMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
  }
  return "Invalid record.";
}

function userIdOf(req: Request): string {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    throw new Error("Missing auth context.");
  }
  return auth.userId;
}

function parseLimit(value: unknown): number {
  const requested = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }
  const floored = Math.floor(requested);
  if (floored < 1) {
    return 1;
  }
  if (floored > MAX_LIMIT) {
    return MAX_LIMIT;
  }
  return floored;
}

function parseCursor(value: unknown): Cursor | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > MAX_CURSOR_BYTES) {
    throw new Error("Invalid cursor");
  }
  return cursorSchema.parse(JSON.parse(value));
}

export function createImpressionsRouter(store: ImpressionStore, verifyAccessToken: VerifyAccessToken | undefined): Router {
  const router = Router();
  router.use(requireSupabaseAuth(verifyAccessToken));

  router.get("/", async (req: Request, res: Response) => {
    const limit = parseLimit(req.query.limit);
    let before: Cursor | undefined;
    try {
      before = parseCursor(req.query.cursor);
    } catch {
      res.status(400).json({ error: "invalid_cursor" });
      return;
    }

    const records = await store.searchImpressions(userIdOf(req), { limit, before });
    const last = records.at(-1);
    let nextCursor: string | null = null;
    if (records.length === limit && last) {
      nextCursor = JSON.stringify({ startedAt: last.startedAt, eventId: last.eventId });
    }
    res.json({ records, nextCursor });
  });

  router.post("/", async (req: Request, res: Response) => {
    let parsed;
    try {
      parsed = toAdImpressionV1(req.body);
    } catch (error) {
      res.status(400).json({ error: "invalid_record", message: validationMessage(error) });
      return;
    }
    const { status, eventId } = await store.insertImpression(userIdOf(req), parsed.record, parsed.rawJson);
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
      res.status(413).json({ error: "batch_too_large", message: `Batch accepts at most ${MAX_BATCH_SIZE} records.` });
      return;
    }

    let accepted = 0;
    let duplicates = 0;
    const errors: BatchItemError[] = [];
    const userId = userIdOf(req);

    for (const [index, item] of req.body.entries()) {
      try {
        const parsed = toAdImpressionV1(item);
        const result = await store.insertImpression(userId, parsed.record, parsed.rawJson);
        if (result.status === "duplicate") {
          duplicates += 1;
        } else {
          accepted += 1;
        }
      } catch (error) {
        errors.push({ index, message: validationMessage(error) });
      }
    }
    res.status(200).json({ accepted, duplicates, rejected: errors.length, errors });
  });

  return router;
}
