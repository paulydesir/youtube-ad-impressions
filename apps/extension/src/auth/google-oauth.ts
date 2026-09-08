import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";

type OAuthClient = Pick<SupabaseClient, "auth">;
type ChromeIdentity = Pick<typeof chrome.identity, "getRedirectURL" | "launchWebAuthFlow">;

function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|closed|did not approve|denied/i.test(message);
}

export function createGoogleOAuthSignIn(
  client: OAuthClient,
  identity: ChromeIdentity = chrome.identity,
): () => Promise<void> {
  return async () => {
    const redirectTo = identity.getRedirectURL();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");

    let callbackUrl: string | undefined;
    try {
      callbackUrl = await identity.launchWebAuthFlow({ url: data.url, interactive: true });
    } catch (error) {
      if (isCancellation(error)) throw new Error("Google sign-in was cancelled.");
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to start Google sign-in. ${detail}`);
    }
    if (!callbackUrl) throw new Error("Google sign-in was cancelled.");

    const callback = new URL(callbackUrl);
    const oauthError = callback.searchParams.get("error");
    const oauthErrorDescription = callback.searchParams.get("error_description");
    if (oauthError) {
      const detail = oauthErrorDescription || oauthError.replaceAll("_", " ");
      throw new Error(`Google sign-in failed: ${detail}`);
    }

    const code = callback.searchParams.get("code");
    if (!code) throw new Error("Google sign-in did not return an authorization code.");

    const { data: sessionData, error: exchangeError } = await client.auth.exchangeCodeForSession(code);
    if (exchangeError) throw new Error(`Unable to complete sign-in. ${exchangeError.message}`);
    if (!sessionData.session) throw new Error("Unable to complete sign-in. Supabase did not return a session.");
  };
}

export async function signInWithGoogle(): Promise<void> {
  await createGoogleOAuthSignIn(supabase)();
}
