import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectContent } from "../../domain/document/model";
import type { DeletionJob } from "../../domain/document/session";
import {
  createDeletionJob, deletionGuardFor, isDeletionPending, runDeletion, type DeletionDeps, type DeletionJobStore,
} from "./deletion";
import type { CloudProjectLifecycle, DeleteRequest, ReservationResult, SaveRequest, SaveResult } from "./repository";
import { createSaveCoordinator, type SaveJobStore } from "./save-coordinator";

const OWNER = "owner-1";
const PROJECT = "project-1";

type Interceptor = (real: () => Promise<unknown>) => Promise<unknown>;

interface Row { revision: number; isReady: boolean; deletedAt: string | null; lastMutationId: string | null }

const content = (title: string): ProjectContent => ({
  title,
  document: { schemaVersion: 1, slides: [{ id: "slide-1", name: "สไลด์ 1", background: "#FFFFFF", nodes: [] }], assets: {} },
});

/** In-memory server with mark_project_deleted / save_project / reserve_project semantics (plan05 §5, §7). */
class FakeCloud {
  rows = new Map<string, Row>();
  objects = new Set<string>([`${OWNER}/${PROJECT}/a1.png`, `${OWNER}/${PROJECT}/a2.png`, `${OWNER}/other/b.png`]);
  private once = new Map<string, Interceptor[]>();

  constructor(private events: string[]) {}

  on(method: string, interceptor: Interceptor): void {
    this.once.set(method, [...(this.once.get(method) ?? []), interceptor]);
  }
  private run<R>(method: string, real: () => Promise<R>): Promise<R> {
    this.events.push(method);
    const interceptor = this.once.get(method)?.shift();
    return (interceptor ? interceptor(real) : real()) as Promise<R>;
  }

  repository = {
    inspectLifecycle: (id: string) => this.run("inspectLifecycle", async (): Promise<CloudProjectLifecycle | null> => {
      const row = this.rows.get(id);
      return row ? { ...row } : null;
    }),
    markDeleted: (request: DeleteRequest) => this.run("markDeleted", async (): Promise<SaveResult> => {
      const row = this.rows.get(request.projectId);
      if (!row) return { status: "unavailable" };
      if (row.deletedAt) {
        return row.lastMutationId === request.mutationId
          ? { status: "saved", revision: row.revision, mutationId: request.mutationId, updatedAt: row.deletedAt }
          : { status: "unavailable" };
      }
      if (row.revision !== request.expectedRevision) return { status: "conflict", currentRevision: row.revision };
      Object.assign(row, { revision: row.revision + 1, deletedAt: "2026-09-25T00:00:00.000Z", lastMutationId: request.mutationId });
      return { status: "saved", revision: row.revision, mutationId: request.mutationId, updatedAt: row.deletedAt! };
    }),
    purge: (id: string) => this.run("purge", async () => {
      this.rows.delete(id);
    }),
    save: (request: SaveRequest) => this.run("save", async (): Promise<SaveResult> => {
      const row = this.rows.get(request.projectId);
      if (!row || row.deletedAt) return { status: "unavailable" };
      if (row.revision !== request.expectedRevision) return { status: "conflict", currentRevision: row.revision };
      Object.assign(row, { revision: row.revision + 1, lastMutationId: request.mutationId, isReady: true });
      return { status: "saved", revision: row.revision, mutationId: request.mutationId, updatedAt: "2026-09-25T00:00:00.000Z" };
    }),
    reserve: () => this.run("reserve", async (): Promise<ReservationResult> => ({ status: "unavailable" })),
  };

  assets = {
    removeProjectObjects: (ownerId: string, projectId: string) => this.run("removeProjectObjects", async () => {
      for (const path of [...this.objects]) if (path.startsWith(`${ownerId}/${projectId}/`)) this.objects.delete(path);
    }),
    listStates: async () => ({}),
    register: async () => ({ status: "ok" as const }),
    upload: async () => ({ status: "ok" as const }),
    markReady: async () => ({ status: "ok" as const }),
  };
}

