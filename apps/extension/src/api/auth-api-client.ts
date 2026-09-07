import type { SupabaseClient } from "@supabase/supabase-js";

export function createAuthApiClient(client: SupabaseClient, baseUrl = "http://127.0.0.1:8787", fetcher: typeof fetch = fetch) {
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
