/**
 * Cloud save coordinator (plan05 §5–§6, ADR 0003). Framework-free: every side
 * effect (network, IndexedDB, timers, ids, connectivity) is injected.
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 *   createSaveCoordinator(deps: SaveCoordinatorDeps): SaveCoordinator
 *   cloudStatusLabel(status: CloudStatus): string        // Thai primary UI text (plan01)
 *   DEFAULT_DEBOUNCE_MS = 1500
 *
 *   SaveCoordinator
 *     getStatus(): CloudStatus                  // stable reference until the status changes
 *     subscribe(listener): () => void           // not called on subscribe; use getStatus()
 *     start(): void                             // sync the initial state if dirty/unpublished
 *     localWriteAcknowledged(sequence, content) // after each successful local IDB write
 *     setBlocked(reason, blocked)               // "pendingEdit" | "gesture"
 *     saveNow(): Promise<CloudStatus>           // explicit Save / Cmd+S
 *     retry(): void                             // manual retry of the SAME job
 *     setOnline(online): void
 *     authRestored(ownerId): void
 *     resumePersistedJob(job): void             // durable job found at startup
 *     stop(): void
 *     whenIdle(): Promise<void>                 // resolves when no attempt is in flight
 *     getLatestLocal(): { sequence, content }   // for the conflict/unavailable copy flow
 *     getSyncState(): SyncState                 // baseRevision/ack/latest/active job
 *
 * ── Pipeline per attempt ─────────────────────────────────────────────────────
 *   deletionGuard? → putSaveJob (durable, before ANY network) → [first publish:
 *   reserve → (existing? inspectLifecycle)] → assets (listStates → for each
 *   non-ready referenced asset: local blob → register → upload → markReady) →
 *   repository.save(expectedRevision, mutationId) → jobs.acknowledge.
 *
 * ── Rules ────────────────────────────────────────────────────────────────────
 * - At most one attempt in flight; at most one unacknowledged job. A job is an
 *   immutable snapshot {mutationId, expectedRevision, localSequence, normalized
 *   content}. Later local writes never modify it and never overtake it: a new job
 *   is created only after the current one is acknowledged (or definitively
 *   rejected by the server/asset validation, i.e. known not to be committed).
 * - New jobs wait for the debounce (from the last local write) and for blockers
 *   (pendingEdit/gesture). Retries of an existing job are NOT gated by blockers
 *   (the snapshot is already fixed and must be resolved first, plan05 §6 reopen 2).
 * - First publish (baseRevision === null) sends expectedRevision 0; the local
 *   baseRevision only changes when that save is acknowledged.
 * - network/timeout/thrown errors and retryable errors: same job + mutationId,
 *   backoff 1,2,4,8,16,30,30… s (reset on success, manual retry, coming online);
 *   paused while offline. auth: pause until authRestored(sameOwner); a different
 *   owner stops permanently. validation/quota/non-retryable: no auto retry for
 *   that payload; a newer local write creates a new job. conflict/unavailable:
 *   stop the queue (no overwrite). Jobs are never deleted except by acknowledge
 *   (or overwritten by the next job after a definitive rejection).
 * - "saved" only when acknowledgedSequence >= latest local sequence, the project
 *   is published, no blockers, no job/attempt, and the last attempt succeeded.
 */
import { normalizeForPersistence, referencedAssetIds } from "../../domain/document/assets";
import type { ProjectContent } from "../../domain/document/model";
import type { SaveJob } from "../../domain/document/session";
import { backoffDelayMs, RETRY_MAX_MS } from "./backoff";
import type {
  AssetOpResult, CloudAssetStore, ProjectRepository, ReservationResult, SaveErrorCode, SaveResult,
} from "./repository";

export const DEFAULT_DEBOUNCE_MS = 1_500;

