import type { NextConfig } from "next";
import { looksLikeSecretKey } from "./src/lib/supabase/config";

// NEXT_PUBLIC_* values are inlined into the browser bundle at build time: refuse to build (and so to
// publish) a secret/service-role key there. The runtime check alone would still ship it to browsers.
const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
if (publishableKey && looksLikeSecretKey(publishableKey)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret/service-role key. Use the publishable key; never put a secret key in NEXT_PUBLIC_*.");
}

/** Baseline headers for every response (Vercel adds HSTS on its domains itself). */
const SECURITY_HEADERS = [
  // Nobody may frame the editor (clickjacking); nothing in the app is meant to be embedded.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
