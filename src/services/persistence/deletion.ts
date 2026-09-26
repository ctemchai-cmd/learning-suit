/**
 * Resumable project deletion (plan05 §7 steps 1–6; PST-12). Framework-free, all effects injected.
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 *   createDeletionJob(input, { newMutationId, now }): DeletionJob        // phase "requested"
 *   runDeletion(job, deps: DeletionDeps): Promise<DeletionOutcome>       // start or resume from job.phase
 *   isDeletionPending(job): job is DeletionJob                           // any persisted job blocks saves
 *   deletionGuardFor(store, ownerId, projectId): () => Promise<boolean>  // SaveCoordinator `deletionGuard`
 *
 * Phases only move forward and each is persisted after its step succeeds:
 *   requested ──(persist job, wait in-flight save, inspectLifecycle, mark_project_deleted)──▶ tombstoned
 *   tombstoned ──(removeProjectObjects)──▶ storage-cleaned ──(purge)──▶ done ──(wait save, clearLocal, delete job)──▶ ∅
 *   requested + no cloud row (confirmed null, not an error) ──▶ done (local cleanup only)
 * Failures keep the job at its current phase and return "retry"; resuming repeats only idempotent steps.
 * Nothing ever un-tombstones: once past "requested", no lifecycle/markDeleted/save/reserve call is made.
 */
import type { DeletionJob, DeletionPhase } from "../../domain/document/session";
import type { CloudAssetStore, CloudProjectLifecycle, ProjectRepository, SaveResult } from "./repository";

/** IndexedDB `deletionJobs` store keyed by [ownerId, projectId]; implemented by the editor owner. */
export interface DeletionJobStore {
  getDeletionJob(ownerId: string, projectId: string): Promise<DeletionJob | null>;
  putDeletionJob(job: DeletionJob): Promise<void>;
  deleteDeletionJob(ownerId: string, projectId: string): Promise<void>;
}

export interface DeletionDeps {
  repository: Pick<ProjectRepository, "inspectLifecycle" | "markDeleted" | "purge">;
  assets: Pick<CloudAssetStore, "removeProjectObjects">;
  jobs: DeletionJobStore;
  /** Resolve the outcome of any in-flight cloud save first (e.g. SaveCoordinator.whenIdle()). */
  waitForInFlightSave(): Promise<void>;
  /** Delete drafts, assets, sessions, saveJobs and thumbnails of [ownerId, projectId] (NOT the deletion job). */
  clearLocal(): Promise<void>;
}

export type DeletionRetryReason = "network" | "auth" | "local";

export type DeletionOutcome =
  /** Cloud row/objects and local stores are gone; the deletion job was removed. */
  | { status: "deleted" }
  /** Interrupted; `job` is persisted at `job.phase`. Call runDeletion(job) again later (e.g. when online / after login). */
  | { status: "retry"; job: DeletionJob; reason: DeletionRetryReason }
  /** The cloud has newer edits than the confirmed revision: nothing was deleted, the job was removed. Reload, then confirm again. */
  | { status: "conflict-reload"; currentRevision: number | null }
  /** Non-retryable server rejection before the tombstone: nothing was deleted, the job was removed. */
  | { status: "failed"; code: string };

export function createDeletionJob(
  input: { ownerId: string; projectId: string; expectedRevision: number | null; title: string },
  deps: { newMutationId(): string; now(): number },
): DeletionJob {
  return {
    ownerId: input.ownerId,
    projectId: input.projectId,
    mutationId: deps.newMutationId(),
    expectedRevision: input.expectedRevision,
    phase: "requested",
    title: input.title,
    createdAt: new Date(deps.now()).toISOString(),
  };
}

/** Any persisted deletion job (every phase, including "done") means the project must never be saved again. */
export function isDeletionPending(job: DeletionJob | null | undefined): job is DeletionJob {
  return job != null;
}

export function deletionGuardFor(store: Pick<DeletionJobStore, "getDeletionJob">, ownerId: string, projectId: string): () => Promise<boolean> {
  return async () => isDeletionPending(await store.getDeletionJob(ownerId, projectId));
}

