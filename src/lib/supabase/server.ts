import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { authCookieOptions, isHttpsRequest, requireSupabaseConfig } from "./config";

/**
 * Per-request server client (never share one across requests). Identity must be established with
 * `supabase.auth.getClaims()` (verified JWT), never with `getSession()` alone.
 *
 * Server Components cannot write cookies, so `setAll` swallows that error; src/proxy.ts refreshes
 * the session cookie before rendering. Server Actions and Route Handlers can write cookies normally.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const { url, publishableKey } = requireSupabaseConfig();
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(isHttpsRequest(headerStore.get("x-forwarded-proto"), "http:")),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy already refreshed the session for this request.
        }
      },
    },
  });
}
