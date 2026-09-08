import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

Object.assign(globalThis, {
  __SUPABASE_URL__: "http://127.0.0.1:54321",
  __SUPABASE_PUBLISHABLE_KEY__: "test-key",
  chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } },
});

const { createGoogleOAuthSignIn } = await import("../src/auth/google-oauth.ts");
const extensionRedirect = "https://extension-id.chromiumapp.org/";
const authorizeUrl = "http://127.0.0.1:54321/auth/v1/authorize?provider=google";

function clientWith(auth: Record<string, unknown>): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

function identityWith(launchWebAuthFlow: (details: chrome.identity.WebAuthFlowDetails) => Promise<string | undefined>) {
  return {
    getRedirectURL: () => extensionRedirect,
    launchWebAuthFlow,
  } as Pick<typeof chrome.identity, "getRedirectURL" | "launchWebAuthFlow">;
}

test("propagates Supabase OAuth URL generation errors", async () => {
  const expected = new Error("Google provider is unavailable");
  const client = clientWith({
    signInWithOAuth: async () => ({ data: { provider: "google", url: null }, error: expected }),
  });
  const identity = identityWith(async () => assert.fail("must not launch OAuth"));

  await assert.rejects(createGoogleOAuthSignIn(client, identity), error => error === expected);
});

test("launches the generated OAuth URL and exchanges the callback code", async () => {
  let oauthOptions: unknown;
  let launchOptions: chrome.identity.WebAuthFlowDetails | undefined;
  let exchangedCode: string | undefined;
  const client = clientWith({
    signInWithOAuth: async (options: unknown) => {
      oauthOptions = options;
      return { data: { provider: "google", url: authorizeUrl }, error: null };
    },
    exchangeCodeForSession: async (code: string) => {
      exchangedCode = code;
      return { data: { session: {} }, error: null };
    },
  });
  const identity = identityWith(async details => {
    launchOptions = details;
    return `${extensionRedirect}?code=abc`;
  });

  await createGoogleOAuthSignIn(client, identity)();

  assert.deepEqual(oauthOptions, {
    provider: "google",
    options: { redirectTo: extensionRedirect, skipBrowserRedirect: true },
  });
  assert.deepEqual(launchOptions, { url: authorizeUrl, interactive: true });
  assert.equal(exchangedCode, "abc");
});

test("rejects a callback that has no authorization code", async () => {
  let exchangeCalled = false;
  const client = clientWith({
    signInWithOAuth: async () => ({ data: { provider: "google", url: authorizeUrl }, error: null }),
    exchangeCodeForSession: async () => { exchangeCalled = true; },
  });
  const identity = identityWith(async () => extensionRedirect);

  await assert.rejects(createGoogleOAuthSignIn(client, identity), /did not return an authorization code/);
  assert.equal(exchangeCalled, false);
});

test("does not exchange a session when OAuth is cancelled", async () => {
  let exchangeCalled = false;
  const client = clientWith({
    signInWithOAuth: async () => ({ data: { provider: "google", url: authorizeUrl }, error: null }),
    exchangeCodeForSession: async () => { exchangeCalled = true; },
  });
  const identity = identityWith(async () => undefined);

  await assert.rejects(createGoogleOAuthSignIn(client, identity), /Google sign-in was cancelled/);
  assert.equal(exchangeCalled, false);
});

test("surfaces OAuth callback and session exchange failures", async t => {
  const auth = {
    signInWithOAuth: async () => ({ data: { provider: "google", url: authorizeUrl }, error: null }),
    exchangeCodeForSession: async () => ({ data: { session: null }, error: new Error("PKCE verifier rejected") }),
  };

  await t.test("callback error", async () => {
    const identity = identityWith(async () => `${extensionRedirect}?error=access_denied&error_description=Account+access+was+denied`);
    await assert.rejects(createGoogleOAuthSignIn(clientWith(auth), identity), /Account access was denied/);
  });
  await t.test("exchange error", async () => {
    const identity = identityWith(async () => `${extensionRedirect}?code=abc`);
    await assert.rejects(createGoogleOAuthSignIn(clientWith(auth), identity), /Unable to complete sign-in\. PKCE verifier rejected/);
  });
});
