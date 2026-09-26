import { supabaseConfigured } from "@/lib/supabase/config";

export const serverCloudConfigured = supabaseConfigured;

/** Validated identity from the Supabase auth cookie (getClaims verifies the JWT); never trusts getSession alone. */
export async function getServerIdentity(): Promise<{ ownerId: string; email: string | null } | null> {
  if (!serverCloudConfigured) return null;
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { ownerId: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null };
}
