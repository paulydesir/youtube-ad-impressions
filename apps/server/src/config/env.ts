import { z } from "zod";

const publicUrl = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash
    && (url.protocol === "https:" || (url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
}, "Use HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment").transform(value => new URL(value).href);

const configSchema = z
  .object({
    SUPABASE_URL: publicUrl.default("http://127.0.0.1:54321"),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().min(1).default("127.0.0.1"),
    DATABASE_FILE: z.string().min(1).default("./data/ad-impressions.sqlite"),
    DATABASE_URL: z.string().min(1).optional(),
    POSTGRES_USER: z.string().min(1).default("ad_impressions"),
    POSTGRES_PASSWORD: z.string().min(1).default("ad_impressions"),
    POSTGRES_DB: z.string().min(1).default("ad_impressions"),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    MCP_RESOURCE_URL: publicUrl.default("http://127.0.0.1:8787/mcp"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
