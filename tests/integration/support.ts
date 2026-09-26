import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storagePathFor } from "../../src/domain/document/assets";
import type { AssetReference, ProjectContent } from "../../src/domain/document/model";
import { sha256Hex } from "../../src/lib/sha256";
import { SupabaseAssetStore } from "../../src/services/persistence/supabase-assets";
import { SupabaseProjectRepository } from "../../src/services/persistence/supabase-repository";

// Fixture helpers for tests/integration (real local Supabase: PostgREST + GoTrue + Storage).
// The service-role key is used ONLY to create/delete fixture users; every assertion runs through
// user A, user B or the anonymous publishable-key client, exactly like the browser would.

export const env = {
  url: process.env.SUPABASE_TEST_URL ?? "",
  publishableKey: process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "",
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "",
};
export const hasIntegrationEnv = Boolean(env.url && env.publishableKey && env.serviceRoleKey);

export const BUCKET = "project-assets";

const clientOptions = (fetchImpl?: typeof fetch) => ({
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
});

export function anonClient(): SupabaseClient {
  return createClient(env.url, env.publishableKey, clientOptions());
}

export interface FixtureUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

/** A second, independent signed-in session for the same account ("another device"). */
export async function signIn(user: Pick<FixtureUser, "email" | "password">, fetchImpl?: typeof fetch): Promise<SupabaseClient> {
  const client = createClient(env.url, env.publishableKey, clientOptions(fetchImpl));
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in failed for ${user.email}: ${error.message}`);
  return client;
}

function adminClient(): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, clientOptions());
}

export async function createFixtureUser(label: string): Promise<FixtureUser> {
  const email = `ls-int-${label}-${crypto.randomUUID()}@example.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  return { id: data.user.id, email, password, client: await signIn({ email, password }) };
}

/** Best effort: tombstone, empty storage, purge every project of the user, then delete the user. */
export async function destroyFixtureUser(user: FixtureUser | undefined): Promise<void> {
  if (!user) return;
  try {
    const repository = new SupabaseProjectRepository(user.client);
    const assets = new SupabaseAssetStore(user.client, user.id);
    const { data } = await user.client.from("projects").select("id, revision, deleted_at");
    for (const row of (data ?? []) as { id: string; revision: number; deleted_at: string | null }[]) {
      if (!row.deleted_at) {
        await repository.markDeleted({ projectId: row.id, expectedRevision: row.revision, mutationId: crypto.randomUUID() });
      }
      await assets.removeProjectObjects(user.id, row.id);
      await repository.purge(row.id);
    }
    await adminClient().auth.admin.deleteUser(user.id);
  } catch (error) {
    console.warn(`fixture cleanup for ${user.email} incomplete:`, error);
  }
}

// Two distinct, valid 1x1 PNG files.
export const PNG_RED = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
), (c) => c.charCodeAt(0));
export const PNG_BLACK = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
), (c) => c.charCodeAt(0));

export function pngBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
}

export async function assetFor(ownerId: string, projectId: string, bytes: Uint8Array): Promise<AssetReference> {
  const id = crypto.randomUUID();
  return {
    id,
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    storagePath: storagePathFor(ownerId, projectId, id, "image/png"),
  };
}

/** Valid v1 content with one image node per asset. */
export function contentWith(slideId: string, assets: AssetReference[] = [], title = "Integration lesson"): ProjectContent {
  return {
    title,
    document: {
      schemaVersion: 1,
      slides: [{
        id: slideId,
        name: "สไลด์ 1",
        background: "#FFFFFF",
        nodes: assets.map((asset, index) => ({
          id: crypto.randomUUID(), type: "image" as const, x: index * 10, y: 0, rotation: 0, opacity: 1,
          locked: false, assetId: asset.id, width: 100, height: 100,
        })),
      }],
      assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
    },
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
}

/**
 * Failure injection: performs the real request (so the server commits) and then throws a network
 * TypeError instead of returning the response — the "server committed, response lost" case.
 */
export function loseResponseOnce(matches: (url: string, method: string) => boolean): { fetch: typeof fetch; fired: () => boolean } {
  let fired = false;
  const wrapped: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!fired && matches(requestUrl(input), requestMethod(input, init))) {
      fired = true;
      await response.arrayBuffer().catch(() => undefined);
      throw new TypeError("fetch failed (injected: response lost after the server processed the request)");
    }
    return response;
  };
  return { fetch: wrapped, fired: () => fired };
}

export async function blobSha256(blob: Blob): Promise<string> {
  return sha256Hex(blob);
}
