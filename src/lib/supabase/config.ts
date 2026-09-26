/**
 * Public Supabase configuration. Only NEXT_PUBLIC_* values are read here; they are inlined into the
 * client bundle at build time, so a secret/service-role key must never be placed in them.
 * When the values are missing or unsafe, `supabaseConfigured` is false and cloud features stay off.
 */

// Literal `process.env.NEXT_PUBLIC_*` reads so Next.js can inline them.
const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const rawPublishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
}

/**
 * True for keys that bypass RLS and must never reach a browser: new-style `sb_secret_…` keys and
 * legacy JWT keys whose `role` claim is `service_role`.
 */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload === "object" && payload !== null && (payload as { role?: unknown }).role === "service_role";
  } catch {
    return false;
  }
}

function configError(url: string, key: string): string | null {
  if (!url && !key) return "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set";
  if (!url) return "NEXT_PUBLIC_SUPABASE_URL is not set";
  if (!isHttpUrl(url)) return "NEXT_PUBLIC_SUPABASE_URL is not an http(s) URL";
  if (!key) return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set";
  if (looksLikeSecretKey(key)) {
    return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret/service-role key; use the publishable key";
  }
  return null;
}

/** Why cloud features are disabled, or null when configured. */
export const supabaseConfigError: string | null = configError(rawUrl, rawPublishableKey);
export const supabaseConfigured: boolean = supabaseConfigError === null;
export const supabaseUrl: string = supabaseConfigured ? rawUrl : "";
export const supabasePublishableKey: string = supabaseConfigured ? rawPublishableKey : "";

if (rawPublishableKey && looksLikeSecretKey(rawPublishableKey)) {
  console.error(`[supabase] ${supabaseConfigError}. Cloud features are disabled.`);
}

/**
 * Auth cookie options (merged over @supabase/ssr defaults: path "/", SameSite=Lax, 400 days). `Secure`
 * whenever the site is reached over HTTPS — always on Vercel — so the session never travels over plain
 * http; local `next dev` on http://localhost keeps working. Browser, server and proxy must agree.
 */
export function authCookieOptions(https: boolean): { secure: boolean } {
  return { secure: https };
}

/** HTTPS as seen by the user: the proxy header on Vercel, else the request URL. */
export function isHttpsRequest(forwardedProto: string | null, protocol: string): boolean {
  return (forwardedProto?.split(",")[0].trim() || protocol.replace(/:$/, "")) === "https";
}

export function requireSupabaseConfig(): { url: string; publishableKey: string } {
  if (!supabaseConfigured) throw new Error(`Supabase is not configured: ${supabaseConfigError}`);
  return { url: supabaseUrl, publishableKey: supabasePublishableKey };
}