/** Durable save-job storage (IndexedDB `saveJobs` + `drafts`), implemented by the editor owner. */
export interface SaveJobStore {
  getSaveJob(ownerId: string, projectId: string): Promise<SaveJob | null>;
  /** Durable BEFORE any network call. Overwrites the single job slot of [ownerId, projectId]. */
  putSaveJob(job: SaveJob): Promise<void>;
  /**
   * One IDB transaction over `drafts` + `saveJobs`:
   * draft.acknowledgedSequence = max(existing, sequence); draft.baseRevision = revision;
   * delete the save job only if its mutationId === ack.mutationId.
   */
  acknowledge(ownerId: string, projectId: string, ack: { sequence: number; revision: number; mutationId: string }): Promise<void>;
  deleteSaveJob(ownerId: string, projectId: string): Promise<void>;
}

export interface LocalAssetSource {
  getBlob(assetId: string): Promise<Blob | null>;
}

export interface CoordinatorClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type CloudStatus =
  /** "กำลังบันทึก…" — debounce waiting, blocked, uploading or request in flight. */
  | { kind: "pending" }
  /** "บันทึกบน Cloud แล้ว" — latest local sequence acknowledged, nothing pending. `at` = server time if known. */
  | { kind: "saved"; at: string | null }
  /** "เก็บในเครื่องแล้ว · รอเชื่อมต่อ" */
  | { kind: "offline" }
  /** "บันทึกบน Cloud ไม่สำเร็จ" — `retryable` = will retry automatically; `message` explains (Thai). */
  | { kind: "error"; code: SaveErrorCode | "asset"; retryable: boolean; message: string }
  /** "มีงานจากอีกเครื่อง" — queue stopped. */
  | { kind: "conflict"; currentRevision: number | null }
  /** Project missing/deleted/not owned — queue stopped; offer "save local as a new copy". */
  | { kind: "unavailable" }
  /** "เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ" — paused until authRestored(sameOwner). */
  | { kind: "auth" }
  /** stop(), different owner signed in, or project deletion pending. */
  | { kind: "stopped" };

export type BlockReason = "pendingEdit" | "gesture";

export interface SaveCoordinatorDeps {
  ownerId: string;
  projectId: string;
  repository: Pick<ProjectRepository, "reserve" | "save" | "inspectLifecycle">;
  assets: Pick<CloudAssetStore, "listStates" | "register" | "upload" | "markReady">;
  localAssets: LocalAssetSource;
  jobs: SaveJobStore;
  clock: CoordinatorClock;
  newMutationId(): string;
  isOnline(): boolean;
  debounceMs?: number;
  /** Checked before every attempt (before the job is persisted). true → stop; never resurrect a deleted project. */
  deletionGuard?: () => Promise<boolean>;
  initial: {
    baseRevision: number | null;
    localSequence: number;
    acknowledgedSequence: number;
    content: ProjectContent;
    lastSavedAt?: string | null;
  };
}

export interface SyncState {
  baseRevision: number | null;
  acknowledgedSequence: number;
  latestSequence: number;
  activeJob: SaveJob | null;
  inFlight: boolean;
}

export interface SaveCoordinator {
  getStatus(): CloudStatus;
  subscribe(listener: (status: CloudStatus) => void): () => void;
  /** Start syncing the initial state (dirty or unpublished draft). No side effects happen before this or another call. */
  start(): void;
  /** Called after each successful LOCAL IndexedDB write (sequence strictly increasing). Starts/restarts the debounce. */
  localWriteAcknowledged(sequence: number, content: ProjectContent): void;
  /** While true, new cloud saves wait (active text/Git DOM draft, active pointer gesture). */
  setBlocked(reason: BlockReason, blocked: boolean): void;
  /**
   * Explicit Save / Cmd+S: skip debounce and backoff wait (still waits for blockers). Resolves with the
   * status once the local sequence current at call time is acknowledged, or the attempt ends in a
   * non-saved status (offline/error/auth/conflict/unavailable/stopped).
   */
  saveNow(): Promise<CloudStatus>;
  /** Manual retry: immediate (even if flagged offline), resets backoff, reuses the SAME job/mutationId. */
  retry(): void;
  /** Offline pauses; coming online resumes immediately. */
  setOnline(online: boolean): void;
  /** Resume only if same ownerId; a different owner stops the queue permanently. */
  authRestored(ownerId: string): void;
  /** Resume a durable job found at startup BEFORE anything else (plan05 §6 reopen step 2). */
  resumePersistedJob(job: SaveJob): void;
  /** Cancel timers and further network steps. Never deletes a persisted job. An in-flight save that succeeds is still acknowledged. */
  stop(): void;
  /** Resolves when no attempt is in flight (e.g. before starting project deletion). */
  whenIdle(): Promise<void>;
  /** For the conflict UI: the content that must be preserved as a copy. */
  getLatestLocal(): { sequence: number; content: ProjectContent };
  getSyncState(): SyncState;
}

