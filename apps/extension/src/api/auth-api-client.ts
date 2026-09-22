import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVER_BASE_URL } from "../config.ts";

export interface CurrentUser {
  id: string;
  email: string;
}

export function createAuthApiClient(
  client: SupabaseClient,
  baseUrl = SERVER_BASE_URL,
  fetcher: typeof fetch = fetch,
): { getMe(): Promise<CurrentUser> } {
  async function getMe(): Promise<CurrentUser> {
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }
    const headers: Record<string, string> = {};
    if (data.session) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const response = await fetcher(`${baseUrl}/me`, { headers });
    if (!response.ok) {
      throw new Error(`/me returned ${response.status}`);
    }
    return (await response.json()) as CurrentUser;
  }

  return { getMe };
}
