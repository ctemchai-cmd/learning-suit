"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createCloudProjectService } from "@/services/projects/cloud-project-service";
import type { Runtime } from "./runtime";

/** Signed-in owner from validated claims; local data stays keyed by this owner ID. */
export async function resolveCloudRuntime(): Promise<Runtime> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return { status: "signed-out" };
  const ownerId = String(claims.sub);
  return {
    status: "ready",
    service: createCloudProjectService(ownerId, supabase),
    email: typeof claims.email === "string" ? claims.email : null,
    // Unsynced drafts stay in IndexedDB under this owner; another account never sees or uploads them.
    // `local`: only this browser signs out; the teacher's other devices stay signed in.
    signOut: async () => { await supabase.auth.signOut({ scope: "local" }); },
    onAccountChange: (listener) => {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") listener(null);
        else if (session?.user && session.user.id !== ownerId) listener(session.user.id);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
