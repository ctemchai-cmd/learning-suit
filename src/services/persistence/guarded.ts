import type { CloudAssetStore, ProjectRepository } from "./repository";
import { CloudRepositoryError } from "./supabase-repository";
import type { IdentityGuard } from "./identity-guard";

const AUTH_ERROR = () => new CloudRepositoryError("Session does not belong to this owner", { code: "auth", retryable: false }, { reason: "owner_mismatch" });

/** Reads may reuse a recent positive identity check; every write re-validates (see identity-guard.ts). */
export function guardedRepository(inner: ProjectRepository, guard: IdentityGuard): ProjectRepository {
  const denied = { status: "error", code: "auth", retryable: false } as const;
  return {
    // Once per page: the list is what the teacher sees as "my projects", so it is never served from the cache.
    async list() { if (!await guard.fresh()) throw AUTH_ERROR(); return inner.list(); },
    async load(id) { if (!await guard.cached()) throw AUTH_ERROR(); return inner.load(id); },
    async inspectLifecycle(id, options) { if (!await guard.cached()) throw AUTH_ERROR(); return inner.inspectLifecycle(id, options); },
    async reserve(request) { if (!await guard.fresh()) return denied; return inner.reserve(request); },
    async save(request) { if (!await guard.fresh()) return denied; return inner.save(request); },
    async markDeleted(request) { if (!await guard.fresh()) return denied; return inner.markDeleted(request); },
    async purge(id) { if (!await guard.fresh()) throw AUTH_ERROR(); return inner.purge(id); },
  };
}

export function guardedAssets(inner: CloudAssetStore, guard: IdentityGuard): CloudAssetStore {
  const denied = { status: "error", code: "auth", retryable: false } as const;
  return {
    async listStates(projectId) { if (!await guard.cached()) throw AUTH_ERROR(); return inner.listStates(projectId); },
    async register(projectId, asset) { return await guard.fresh() ? inner.register(projectId, asset) : denied; },
    async upload(asset, bytes) { return await guard.fresh() ? inner.upload(asset, bytes) : denied; },
    async markReady(projectId, assetId) { return await guard.fresh() ? inner.markReady(projectId, assetId) : denied; },
    async download(asset) { if (!await guard.cached()) throw AUTH_ERROR(); return inner.download(asset); },
    async removeProjectObjects(owner, projectId) { if (!await guard.fresh()) throw AUTH_ERROR(); return inner.removeProjectObjects(owner, projectId); },
  };
}

