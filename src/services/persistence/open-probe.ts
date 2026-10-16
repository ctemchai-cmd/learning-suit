import type { LocalDraft, SaveJob } from "../../domain/document/session";
import type { ProjectRepository } from "./repository";
import { isDraftDirty, type CloudLoadResult } from "./reconcile";
import { CloudRepositoryError } from "./supabase-repository";

/** A metadata-only request is small: give up sooner than the 30 s a full document download may take. */
export const LIFECYCLE_PROBE_TIMEOUT_MS = 8_000;

export interface ProbeInput {
  projectId: string;
  localDraft: LocalDraft | null;
  persistedJob: SaveJob | null;
  /** True after a metadata check already answered "unchanged" but the decision still needs the document. */
  forceFull?: boolean;
}

/**
 * Fetches what the open decision needs from the cloud (plan05 §6).
 *
 * A clean published draft (not dirty, no pending save job, has a base revision) only needs to know whether the cloud moved:
 * one small lifecycle read answers that. Same revision + ready + not deleted → "unchanged" (the local draft already IS the
 * cloud document, so nothing is downloaded or rewritten). Any other answer falls through to the full load, so every
 * reconcile decision for dirty drafts, conflicts, deletions and schema pauses is made on the same data as before.
 */
export async function probeCloudForOpen(
  repository: Pick<ProjectRepository, "load" | "inspectLifecycle">,
  input: ProbeInput,
  timeoutMs: number = LIFECYCLE_PROBE_TIMEOUT_MS,
): Promise<CloudLoadResult> {
  const { localDraft: local } = input;
  const cheap = !input.forceFull && local !== null && local.baseRevision !== null && !isDraftDirty(local) && input.persistedJob === null;
  if (cheap) {
    let lifecycle;
    try {
      lifecycle = await repository.inspectLifecycle(input.projectId, { timeoutMs });
    } catch {
      // Unreachable cloud: same outcome as a failed full load (open the local copy, sync later).
      return { status: "error" };
    }
    // No visible row, a tombstone or a reservation that is not ready: load() answers null for exactly these.
    if (!lifecycle || lifecycle.deletedAt !== null || !lifecycle.isReady) return { status: "missing" };
    if (lifecycle.revision === local.baseRevision) return { status: "unchanged", revision: lifecycle.revision };
  }
  return loadCloudRecord(repository, input.projectId);
}

export async function loadCloudRecord(repository: Pick<ProjectRepository, "load">, projectId: string): Promise<CloudLoadResult> {
  try {
    const record = await repository.load(projectId);
    return record ? { status: "ok", record } : { status: "missing" };
  } catch (error) {
    if (error instanceof CloudRepositoryError && error.reason === "schema_unsupported") return { status: "unsupported-schema" };
    return { status: "error" };
  }
}
