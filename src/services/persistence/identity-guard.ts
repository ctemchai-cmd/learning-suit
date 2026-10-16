import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client sends whatever session is in the shared auth cookie, which another tab may have switched to a
 * different account. Before a cloud call we re-validate that the current session still belongs to `ownerId`; otherwise the
 * call fails as an auth error and nothing is sent (plan05 §2 account isolation, ADR 0003 rule 6).
 *
 * `getClaims()` can be a network round trip (legacy HS256 projects call getUser) and serialises on the auth lock, so a
 * lesson that downloads ten images would pay for it eleven times. Two layers keep the guarantee but not the cost:
 *   - concurrent checks share one in-flight request;
 *   - for READS only, a positive answer is reused for `ttlMs`, and dropped at once when the auth state says the session
 *     signed out or now belongs to somebody else (onAuthStateChange also fires for changes made in other tabs).
 * Writes (`fresh`) never use the cached answer: they join an in-flight check but start a new one otherwise, so an upload or
 * save is never sent under another account because of a stale cache entry.
 * A negative answer is never cached.
 */
export interface IdentityGuard {
  /** For reads (list/load/inspect/download): may reuse a recent positive answer. */
  cached(): Promise<boolean>;
  /** For writes: always validated now (an already running check is shared). */
  fresh(): Promise<boolean>;
}

export const IDENTITY_CACHE_TTL_MS = 30_000;

type Auth = Pick<SupabaseClient["auth"], "getClaims" | "onAuthStateChange">;

interface Shared {
  generation: number;
  entries: Map<string, { validUntil: number; inflight: Promise<boolean> | null }>;
}

// One auth subscription per client, shared by every guard (a project service is created per page mount).
const sharedByClient = new WeakMap<object, Shared>();

type Signals = Pick<EventTarget, "addEventListener">;

function sharedFor(auth: Auth, key: object, signals: Signals | null): Shared {
  let shared = sharedByClient.get(key);
  if (shared) return shared;
  const created: Shared = { generation: 0, entries: new Map() };
  shared = created;
  sharedByClient.set(key, created);
  try {
    // Only flags are touched inside the callback (auth-js forbids calling other auth methods there).
    auth.onAuthStateChange((event, session) => {
      for (const [ownerId, entry] of created.entries) {
        if (event === "SIGNED_OUT" || !session?.user || session.user.id !== ownerId) {
          entry.validUntil = 0;
          created.generation++;
        }
      }
    });
  } catch { /* without the subscription the TTL alone bounds the staleness */ }
  // Cross-tab hints that the shared auth cookie/storage may have changed before onAuthStateChange reports it: drop every
  // cached answer so the next read asks again. (Another tab's sign-in writes localStorage, which fires "storage" here.)
  const invalidateAll = () => {
    for (const entry of created.entries.values()) entry.validUntil = 0;
    created.generation++;
  };
  signals?.addEventListener("storage", invalidateAll);
  signals?.addEventListener("focus", invalidateAll);
  signals?.addEventListener("visibilitychange", invalidateAll);
  return created;
}

export function createIdentityGuard(
  client: { auth: Auth },
  ownerId: string,
  options: { ttlMs?: number; now?: () => number; signals?: Signals | null } = {},
): IdentityGuard {
  const ttlMs = options.ttlMs ?? IDENTITY_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const shared = sharedFor(client.auth, client, options.signals === undefined ? (typeof window === "undefined" ? null : window) : options.signals);
  const entry = shared.entries.get(ownerId) ?? { validUntil: 0, inflight: null };
  shared.entries.set(ownerId, entry);

  const check = (): Promise<boolean> => {
    if (entry.inflight) return entry.inflight;
    const generation = shared.generation;
    const run = (async () => {
      try {
        const { data, error } = await client.auth.getClaims();
        const same = !error && data?.claims?.sub === ownerId;
        // An auth change that arrived while we were asking makes this answer unsafe to remember.
        entry.validUntil = same && generation === shared.generation ? now() + ttlMs : 0;
        return same;
      } catch {
        entry.validUntil = 0;
        return false;
      }
    })();
    entry.inflight = run;
    void run.then(() => { if (entry.inflight === run) entry.inflight = null; });
    return run;
  };

  return {
    cached: () => (now() < entry.validUntil ? Promise.resolve(true) : check()),
    fresh: check,
  };
}