class Interrupted {
  constructor(readonly reason: DeletionRetryReason) {}
}

/** Runs `step`; any throw becomes an Interrupted with the given reason. */
async function attempt<T>(reason: DeletionRetryReason, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof Interrupted) throw error;
    // Expired/switched sessions surface as "log in again", not as a network problem.
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    throw new Interrupted(reason !== "local" && code === "auth" ? "auth" : reason);
  }
}

type Terminal = Extract<DeletionOutcome, { status: "conflict-reload" | "failed" }>;

export async function runDeletion(job: DeletionJob, deps: DeletionDeps): Promise<DeletionOutcome> {
  const { repository, assets, jobs } = deps;
  const { ownerId, projectId } = job;
  let current = job;

  const moveTo = async (phase: DeletionPhase) => {
    const next = { ...current, phase };
    await attempt("local", () => jobs.putDeletionJob(next));
    current = next;
  };

  /** Removes the job when nothing was deleted, so saves can resume after the user reloads. */
  const abandon = async (outcome: Terminal): Promise<DeletionOutcome> => {
    await attempt("local", () => jobs.deleteDeletionJob(ownerId, projectId));
    return outcome;
  };

  const inspect = () => attempt("network", () => repository.inspectLifecycle(projectId));

  /** plan05 §7 steps 2–3. Returns a terminal outcome, or null after advancing the phase. */
  const tombstone = async (): Promise<DeletionOutcome | null> => {
    const lifecycle: CloudProjectLifecycle | null = await inspect();
    if (!lifecycle) {
      await moveTo("done"); // confirmed: no cloud row (not a network error) → local cleanup only
      return null;
    }
    if (lifecycle.deletedAt) {
      await moveTo("tombstoned"); // already tombstoned for this owner (e.g. lost response) → cleanup
      return null;
    }
    // Never-published local project: only a bare reservation (revision 0, not ready) may be deleted blind.
    const expectedRevision = current.expectedRevision ?? (!lifecycle.isReady && lifecycle.revision === 0 ? 0 : null);
    if (expectedRevision === null) return abandon({ status: "conflict-reload", currentRevision: lifecycle.revision });

    const result: SaveResult = await attempt("network", () =>
      repository.markDeleted({ projectId, expectedRevision, mutationId: current.mutationId }));
    switch (result.status) {
      case "saved":
        await moveTo("tombstoned");
        return null;
      case "conflict":
        return abandon({ status: "conflict-reload", currentRevision: result.currentRevision });
      case "unavailable": {
        // Row vanished or was tombstoned by another mutation between inspect and mark: re-check once.
        const again = await inspect();
        if (!again) await moveTo("done");
        else if (again.deletedAt) await moveTo("tombstoned");
        else throw new Interrupted("network");
        return null;
      }
      case "error":
        if (result.code === "auth") throw new Interrupted("auth");
        if (result.code === "network" || result.retryable) throw new Interrupted("network");
        return abandon({ status: "failed", code: result.code });
    }
  };

  try {
    for (;;) {
      switch (current.phase) {
        case "requested": {
          // Durable before any network call; also makes deletionGuard stop the save coordinator.
          const persisted = current;
          await attempt("local", () => jobs.putDeletionJob(persisted));
          await attempt("local", () => deps.waitForInFlightSave());
          const outcome = await tombstone();
          if (outcome) return outcome;
          break;
        }
        case "tombstoned":
          await attempt("network", () => assets.removeProjectObjects(ownerId, projectId));
          await moveTo("storage-cleaned");
          break;
        case "storage-cleaned":
          await attempt("network", () => repository.purge(projectId));
          await moveTo("done");
          break;
        case "done":
          await attempt("local", () => deps.waitForInFlightSave());
          await attempt("local", () => deps.clearLocal());
          await attempt("local", () => jobs.deleteDeletionJob(ownerId, projectId));
          return { status: "deleted" };
        default:
          throw new Error(`Unknown deletion phase: ${String((current as { phase: unknown }).phase)}`);
      }
    }
  } catch (error) {
    if (error instanceof Interrupted) return { status: "retry", job: current, reason: error.reason };
    throw error;
  }
}