const STATUS_LABELS: Record<CloudStatus["kind"], string> = {
  pending: "กำลังบันทึก…",
  saved: "บันทึกบน Cloud แล้ว",
  offline: "เก็บในเครื่องแล้ว · รอเชื่อมต่อ",
  error: "บันทึกบน Cloud ไม่สำเร็จ",
  conflict: "มีงานจากอีกเครื่อง",
  unavailable: "ไม่พบโปรเจกต์นี้บน Cloud",
  auth: "เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ",
  stopped: "หยุดบันทึกบน Cloud",
};

export function cloudStatusLabel(status: CloudStatus): string {
  return STATUS_LABELS[status.kind];
}

// ─── internals ──────────────────────────────────────────────────────────────

type Halt = "stopped" | "owner-changed" | "deleting" | "conflict" | "unavailable";

interface JobEntry {
  job: SaveJob;
  persisted: boolean;
  /** First publish: reservation confirmed during this session, skip reserve on retries. */
  reserved: boolean;
  /** Definitively rejected (known not committed): no auto retry; a newer local write replaces it. */
  rejected: boolean;
}

interface Failure {
  code: SaveErrorCode | "asset";
  retryable: boolean;
  message: string;
  /** Show as "offline" instead of an error while the device is offline. */
  offlineAware: boolean;
}

type Outcome =
  | { type: "saved"; revision: number; updatedAt: string | null }
  | { type: "retry"; failure: Failure }
  | { type: "reject"; failure: Failure }
  | { type: "auth" }
  | { type: "conflict"; currentRevision: number | null }
  | { type: "unavailable" }
  | { type: "deleting" }
  | { type: "aborted" };

const MESSAGES = {
  network: "เชื่อมต่อ Cloud ไม่สำเร็จ · จะลองใหม่อัตโนมัติ",
  local: "เก็บงานที่รอส่งในเครื่องไม่สำเร็จ · จะลองใหม่อัตโนมัติ",
  validation: "Cloud ไม่รับเอกสารนี้เพราะข้อมูลไม่ผ่านการตรวจสอบ · แก้เอกสารหรือ Export สำรอง",
  quota: "เอกสารหรือพื้นที่เกินขีดจำกัดของ Cloud · ลดขนาดเอกสารหรือ Export สำรอง",
  unknownRetry: "เกิดข้อผิดพลาดที่ Cloud · จะลองใหม่อัตโนมัติ",
  unknown: "เกิดข้อผิดพลาดที่ Cloud · กดลองใหม่หรือ Export สำรอง",
  reserve: "สร้างโปรเจกต์บน Cloud ไม่สำเร็จ · กดลองใหม่หรือ Export สำรอง",
  noSlides: "เอกสารไม่มีสไลด์ จึงบันทึกบน Cloud ไม่ได้",
  assetRetry: "อัปโหลดรูปภาพไม่สำเร็จ · จะลองใหม่อัตโนมัติ",
  assetMissing: "ไม่พบไฟล์รูปภาพในเครื่อง จึงบันทึกบน Cloud ไม่ได้ · ลบหรือใส่รูปนั้นใหม่แล้วบันทึกอีกครั้ง",
  assetRejected: "Cloud ไม่รับไฟล์รูปภาพ (ข้อมูลไม่ตรงกัน) · ใส่รูปนั้นใหม่หรือ Export สำรอง",
} as const;

