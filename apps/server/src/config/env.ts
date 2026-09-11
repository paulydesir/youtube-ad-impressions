import { z } from "zod";

const publicUrl = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash
    && (url.protocol === "https:" || (url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
}, "Use HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment").transform(value => new URL(value).href);

const sharedConfig = {
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    POSTGRES_USER: z.string().min(1).default("ad_impressions"),
    POSTGRES_PASSWORD: z.string().min(1).default("ad_impressions"),
    POSTGRES_DB: z.string().min(1).default("ad_impressions"),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
};

const configSchema = z.discriminatedUnion("APP_ENV", [
  z.object({
    APP_ENV: z.literal("development"),
    SUPABASE_URL: publicUrl.default("http://127.0.0.1:54321"),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    HOST: z.string().min(1).default("127.0.0.1"),
    DATABASE_URL: z.string().min(1).default("postgresql://ad_impressions:ad_impressions@127.0.0.1:5432/ad_impressions"),
    MCP_RESOURCE_URL: publicUrl.default("http://127.0.0.1:8787/mcp"),
    ...sharedConfig,
  }),
  z.object({
    APP_ENV: z.literal("production"),
    SUPABASE_URL: publicUrl.refine(value => !new URL(value).hostname.match(/^(localhost|127\.|\[::1\]$)/), "Production Supabase URL must be remote"),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    HOST: z.string().min(1).default("0.0.0.0"),
    DATABASE_URL: z.string().min(1),
    MCP_RESOURCE_URL: publicUrl.refine(value => new URL(value).protocol === "https:", "Production MCP URL must use HTTPS"),
    ...sharedConfig,
  }),
]);

export type ServerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = configSchema.safeParse({ ...env, APP_ENV: env.APP_ENV ?? "development" });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${details}`);
  }
  return parsed.data;
}
