import { createChromeAuthStorage } from "./chrome-storage.ts";
import { createClient } from "@supabase/supabase-js";
declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

export const supabase = createClient(__SUPABASE_URL__, __SUPABASE_PUBLISHABLE_KEY__, {
  auth: {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storage: createChromeAuthStorage(chrome.storage.local),
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}