const NETWORK_FAILURE: Failure = { code: "network", retryable: true, message: MESSAGES.network, offlineAware: true };
const LOCAL_FAILURE: Failure = { code: "unknown", retryable: true, message: MESSAGES.local, offlineAware: false };
const ASSET_RETRY_FAILURE: Failure = { code: "asset", retryable: true, message: MESSAGES.assetRetry, offlineAware: true };
const ABORTED: Outcome = { type: "aborted" };

const retryWith = (failure: Failure): Outcome => ({ type: "retry", failure });
const rejectWith = (code: Failure["code"], message: string): Outcome => ({
  type: "reject", failure: { code, retryable: false, message, offlineAware: false },
});

function mapSaveError(code: SaveErrorCode, retryable: boolean): Outcome {
  switch (code) {
    case "auth": return { type: "auth" };
    case "network": return retryWith(NETWORK_FAILURE);
    case "validation": return rejectWith("validation", MESSAGES.validation);
    case "quota": return rejectWith("quota", MESSAGES.quota);
    case "unknown":
      return retryable
        ? retryWith({ code: "unknown", retryable: true, message: MESSAGES.unknownRetry, offlineAware: true })
        : rejectWith("unknown", MESSAGES.unknown);
  }
}

function mapReserveError(code: string, retryable: boolean): Outcome {
  if (code === "auth") return { type: "auth" };
  if (code === "network") return retryWith(NETWORK_FAILURE);
  if (retryable) return retryWith({ code: "unknown", retryable: true, message: MESSAGES.unknownRetry, offlineAware: true });
  return rejectWith(code === "validation" ? "validation" : "unknown", MESSAGES.reserve);
}

function mapAssetError(result: Extract<AssetOpResult, { status: "error" }>): Outcome {
  if (result.code === "auth") return { type: "auth" };
  if (result.code === "network" || result.retryable) return retryWith(ASSET_RETRY_FAILURE);
  return rejectWith("asset", MESSAGES.assetRejected);
}

const SETTLING_KINDS = new Set<CloudStatus["kind"]>(["offline", "error", "conflict", "unavailable", "auth", "stopped"]);

function sameStatus(a: CloudStatus, b: CloudStatus): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "saved": return a.at === (b as typeof a).at;
    case "conflict": return a.currentRevision === (b as typeof a).currentRevision;
    case "error": {
      const other = b as typeof a;
      return a.code === other.code && a.retryable === other.retryable && a.message === other.message;
    }
    default: return true;
  }
}

