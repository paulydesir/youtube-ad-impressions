import { useState, type FormEvent } from "react";
import { useAuth } from "../src/auth/AuthProvider.tsx";
import { supabase } from "../src/auth/supabase.ts";
import { createAuthApiClient } from "../src/api/auth-api-client.ts";
const api = createAuthApiClient(supabase);
export function AuthPanel() {
  const auth = useAuth();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<string>) {
    setBusy(true); setError(""); setMessage("");
    try { setMessage(await action()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const email = String(data.get("email"));
      const password = String(data.get("password"));
      if (signup) {
        const result = await auth.signUp(email, password, String(data.get("name") ?? "").trim());
        form.reset();
        return result.session ? "Account created." : "Check your email to confirm your account.";
      }
      await auth.signIn(email, password); form.reset(); return "Signed in.";
    });
  }
  return <section className="auth-panel" aria-label="Account">
    <h2>Account</h2>
    {auth.isLoading ? <p role="status">Loading session…</p> : auth.user ? <>
      <p>Signed in as {auth.user.email}</p>
      <button disabled={busy} onClick={() => void run(async () => { await auth.signOut(); return "Signed out."; })}>Log out</button>
    </> : <>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>{signup ? "Create account" : "Log in"}</legend>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={6} required /></label>
          {signup && <label>Name (optional)<input name="name" autoComplete="name" /></label>}
          <button type="submit">{busy ? "Please wait…" : signup ? "Sign up" : "Log in"}</button>
        </fieldset>
      </form>
      <button disabled={busy} onClick={() => { setSignup(!signup); setMessage(""); setError(""); }}>{signup ? "Already have an account? Log in" : "Create an account"}</button>
    </>}
    <button disabled={busy || auth.isLoading} onClick={() => void run(async () => {
      const me = await api.getMe(); return `Verified by server: ${me.email} (${me.id})`;
    })}>Check /me</button>
    {message && <p role="status">{message}</p>}
    {(error || auth.error) && <p role="alert">{error || auth.error}</p>}
  </section>;
}
