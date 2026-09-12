import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVER_BASE_URL } from "../config.ts";

export function createAuthApiClient(client: SupabaseClient, baseUrl = SERVER_BASE_URL, fetcher: typeof fetch = fetch) {
  return {
    async getMe(): Promise<{ id: string; email: string }> {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const headers: Record<string, string> = {};
      if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
      const response = await fetcher(`${baseUrl}/me`, { headers });
      if (!response.ok) throw new Error(`/me returned ${response.status}`);
      return response.json();
    },
  };
}