class FakeDeletionStore implements DeletionJobStore {
  jobs = new Map<string, DeletionJob>();
  phases: string[] = [];
  failPut = 0;
  constructor(private events: string[]) {}
  async getDeletionJob(ownerId: string, projectId: string) {
    return this.jobs.get(`${ownerId}/${projectId}`) ?? null;
  }
  async putDeletionJob(job: DeletionJob) {
    this.events.push(`put:${job.phase}`);
    if (this.failPut > 0) {
      this.failPut -= 1;
      throw new Error("IDB write failed");
    }
    this.phases.push(job.phase);
    this.jobs.set(`${job.ownerId}/${job.projectId}`, { ...job });
  }
  async deleteDeletionJob(ownerId: string, projectId: string) {
    this.events.push("deleteJob");
    this.jobs.delete(`${ownerId}/${projectId}`);
  }
}

function setup(row: Row | null = { revision: 5, isReady: true, deletedAt: null, lastMutationId: "m" }, expectedRevision: number | null = 5) {
  const events: string[] = [];
  const cloud = new FakeCloud(events);
  if (row) cloud.rows.set(PROJECT, { ...row });
  const store = new FakeDeletionStore(events);
  const local = { cleared: false };
  const deps: DeletionDeps = {
    repository: cloud.repository,
    assets: cloud.assets,
    jobs: store,
    waitForInFlightSave: async () => {
      events.push("waitForInFlightSave");
    },
    clearLocal: async () => {
      events.push("clearLocal");
      local.cleared = true;
    },
  };
  let id = 0;
  const job = createDeletionJob(
    { ownerId: OWNER, projectId: PROJECT, expectedRevision, title: "บทเรียน" },
    { newMutationId: () => `del-${++id}`, now: () => Date.parse("2026-09-25T00:00:00.000Z") },
  );
  return { events, cloud, store, local, deps, job };
}

const networkDown = () => Promise.reject(new TypeError("fetch failed"));

describe("deletion helpers", () => {
  it("creates a requested job and treats any persisted job as pending", async () => {
    const { job, store } = setup();
    expect(job).toEqual({
      ownerId: OWNER, projectId: PROJECT, mutationId: "del-1", expectedRevision: 5, phase: "requested", title: "บทเรียน",
      createdAt: "2026-09-25T00:00:00.000Z",
    });
    expect(isDeletionPending(null)).toBe(false);
    expect(isDeletionPending(undefined)).toBe(false);
    expect(isDeletionPending(job)).toBe(true);
    expect(isDeletionPending({ ...job, phase: "done" })).toBe(true);
    const guard = deletionGuardFor(store, OWNER, PROJECT);
    await expect(guard()).resolves.toBe(false);
    await store.putDeletionJob(job);
    await expect(guard()).resolves.toBe(true);
  });
});

