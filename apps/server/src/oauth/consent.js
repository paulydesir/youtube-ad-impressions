import { createClient } from "@supabase/supabase-js";

const element = id => document.getElementById(id);
const status = message => { element("status").textContent = message; };
const pendingKey = "ad-impressions-oauth-authorization";

async function main() {
  const params = new URLSearchParams(location.search);
  const authorizationId = params.get("authorization_id") || sessionStorage.getItem(pendingKey);
  if (!authorizationId || !/^[a-zA-Z0-9_-]{1,256}$/.test(authorizationId)) {
    throw new Error("No valid authorization request. Start the connection again from your MCP client.");
  }
  sessionStorage.setItem(pendingKey, authorizationId);
  const response = await fetch("/oauth/config");
  if (!response.ok) throw new Error("Sign-in is unavailable. Please try again later.");
  const config = await response.json();
  const supabase = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: "pkce", storage: sessionStorage, storageKey: "ad-impressions-consent", autoRefreshToken: true },
  });

  function redirect(data) {
    // Only Supabase's validated consent responses supply this URL; never use
    // redirect_uri/return_to from browser query parameters.
    const url = new URL(data.redirect_url);
    if (!(url.protocol === "https:" || (url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
      throw new Error("Unsupported client return address.");
    }
    sessionStorage.removeItem(pendingKey);
    location.assign(url.href);
  }

  async function showConsent() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    history.replaceState(null, "", `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`);
    element("login").hidden = !!session;
    element("consent").hidden = true;
    if (!session) { status("Sign in to review this connection."); return; }
    const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (detailsError) throw detailsError;
    if ("redirect_url" in data) { redirect(data); return; }
    element("account").textContent = data.user.email;
    element("client").textContent = data.client.name || data.client.id;
    element("redirect").textContent = data.redirect_uri;
    element("scopes").textContent = data.scope || "No additional account information requested";
    element("consent").hidden = false;
    status("Review the connection before continuing.");
  }

  async function action(work) {
    const buttons = [...document.querySelectorAll("button")];
    buttons.forEach(button => { button.disabled = true; });
    try { await work(); } catch (error) { status(error.message || "Unable to complete authorization."); }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  element("login-form").addEventListener("submit", event => {
    event.preventDefault();
    void action(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: element("email").value, password: element("password").value });
      element("password").value = "";
      if (error) throw error;
      await showConsent();
    });
  });
  element("google").addEventListener("click", () => void action(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/oauth/consent` } });
    if (error) throw error;
  }));
  for (const decision of ["approve", "deny"]) {
    element(decision).addEventListener("click", () => void action(async () => {
      const method = decision === "approve" ? "approveAuthorization" : "denyAuthorization";
      const { data, error } = await supabase.auth.oauth[method](authorizationId, { skipBrowserRedirect: true });
      if (error) throw error;
      redirect(data);
    }));
  }
  element("switch-account").addEventListener("click", () => void action(async () => {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    await showConsent();
  }));
  await showConsent();
}

void main().catch(error => status(error.message || "Unable to load authorization request."));
