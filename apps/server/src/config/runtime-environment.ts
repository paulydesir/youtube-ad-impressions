import { join } from "node:path";
import dotenv from "dotenv";

export type AppEnvironment = "development" | "production";

export function loadRuntimeEnvironment(
  serverDir: string,
  env: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const appEnvironment = env.APP_ENV ?? "development";
  if (appEnvironment !== "development" && appEnvironment !== "production") {
    throw new Error(`Invalid APP_ENV: ${appEnvironment}`);
  }

  // Production secrets must come from the process environment supplied by the
  // deployment platform. Only development reads local, gitignored files.
  if (appEnvironment === "development") {
    dotenv.config({
      path: [join(serverDir, ".env.development.local"), join(serverDir, ".env")],
      processEnv: env,
    });
  }
  return appEnvironment;
}
