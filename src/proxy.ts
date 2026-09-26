import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, isHttpsRequest, supabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase auth session cookie before routes render (@supabase/ssr pattern, Next 16
 * `proxy` convention). This is NOT an authorization boundary: protected pages and server actions
 * verify identity with `getClaims()`, and RLS/grants protect the data itself.
 * Without Supabase configuration this is a pure pass-through.
 */
export async function proxy(request: NextRequest) {
  if (!supabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: authCookieOptions(isHttpsRequest(request.headers.get("x-forwarded-proto"), request.nextUrl.protocol)),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that rotate auth cookies must never be cached and replayed to another user.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Nothing may run between client creation and getClaims(): it performs the token refresh.
  try {
    await supabase.auth.getClaims();
  } catch {
    // Auth server unreachable: continue unrefreshed; pages re-verify and RLS still applies.
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp|woff|woff2|ttf|otf|eot)$).*)",
  ],
};
