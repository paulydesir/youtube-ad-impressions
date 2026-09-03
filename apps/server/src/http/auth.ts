import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Rejects requests without a matching `Authorization: Bearer <token>`.
// Failures carry no detail about what was wrong or what was expected.
export function requireIngestToken(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.get("authorization");
    const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (provided === null || !tokensEqual(provided, expectedToken)) {
      res.set("WWW-Authenticate", "Bearer");
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
