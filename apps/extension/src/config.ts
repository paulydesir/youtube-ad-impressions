declare const __SERVER_URL__: string | undefined;

// The fallback keeps unbundled Node tests working.
export const SERVER_BASE_URL: string =
  typeof __SERVER_URL__ !== "undefined" && __SERVER_URL__
    ? __SERVER_URL__.replace(/\/$/, "")
    : "http://127.0.0.1:8787";
