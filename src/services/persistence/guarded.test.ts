import { describe, expect, it, vi } from "vitest";
import type { CloudAssetStore, ProjectRepository } from "./repository";
import type { IdentityGuard } from "./identity-guard";
import { guardedAssets, guardedRepository } from "./guarded";

function fixture(allowed = true) {
  const guard: IdentityGuard = { cached: vi.fn(async () => allowed), fresh: vi.fn(async () => allowed) };
  const inner = {
    list: vi.fn(async () => []), load: vi.fn(async () => null), inspectLifecycle: vi.fn(async () => null),
    reserve: vi.fn(), save: vi.fn(), markDeleted: vi.fn(), purge: vi.fn(),
  } as unknown as ProjectRepository;
  const store = { listStates: vi.fn(async () => ({})), register: vi.fn(), upload: vi.fn(), markReady: vi.fn(), download: vi.fn(), removeProjectObjects: vi.fn() } as unknown as CloudAssetStore;
  return { guard, repo: guardedRepository(inner, guard), assets: guardedAssets(store, guard), inner, store };
}

describe("guarded repository / assets", () => {
  it("the project list always re-validates the session (never served from the identity cache)", async () => {
    const f = fixture();
    await f.repo.list();
    expect(f.guard.fresh).toHaveBeenCalledTimes(1);
    expect(f.guard.cached).not.toHaveBeenCalled();
  });

  it("document/asset reads may use the cache; every write re-validates", async () => {
    const f = fixture();
    await f.repo.load("p"); await f.repo.inspectLifecycle("p"); await f.assets.listStates("p"); await f.assets.download({} as never);
    expect(f.guard.cached).toHaveBeenCalledTimes(4);
    expect(f.guard.fresh).not.toHaveBeenCalled();
    await f.repo.save({} as never); await f.repo.reserve({} as never); await f.repo.markDeleted({} as never);
    await f.assets.register("p", {} as never); await f.assets.upload({} as never, new Blob()); await f.assets.markReady("p", "a");
    expect(f.guard.fresh).toHaveBeenCalledTimes(6);
  });

  it("a rejected identity sends nothing to the inner repository", async () => {
    const f = fixture(false);
    await expect(f.repo.list()).rejects.toMatchObject({ code: "auth" });
    await expect(f.repo.load("p")).rejects.toMatchObject({ code: "auth" });
    expect(await f.repo.save({} as never)).toEqual({ status: "error", code: "auth", retryable: false });
    expect(f.inner.list).not.toHaveBeenCalled(); expect(f.inner.load).not.toHaveBeenCalled(); expect(f.inner.save).not.toHaveBeenCalled();
  });
});
