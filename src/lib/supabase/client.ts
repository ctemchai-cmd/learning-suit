import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authCookieOptions, requireSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

/**
 * Memoized browser client. The session lives in cookies (via @supabase/ssr) so server components,
 * server actions and src/proxy.ts see the same identity. Uses only the publishable key; every data
 * access is authorised by RLS/grants in the database, not by this client.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() is browser-only; use createSupabaseServerClient() on the server");
  }
  if (!browserClient) {
    const { url, publishableKey } = requireSupabaseConfig();
    browserClient = createBrowserClient(url, publishableKey, { cookieOptions: authCookieOptions(window.location.protocol === "https:") });
  }
  return browserClient;
}