describe("runDeletion (PST-12)", () => {
  it("persists the job, waits for the in-flight save, tombstones, cleans storage, purges and clears local", async () => {
    const h = setup();
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events).toEqual([
      "put:requested", "waitForInFlightSave", "inspectLifecycle", "markDeleted", "put:tombstoned",
      "removeProjectObjects", "put:storage-cleaned", "purge", "put:done", "waitForInFlightSave", "clearLocal", "deleteJob",
    ]);
    expect(h.cloud.rows.has(PROJECT)).toBe(false);
    expect([...h.cloud.objects]).toEqual([`${OWNER}/other/b.png`]);
    expect(h.local.cleared).toBe(true);
    expect(h.store.jobs.size).toBe(0);
  });

  it("no cloud row: clears local only", async () => {
    const h = setup(null, null);
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events).toEqual(["put:requested", "waitForInFlightSave", "inspectLifecycle", "put:done", "waitForInFlightSave", "clearLocal", "deleteJob"]);
  });

  it("a lifecycle network error is not 'missing': keeps the job and clears nothing", async () => {
    const h = setup();
    h.cloud.on("inspectLifecycle", networkDown);
    const outcome = await runDeletion(h.job, h.deps);
    expect(outcome).toEqual({ status: "retry", reason: "network", job: expect.objectContaining({ phase: "requested", mutationId: "del-1" }) });
    expect(h.local.cleared).toBe(false);
    expect(h.store.jobs.get(`${OWNER}/${PROJECT}`)?.phase).toBe("requested");
    expect(h.cloud.rows.get(PROJECT)?.deletedAt).toBeNull();
  });

  it("revision conflict: deletes nothing, drops the job and asks for a reload", async () => {
    const h = setup({ revision: 6, isReady: true, deletedAt: null, lastMutationId: "other" }, 5);
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "conflict-reload", currentRevision: 6 });
    expect(h.cloud.rows.get(PROJECT)).toMatchObject({ revision: 6, deletedAt: null });
    expect(h.local.cleared).toBe(false);
    expect(h.store.jobs.size).toBe(0);
  });

  it("never-published project: deletes a bare reservation with expectedRevision 0", async () => {
    const h = setup({ revision: 0, isReady: false, deletedAt: null, lastMutationId: null }, null);
    const markDeleted = vi.spyOn(h.cloud.repository, "markDeleted");
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(markDeleted).toHaveBeenCalledWith({ projectId: PROJECT, expectedRevision: 0, mutationId: "del-1" });
  });

  it("never-published locally but ready in the cloud: reload instead of deleting blind", async () => {
    const h = setup({ revision: 1, isReady: true, deletedAt: null, lastMutationId: "lost-first-publish" }, null);
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "conflict-reload", currentRevision: 1 });
    expect(h.events).not.toContain("markDeleted");
    expect(h.store.jobs.size).toBe(0);
  });

  it("already tombstoned for this owner: goes straight to cleanup", async () => {
    const h = setup({ revision: 6, isReady: true, deletedAt: "2026-09-24T00:00:00.000Z", lastMutationId: "del-other-tab" });
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events).not.toContain("markDeleted");
    expect(h.cloud.rows.has(PROJECT)).toBe(false);
  });

  it("tombstone committed but response lost: resume re-inspects and continues without un-tombstoning", async () => {
    const h = setup();
    h.cloud.on("markDeleted", async (real) => {
      await real();
      throw new TypeError("response lost");
    });
    const first = await runDeletion(h.job, h.deps);
    expect(first).toMatchObject({ status: "retry", reason: "network", job: { phase: "requested" } });
    expect(h.cloud.rows.get(PROJECT)?.deletedAt).not.toBeNull();
    if (first.status !== "retry") throw new Error("expected retry");
    await expect(runDeletion(first.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events.filter((e) => e === "markDeleted")).toHaveLength(1);
  });

  it.each<[string, string, DeletionJob["phase"]]>([
    ["storage cleanup", "removeProjectObjects", "tombstoned"],
    ["purge", "purge", "storage-cleaned"],
  ])("%s interrupted: resumes from the persisted phase only", async (_label, method, phase) => {
    const h = setup();
    h.cloud.on(method, networkDown);
    const first = await runDeletion(h.job, h.deps);
    expect(first).toMatchObject({ status: "retry", reason: "network", job: { phase } });
    expect(h.store.jobs.get(`${OWNER}/${PROJECT}`)?.phase).toBe(phase);
    expect(h.local.cleared).toBe(false);

    // Simulate a reload: read the job back from the durable store and resume.
    const persisted = (await h.store.getDeletionJob(OWNER, PROJECT))!;
    h.events.length = 0;
    await expect(runDeletion(persisted, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events).not.toContain("inspectLifecycle");
    expect(h.events).not.toContain("markDeleted");
    expect(h.cloud.rows.has(PROJECT)).toBe(false);
    expect(h.local.cleared).toBe(true);
  });

  it("local cleanup failure resumes at 'done' without any network call", async () => {
    const h = setup();
    let failures = 1;
    h.deps.clearLocal = async () => {
      h.events.push("clearLocal");
      if (failures-- > 0) throw new Error("IDB blocked");
      h.local.cleared = true;
    };
    const first = await runDeletion(h.job, h.deps);
    expect(first).toMatchObject({ status: "retry", reason: "local", job: { phase: "done" } });
    h.events.length = 0;
    const persisted = (await h.store.getDeletionJob(OWNER, PROJECT))!;
    await expect(runDeletion(persisted, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events).toEqual(["waitForInFlightSave", "clearLocal", "deleteJob"]);
  });

  it("does not touch the network when the job cannot be persisted", async () => {
    const h = setup();
    h.store.failPut = 1;
    await expect(runDeletion(h.job, h.deps)).resolves.toMatchObject({ status: "retry", reason: "local", job: { phase: "requested" } });
    expect(h.events).toEqual(["put:requested"]);
  });

  it("auth failure keeps the job for after login; non-retryable failure deletes nothing and drops the job", async () => {
    const auth = setup();
    auth.cloud.on("markDeleted", async () => ({ status: "error", code: "auth", retryable: false }));
    await expect(runDeletion(auth.job, auth.deps)).resolves.toMatchObject({ status: "retry", reason: "auth", job: { phase: "requested" } });
    expect(auth.store.jobs.size).toBe(1);

    const invalid = setup();
    invalid.cloud.on("markDeleted", async () => ({ status: "error", code: "validation", retryable: false }));
    await expect(runDeletion(invalid.job, invalid.deps)).resolves.toEqual({ status: "failed", code: "validation" });
    expect(invalid.store.jobs.size).toBe(0);
    expect(invalid.cloud.rows.get(PROJECT)?.deletedAt).toBeNull();
  });

  it("markDeleted unavailable after a concurrent tombstone re-inspects and cleans up", async () => {
    const h = setup();
    h.cloud.on("markDeleted", async () => {
      Object.assign(h.cloud.rows.get(PROJECT)!, { deletedAt: "2026-09-25T00:00:00.000Z", lastMutationId: "other-tab" });
      return { status: "unavailable" };
    });
    await expect(runDeletion(h.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.events.filter((e) => e === "inspectLifecycle")).toHaveLength(2);
  });
});

describe("saves never resurrect a project being deleted (PST-12)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function coordinatorFor(cloud: FakeCloud, deletionGuard?: () => Promise<boolean>) {
    const saveJobs: SaveJobStore = {
      getSaveJob: async () => null, putSaveJob: async () => undefined, acknowledge: async () => undefined, deleteSaveJob: async () => undefined,
    };
    return createSaveCoordinator({
      ownerId: OWNER, projectId: PROJECT, repository: cloud.repository, assets: cloud.assets,
      localAssets: { getBlob: async () => null }, jobs: saveJobs,
      clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      newMutationId: () => "save-1", isOnline: () => true, deletionGuard,
      initial: { baseRevision: 5, localSequence: 1, acknowledgedSequence: 0, content: content("x") },
    });
  }

  it("an interrupted deletion blocks this browser's saves and the server rejects saves from elsewhere", async () => {
    const h = setup();
    h.cloud.on("removeProjectObjects", networkDown);
    const interrupted = await runDeletion(h.job, h.deps);
    expect(interrupted).toMatchObject({ status: "retry", job: { phase: "tombstoned" } });

    const local = coordinatorFor(h.cloud, deletionGuardFor(h.store, OWNER, PROJECT));
    local.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(local.getStatus()).toEqual({ kind: "stopped" });
    expect(h.events).not.toContain("save");

    const otherDevice = coordinatorFor(h.cloud);
    otherDevice.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(otherDevice.getStatus()).toEqual({ kind: "unavailable" });
    expect(h.cloud.rows.get(PROJECT)?.deletedAt).not.toBeNull();

    if (interrupted.status !== "retry") throw new Error("expected retry");
    await expect(runDeletion(interrupted.job, h.deps)).resolves.toEqual({ status: "deleted" });
    expect(h.cloud.rows.has(PROJECT)).toBe(false);
  });
});
