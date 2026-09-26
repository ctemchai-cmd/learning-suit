/**
 * Reopen / crash-recovery decision (plan05 §6 "เมื่อเปิดโปรเจกต์ใหม่/หลัง crash", rules 1–8; PST-11).
 * Pure function, no I/O. Decisions use revisions/sequences only — never timestamps.
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 *   decideOnOpen(input: OpenInput): OpenDecision
 *   isDraftDirty(draft: LocalDraft): boolean
 *
 * Priority (first match wins):
 *   0. pending DeletionJob                → "resume-deletion" (never reopen/resurrect, plan05 §7)
 *   2. durable SaveJob                    → "resume-job-first" (resolve the exact job, then decide again)
 *   3. local.baseRevision === null        → "use-local-unpublished" (reserve/resume flow; cloud ignored)
 *   –  cloud not loaded yet               → "load-cloud"
 *   no local draft:
 *      ok → "use-cloud" · missing → "unavailable" · error → "retry-needed" (never create an empty doc)
 *      unsupported-schema → "schema-paused"
 *   published local draft:
 *   7. cloud error                        → "offline-local"
 *   8. cloud schema unsupported           → "schema-paused" (keep local, pause cloud writes)
 *   –  cloud missing/deleted/not owned    → "unavailable" (offer local as a new copy; never recreate the UUID)
 *   4. not dirty                          → "use-cloud"
 *   5. dirty && baseRevision === cloud    → "use-local-then-sync" (sync after the pending edit flushes)
 *   6. dirty && baseRevision !== cloud    → "conflict"
 * Drafts/jobs of another owner or project are ignored (never uploaded under another account).
 */
import type { ProjectRecord } from "../../domain/document/model";
import type { DeletionJob, LocalDraft, SaveJob } from "../../domain/document/session";

export type CloudLoadResult =
  /** The caller has not loaded the cloud row yet (decide first to avoid an unnecessary fetch). */
  | { status: "not-loaded" }
  | { status: "ok"; record: ProjectRecord }
  /** repository.load() returned null: missing, deleted or not owned. */
  | { status: "missing" }
  /** Network/timeout/auth failure while loading. */
  | { status: "error" }
  | { status: "unsupported-schema"; schemaVersion?: unknown };

export interface OpenInput {
  ownerId: string;
  projectId: string;
  localDraft: LocalDraft | null;
  persistedJob: SaveJob | null;
  deletionJob?: DeletionJob | null;
  cloud: CloudLoadResult;
}

export type OpenDecision =
  | { kind: "resume-deletion"; deletionJob: DeletionJob }
  /** Show `local` (if any), resume `job` via SaveCoordinator.resumePersistedJob, then call decideOnOpen again. */
  | { kind: "resume-job-first"; job: SaveJob; local: LocalDraft | null }
  /** Never published: keep local, SaveCoordinator.start() runs reserve → assets → save(0). */
  | { kind: "use-local-unpublished"; local: LocalDraft }
  | { kind: "load-cloud" }
  /** Replace the local draft with the cloud record (baseRevision = acknowledged = record.revision). */
  | { kind: "use-cloud"; record: ProjectRecord }
  /** Keep local and sync; if `waitForPendingEdit`, block cloud saves until the pending edit is flushed. */
  | { kind: "use-local-then-sync"; local: LocalDraft; record: ProjectRecord; waitForPendingEdit: boolean }
  /** Stop: "ใช้ฉบับ Cloud" (with Export backup) or "เก็บงานนี้เป็นสำเนา". Local includes pendingEdit. */
  | { kind: "conflict"; local: LocalDraft; record: ProjectRecord; currentRevision: number }
  /** Cloud unreachable: use local with the offline badge; the coordinator syncs later (revision-checked). */
  | { kind: "offline-local"; local: LocalDraft }
  /** No local draft and the cloud failed: show retry, never create an empty document. */
  | { kind: "retry-needed" }
  /** Cloud schema is newer than this app: keep local (if any), pause cloud writes, show the version message. */
  | { kind: "schema-paused"; local: LocalDraft | null; schemaVersion?: unknown }
  /** Project missing/deleted/not owned in the cloud. With local: offer "save as a new copy". */
  | { kind: "unavailable"; local: LocalDraft | null };

/** plan05 §6 rule 4: dirty = unacknowledged local sequence OR an active pending text/Git edit. */
export function isDraftDirty(draft: LocalDraft): boolean {
  return draft.localSequence !== draft.acknowledgedSequence || draft.pendingEdit != null;
}

function owned<T extends { ownerId: string; projectId: string }>(value: T | null | undefined, input: OpenInput): T | null {
  return value && value.ownerId === input.ownerId && value.projectId === input.projectId ? value : null;
}

export function decideOnOpen(input: OpenInput): OpenDecision {
  const deletionJob = owned(input.deletionJob, input);
  if (deletionJob) return { kind: "resume-deletion", deletionJob };

  const local = owned(input.localDraft, input);
  const job = owned(input.persistedJob, input);
  if (job) return { kind: "resume-job-first", job, local };

  if (local && local.baseRevision === null) return { kind: "use-local-unpublished", local };

  const { cloud } = input;
  if (cloud.status === "not-loaded") return { kind: "load-cloud" };

  if (!local) {
    switch (cloud.status) {
      case "ok": return { kind: "use-cloud", record: cloud.record };
      case "missing": return { kind: "unavailable", local: null };
      case "error": return { kind: "retry-needed" };
      case "unsupported-schema": return { kind: "schema-paused", local: null, schemaVersion: cloud.schemaVersion };
    }
  }

  switch (cloud.status) {
    case "error": return { kind: "offline-local", local };
    case "unsupported-schema": return { kind: "schema-paused", local, schemaVersion: cloud.schemaVersion };
    case "missing": return { kind: "unavailable", local };
    case "ok": {
      const { record } = cloud;
      if (!isDraftDirty(local)) return { kind: "use-cloud", record };
      if (local.baseRevision === record.revision) {
        return { kind: "use-local-then-sync", local, record, waitForPendingEdit: local.pendingEdit != null };
      }
      return { kind: "conflict", local, record, currentRevision: record.revision };
    }
  }
}
