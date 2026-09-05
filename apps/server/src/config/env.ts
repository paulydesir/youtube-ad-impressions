import { z } from "zod";

const configSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().min(1).default("127.0.0.1"),
    DATABASE_FILE: z.string().min(1).default("./data/ad-impressions.sqlite"),
    DATABASE_URL: z.string().min(1).optional(),
    POSTGRES_USER: z.string().min(1).default("ad_impressions"),
    POSTGRES_PASSWORD: z.string().min(1).default("ad_impressions"),
    POSTGRES_DB: z.string().min(1).default("ad_impressions"),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    INGEST_API_TOKEN: z
      .string({ error: "INGEST_API_TOKEN must be set to a non-empty local token" })
      .min(1, "INGEST_API_TOKEN must be set to a non-empty local token"),
    MCP_API_TOKEN: z
      .string({ error: "MCP_API_TOKEN must be set to a non-empty local token" })
      .min(1, "MCP_API_TOKEN must be set to a non-empty local token"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine((config) => config.MCP_API_TOKEN !== config.INGEST_API_TOKEN, {
    path: ["MCP_API_TOKEN"],
    message: "MCP_API_TOKEN must differ from INGEST_API_TOKEN",
  });

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${details}`);
  }
  return parsed.data;
}
