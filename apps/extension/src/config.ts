declare const __SERVER_URL__: string | undefined;

function resolveServerBaseUrl(): string {
  if (typeof __SERVER_URL__ === "string" && __SERVER_URL__.length > 0) {
    return __SERVER_URL__.replace(/\/$/, "");
  }
  // The fallback keeps unbundled Node tests working.
  return "http://127.0.0.1:8787";
}

export const SERVER_BASE_URL = resolveServerBaseUrl();

export const IMPRESSIONS_ENDPOINT = `${SERVER_BASE_URL}/api/v1/impressions`;
