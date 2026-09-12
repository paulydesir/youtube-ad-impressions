import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");
const html = readFileSync(new URL("../public/consent.html", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../public/consent.js", import.meta.url), "utf8");
const user = { id: "9c3f24dd-50ab-4f8c-a389-a860dd3053ae", email: "owner@example.com" };
const accessToken = ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "signature"].join(".");
let dom: ReturnType<typeof JSDOM>;
afterEach(() => dom?.window.close());

function page(options: { authorizationId?: string; failLogin?: boolean } = {}) {
  const calls: Array<{ path: string; body: Record<string, unknown>; authorization: string | null }> = [];
  dom = new JSDOM(html, { runScripts: "outside-only", url: `http://127.0.0.1:8787/oauth/consent${options.authorizationId === "" ? "" : "?authorization_id=request-123"}`, virtualConsole: new VirtualConsole() });
  const window = dom.window;
  Object.defineProperty(window, "crypto", { value: webcrypto });
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.Headers = Headers;
  window.Request = Request;
  window.Response = Response;
  window.fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), window.location.href);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, body, authorization: headers.get("authorization") });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/oauth/config") return json({ supabaseUrl: "http://127.0.0.1:54321", publishableKey: "public-key" });
    if (url.pathname === "/auth/v1/token") {
      if (options.failLogin) return json({ msg: "Invalid login credentials", error_code: "invalid_credentials" }, 400);
      return json({ access_token: accessToken, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname === "/auth/v1/oauth/authorizations/request-123") {
      return json({ authorization_id: "request-123", client: { id: "client-123", name: "<img src=x onerror=alert(1)>" }, user, scope: "email", redirect_uri: "https://client.example/callback" });
    }
    if (url.pathname === "/auth/v1/oauth/authorizations/request-123/consent") {
      return json({ redirect_url: "https://client.example/callback?state=test" });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  };
  window.eval(bundle);
  return { window, calls, element: (id: string) => window.document.getElementById(id) };
}

it("requires an authorization request and does not start sign-in without one", async () => {
  const { element, calls } = page({ authorizationId: "" });
  await expect.poll(() => element("status").textContent).toContain("No valid authorization request");
  expect(calls).toEqual([]);
  expect(element("login").hidden).toBe(true);
});

for (const decision of ["approve", "deny"]) {
  it(`signs in, safely renders client details, and submits explicit ${decision} with the user's session`, async () => {
    const { window, element, calls } = page();
    await expect.poll(() => element("login").hidden).toBe(false);
    element("email").value = user.email;
    element("password").value = "password";
    element("login-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await expect.poll(() => element("consent").hidden).toBe(false);
    expect(element("password").value).toBe("");
    expect(element("account").textContent).toBe(user.email);
    expect(element("client").textContent).toContain("<img");
    expect(element("client").querySelector("img")).toBeNull();
    expect(calls.some(call => call.path.endsWith("/consent"))).toBe(false);
    element(decision).click();
    await expect.poll(() => calls.find(call => call.path.endsWith("/consent"))).toEqual({
      path: "/auth/v1/oauth/authorizations/request-123/consent", body: { action: decision }, authorization: `Bearer ${accessToken}`,
    });
  });
}

it("keeps consent hidden after a failed login", async () => {
  const { window, element } = page({ failLogin: true });
  await expect.poll(() => element("login").hidden).toBe(false);
  element("email").value = user.email;
  element("password").value = "wrong";
  element("login-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await expect.poll(() => element("status").textContent).toContain("Invalid login credentials");
  expect(element("consent").hidden).toBe(true);
  expect(element("password").value).toBe("");
});