export function createSaveCoordinator(deps: SaveCoordinatorDeps): SaveCoordinator {
  const { ownerId, projectId, repository, assets, localAssets, jobs, clock } = deps;
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let latestSequence = deps.initial.localSequence;
  let latestContent = deps.initial.content;
  let acknowledgedSequence = deps.initial.acknowledgedSequence;
  let baseRevision = deps.initial.baseRevision;
  let lastSavedAt: string | null = deps.initial.lastSavedAt ?? null;
  let lastWriteAt = Number.NEGATIVE_INFINITY;

  let entry: JobEntry | null = null;
  let inFlight = false;
  let failures = 0;
  let retryNotBefore = 0;
  let lastFailure: Failure | null = null;
  let authPaused = false;
  let halt: Halt | null = null;
  let conflictRevision: number | null = null;
  let onlineFlag = true;
  /** saveNow(): skip the debounce until a job covering this sequence is created. */
  let forceThrough: number | null = null;
  const blockers = new Set<BlockReason>();

  let wake: unknown = null;
  let status: CloudStatus = { kind: "pending" };
  const listeners = new Set<(status: CloudStatus) => void>();
  let waiters: { target: number; resolve: (status: CloudStatus) => void }[] = [];
  let idleWaiters: (() => void)[] = [];

  const halted = () => halt !== null;
  const isOffline = () => !onlineFlag || !deps.isOnline();
  const needsNewJob = () => baseRevision === null || latestSequence > acknowledgedSequence;
  const hasWork = () => entry !== null || needsNewJob();
  const isAcked = (sequence: number) => baseRevision !== null && acknowledgedSequence >= sequence;
  status = computeStatus();

  function computeStatus(): CloudStatus {
    switch (halt) {
      case "conflict": return { kind: "conflict", currentRevision: conflictRevision };
      case "unavailable": return { kind: "unavailable" };
      case "stopped": case "owner-changed": case "deleting": return { kind: "stopped" };
      case null: break;
    }
    if (authPaused) return { kind: "auth" };
    if (inFlight) return { kind: "pending" };
    if (lastFailure) {
      if (lastFailure.offlineAware && isOffline()) return { kind: "offline" };
      const { code, retryable, message } = lastFailure;
      return { kind: "error", code, retryable, message };
    }
    if (hasWork()) return isOffline() ? { kind: "offline" } : { kind: "pending" };
    if (blockers.size) return { kind: "pending" };
    return { kind: "saved", at: lastSavedAt };
  }

  function emit(): void {
    const next = computeStatus();
    if (!sameStatus(next, status)) {
      status = next;
      for (const listener of [...listeners]) {
        try {
          listener(status);
        } catch {
          // A broken listener must not break the save queue.
        }
      }
    }
    if (!waiters.length) return;
    const remaining: typeof waiters = [];
    for (const waiter of waiters) {
      if (isAcked(waiter.target) || SETTLING_KINDS.has(status.kind)) waiter.resolve(status);
      else remaining.push(waiter);
    }
    waiters = remaining;
  }

  function clearWake(): void {
    if (wake !== null) clock.clearTimeout(wake);
    wake = null;
  }

  function scheduleWake(ms: number): void {
    clearWake();
    wake = clock.setTimeout(() => {
      wake = null;
      pump();
    }, Math.max(0, ms));
  }

  function createJob(): SaveJob {
    return {
      ownerId,
      projectId,
      mutationId: deps.newMutationId(),
      expectedRevision: baseRevision ?? 0,
      localSequence: latestSequence,
      content: normalizeForPersistence(latestContent),
      createdAt: new Date(clock.now()).toISOString(),
    };
  }

  /** The single scheduler. Idempotent: decides whether an attempt may start now, otherwise arms one wake-up. */
  function pump(opts: { force?: boolean; ignoreOffline?: boolean } = {}): void {
    if (halted() || authPaused || inFlight) {
      if (halted() || authPaused) clearWake();
      emit();
      return;
    }
    const now = clock.now();
    const offline = isOffline() && !opts.ignoreOffline;

    if (entry && !entry.rejected) {
      if (offline) scheduleWake(RETRY_MAX_MS);
      else if (!opts.force && now < retryNotBefore) scheduleWake(retryNotBefore - now);
      else return begin(entry);
      emit();
      return;
    }

    const replacesRejected = entry !== null && latestSequence > entry.job.localSequence;
    if ((entry && !replacesRejected) || !needsNewJob()) {
      clearWake();
      emit();
      return;
    }
    if (blockers.size) {
      clearWake();
      emit();
      return;
    }
    if (offline) {
      scheduleWake(RETRY_MAX_MS);
      emit();
      return;
    }
    const forcing = opts.force || (forceThrough !== null && !isAcked(forceThrough));
    const due = lastWriteAt + debounceMs;
    if (!forcing && now < due) {
      scheduleWake(due - now);
      emit();
      return;
    }
    const job = createJob();
    if (forceThrough !== null && job.localSequence >= forceThrough) forceThrough = null;
    failures = 0;
    retryNotBefore = 0;
    lastFailure = null;
    entry = { job, persisted: false, reserved: false, rejected: false };
    begin(entry);
  }

  function begin(target: JobEntry): void {
    clearWake();
    inFlight = true;
    lastFailure = null;
    emit();
    void execute(target)
      .catch((): Outcome => retryWith(NETWORK_FAILURE))
      .then((outcome) => finish(target, outcome));
  }

  function finish(target: JobEntry, outcome: Outcome): void {
    inFlight = false;
    switch (outcome.type) {
      case "saved":
        acknowledgedSequence = Math.max(acknowledgedSequence, target.job.localSequence);
        baseRevision = outcome.revision;
        if (outcome.updatedAt) lastSavedAt = outcome.updatedAt;
        if (entry === target) entry = null;
        failures = 0;
        retryNotBefore = 0;
        lastFailure = null;
        if (forceThrough !== null && isAcked(forceThrough)) forceThrough = null;
        break;
      case "retry":
        failures += 1;
        retryNotBefore = clock.now() + backoffDelayMs(failures);
        lastFailure = outcome.failure;
        break;
      case "reject":
        target.rejected = true;
        failures = 0;
        retryNotBefore = 0;
        lastFailure = outcome.failure;
        break;
      case "auth":
        authPaused = true;
        break;
      case "conflict":
        halt ??= "conflict";
        if (halt === "conflict") conflictRevision = outcome.currentRevision;
        break;
      case "unavailable":
        halt ??= "unavailable";
        break;
      case "deleting":
        halt ??= "deleting";
        break;
      case "aborted":
        break;
    }
    const idle = idleWaiters;
    idleWaiters = [];
    for (const resolve of idle) resolve();
    pump();
  }

  async function execute(target: JobEntry): Promise<Outcome> {
    const { job } = target;
    if (deps.deletionGuard) {
      let deleting: boolean;
      try {
        deleting = await deps.deletionGuard();
      } catch {
        return retryWith(LOCAL_FAILURE);
      }
      if (deleting) return { type: "deleting" };
      if (halted()) return ABORTED;
    }

    if (!target.persisted) {
      try {
        await jobs.putSaveJob(job);
      } catch {
        return retryWith(LOCAL_FAILURE);
      }
      target.persisted = true;
      if (halted()) return ABORTED;
    }

    if (job.expectedRevision === 0 && !target.reserved) {
      const reserved = await reserve(target);
      if (reserved) return reserved;
      if (halted()) return ABORTED;
    }

    const assetOutcome = await ensureAssets(job);
    if (assetOutcome) return assetOutcome;
    if (halted()) return ABORTED;

    let result: SaveResult;
    try {
      result = await repository.save({
        projectId, expectedRevision: job.expectedRevision, mutationId: job.mutationId, content: job.content,
      });
    } catch {
      return retryWith(NETWORK_FAILURE);
    }
    switch (result.status) {
      case "saved": return acknowledge(job, result.revision, result.updatedAt);
      case "conflict": return { type: "conflict", currentRevision: result.currentRevision };
      case "unavailable": return { type: "unavailable" };
      case "error": return mapSaveError(result.code, result.retryable);
    }
  }

  /** First publish (plan05 §5 steps 1–2). Returns null to continue with assets + save(expectedRevision 0). */
  async function reserve(target: JobEntry): Promise<Outcome | null> {
    const { job } = target;
    const firstSlide = job.content.document.slides[0];
    if (!firstSlide) return rejectWith("validation", MESSAGES.noSlides);
    let reservation: ReservationResult;
    try {
      reservation = await repository.reserve({ projectId, title: job.content.title, initialSlideId: firstSlide.id });
    } catch {
      return retryWith(NETWORK_FAILURE);
    }
    switch (reservation.status) {
      case "reserved":
        target.reserved = true;
        return null;
      case "unavailable":
        return { type: "unavailable" };
      case "error":
        return mapReserveError(reservation.code, reservation.retryable);
      case "existing": {
        if (halted()) return ABORTED;
        let lifecycle: Awaited<ReturnType<typeof repository.inspectLifecycle>>;
        try {
          lifecycle = await repository.inspectLifecycle(projectId);
        } catch {
          return retryWith(NETWORK_FAILURE);
        }
        if (!lifecycle || lifecycle.deletedAt) return { type: "unavailable" };
        if (lifecycle.isReady) {
          // A previous attempt of THIS job committed but its response was lost → acknowledge it.
          if (lifecycle.lastMutationId === job.mutationId) {
            return acknowledge(job, lifecycle.revision, reservation.record.updatedAt);
          }
          return { type: "conflict", currentRevision: lifecycle.revision };
        }
        target.reserved = true; // own reservation (revision 0, not ready): resume
        return null;
      }
    }
  }

  /** plan05 §5 steps 3–5 for every asset the snapshot references. Returns null when all are ready. */
  async function ensureAssets(job: SaveJob): Promise<Outcome | null> {
    const ids = [...referencedAssetIds(job.content.document)];
    if (!ids.length) return null;
    let states: Record<string, "pending" | "ready">;
    try {
      states = await assets.listStates(projectId);
    } catch {
      return retryWith(ASSET_RETRY_FAILURE);
    }
    for (const assetId of ids) {
      if (states[assetId] === "ready") continue;
      if (halted()) return ABORTED;
      const reference = job.content.document.assets[assetId];
      if (!reference) return rejectWith("asset", MESSAGES.assetMissing);
      let blob: Blob | null;
      try {
        blob = await localAssets.getBlob(assetId);
      } catch {
        return retryWith(LOCAL_FAILURE);
      }
      if (!blob) return rejectWith("asset", MESSAGES.assetMissing);
      const bytes = blob;
      const steps: (() => Promise<AssetOpResult>)[] = [
        () => assets.register(projectId, reference),
        () => assets.upload(reference, bytes),
        () => assets.markReady(projectId, assetId),
      ];
      for (const step of steps) {
        if (halted()) return ABORTED;
        let result: AssetOpResult;
        try {
          result = await step();
        } catch {
          return retryWith(ASSET_RETRY_FAILURE);
        }
        if (result.status === "error") return mapAssetError(result);
      }
    }
    return null;
  }

  async function acknowledge(job: SaveJob, revision: number, updatedAt: string | null): Promise<Outcome> {
    try {
      await jobs.acknowledge(ownerId, projectId, { sequence: job.localSequence, revision, mutationId: job.mutationId });
    } catch {
      // Server already committed; retrying the same job replays it (same mutationId) and acknowledges again.
      return retryWith(LOCAL_FAILURE);
    }
    return { type: "saved", revision, updatedAt };
  }

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start() {
      pump();
    },

    localWriteAcknowledged(sequence, content) {
      if (!(sequence > latestSequence)) return;
      latestSequence = sequence;
      latestContent = content;
      lastWriteAt = clock.now();
      // A rejection applies to the old payload only; the new one may fix it.
      if (entry?.rejected) lastFailure = null;
      pump();
    },

    setBlocked(reason, blocked) {
      if (blockers.has(reason) === blocked) return;
      if (blocked) blockers.add(reason);
      else blockers.delete(reason);
      pump();
    },

    saveNow() {
      if (halted() || authPaused) {
        emit();
        return Promise.resolve(status);
      }
      const target = latestSequence;
      if (!isAcked(target)) forceThrough = Math.max(forceThrough ?? target, target);
      const promise = new Promise<CloudStatus>((resolve) => waiters.push({ target, resolve }));
      pump({ force: true });
      return promise;
    },

    retry() {
      if (halted() || authPaused) return;
      failures = 0;
      retryNotBefore = 0;
      if (entry?.rejected) entry.rejected = false;
      pump({ force: true, ignoreOffline: true });
    },

    setOnline(online) {
      onlineFlag = online;
      if (online) {
        failures = 0;
        retryNotBefore = 0;
      }
      pump();
    },

    authRestored(restoredOwnerId) {
      if (restoredOwnerId !== ownerId) {
        halt = "owner-changed";
        pump();
        return;
      }
      if (authPaused) {
        authPaused = false;
        failures = 0;
        retryNotBefore = 0;
      }
      pump();
    },

    resumePersistedJob(job) {
      if (job.ownerId !== ownerId || job.projectId !== projectId) {
        throw new Error("Save job belongs to a different owner or project");
      }
      if (entry) {
        if (entry.job.mutationId === job.mutationId) return;
        throw new Error("Another save job is already active for this project");
      }
      entry = { job, persisted: true, reserved: false, rejected: false };
      retryNotBefore = 0;
      pump({ force: true });
    },

    stop() {
      halt = "stopped";
      pump();
    },

    whenIdle() {
      if (!inFlight) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    getLatestLocal: () => ({ sequence: latestSequence, content: latestContent }),

    getSyncState: () => ({
      baseRevision, acknowledgedSequence, latestSequence, activeJob: entry?.job ?? null, inFlight,
    }),
  };
}
