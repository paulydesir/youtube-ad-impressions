import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createGoogleOAuthSignIn } from "./google-oauth.ts";
import { supabase } from "./supabase.ts";

function useAuthState(client: SupabaseClient) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const signInWithGoogle = useMemo(() => createGoogleOAuthSignIn(client), [client]);
  useEffect(() => {
    let active = true;
    let changed = false;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      changed = true;
      if (active) { setSession(next); setLoading(false); }
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (!changed) setSession(data.session);
      if (error) setError(error.message);
      setLoading(false);
    }).catch((error: Error) => { if (active) { setError(error.message); setLoading(false); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client]);
  return {
    user: session?.user ?? null, session, isLoading, error, signInWithGoogle,
    async signUp(email: string, password: string, name?: string) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { name: name || null } } });
      if (error) throw error;
      return data;
    },
    async signIn(email: string, password: string) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    },
  };
}
const AuthContext = createContext<ReturnType<typeof useAuthState> | null>(null);
export function AuthProvider({ children, client = supabase }: { children: ReactNode; client?: SupabaseClient }) {
  return <AuthContext.Provider value={useAuthState(client)}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth requires AuthProvider");
  return auth;
}
