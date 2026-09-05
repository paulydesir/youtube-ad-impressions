import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ImpressionStore } from "../repositories/store.js";
import { createMcpServer } from "./server.js";

function methodNotAllowed(res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

// Stateless Streamable HTTP transport at /mcp: one fresh McpServer per POST
// request, no session tracking. GET/DELETE are rejected with 405 per the
// stateless example in the MCP TypeScript SDK.
export function createMcpRouter(store: ImpressionStore, log: (message: string) => void = console.info): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const server = createMcpServer(store, log);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      // eslint-disable-next-line no-console -- concise server-side diagnostic
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  router.get("/", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  router.delete("/", (_req: Request, res: Response) => {
    methodNotAllowed(res);
  });

  return router;
}
