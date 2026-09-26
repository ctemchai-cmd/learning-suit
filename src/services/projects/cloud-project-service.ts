"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectContent, type AssetReference, type ProjectContent, type ProjectRecord } from "@/domain/document/model";
import type { LocalDraft } from "@/domain/document/session";
import { duplicateProjectContent } from "@/domain/document/remap";
import { parseProjectContent } from "@/domain/document/schema";
import { DEFAULTS } from "@/domain/document/limits";
import type { CloudStatusView, CloudSync, OpenedProject, ProjectOpener } from "@/features/editor/store";
import { useEditorStore } from "@/features/editor/store";
import type { CloudUi } from "@/features/editor/editor";
import { importArchiveInWorker } from "@/services/export/archive-client";
import {
  createLocalDraft, deleteLocalProjectData, getLocalAsset, getLocalDraft, getThumbnail, idbDeletionJobStore, idbSaveJobStore,
  listLocalDrafts, putCleanDraftFromCloud, withWriterLock, writeDraftContent,
} from "@/services/persistence/local-db";
import { createSaveCoordinator, type CloudStatus, type SaveCoordinator } from "@/services/persistence/save-coordinator";
import { decideOnOpen, type CloudLoadResult, type OpenDecision } from "@/services/persistence/reconcile";
import { createDeletionJob, deletionGuardFor, runDeletion } from "@/services/persistence/deletion";
import { CloudRepositoryError, SupabaseProjectRepository } from "@/services/persistence/supabase-repository";
import type { CloudAssetStore, ProjectRepository } from "@/services/persistence/repository";
import { SupabaseAssetStore } from "@/services/persistence/supabase-assets";
import { copyAssetBlobs, type DeleteOutcome, type ProjectCard, type ProjectService } from "./local-project-service";

const clock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function toView(status: CloudStatus): CloudStatusView {
  if (status.kind === "error") return { kind: "error", retryable: status.retryable, message: status.message };
  return status;
}

/** Adapts the save coordinator to the editor store; wires online/offline events. */
function cloudSyncFrom(coordinator: SaveCoordinator, extra?: { staticStatus?: CloudStatusView }): CloudSync {
  const online = () => coordinator.setOnline(true);
  const offline = () => coordinator.setOnline(false);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  let cached: { source: CloudStatus; view: CloudStatusView } | null = null;
  const view = (): CloudStatusView => {
    if (extra?.staticStatus) return extra.staticStatus;
    const source = coordinator.getStatus();
    if (cached?.source !== source) cached = { source, view: toView(source) };
    return cached.view;
  };
  return {
    localWriteAcknowledged: (sequence, content) => { if (!extra?.staticStatus) coordinator.localWriteAcknowledged(sequence, content); },
    setBlocked: (reason, blocked) => coordinator.setBlocked(reason, blocked),
    saveNow: () => extra?.staticStatus ? Promise.resolve(extra.staticStatus) : coordinator.saveNow(),
    retry: () => coordinator.retry(),
    authRestored: (ownerId) => coordinator.authRestored(ownerId),
    stop: () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      coordinator.stop();
    },
    getStatus: view,
    subscribe: (listener) => coordinator.subscribe(() => listener(view())),
  };
}

/** A cloud-less adapter that only shows a fixed status (conflict / unavailable / schema pause). */
function staticSync(status: CloudStatusView): CloudSync {
  return {
    localWriteAcknowledged: () => undefined, setBlocked: () => undefined, saveNow: async () => status,
    retry: () => undefined, authRestored: () => undefined, stop: () => undefined,
    getStatus: () => status, subscribe: () => () => undefined,
  };
}

/**
 * The Supabase client sends whatever session is in the shared auth cookie, which another tab may
 * have switched to a different account. Every cloud call first re-validates that the current
 * session still belongs to `ownerId`; otherwise it fails as an auth error and nothing is sent
 * (plan05 §2 account isolation, ADR 0003 rule 6).
 */
function identityGuard(supabase: SupabaseClient, ownerId: string): () => Promise<boolean> {
  return async () => {
    try {
      const { data, error } = await supabase.auth.getClaims();
      return !error && data?.claims?.sub === ownerId;
    } catch {
      return false;
    }
  };
}

const AUTH_ERROR = () => new CloudRepositoryError("Session does not belong to this owner", { code: "auth", retryable: false }, { reason: "owner_mismatch" });

function guardedRepository(inner: ProjectRepository, sameOwner: () => Promise<boolean>): ProjectRepository {
  return {
    async list() { if (!await sameOwner()) throw AUTH_ERROR(); return inner.list(); },
    async load(id) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.load(id); },
    async inspectLifecycle(id) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.inspectLifecycle(id); },
    async reserve(request) { if (!await sameOwner()) return { status: "error", code: "auth", retryable: false }; return inner.reserve(request); },
    async save(request) { if (!await sameOwner()) return { status: "error", code: "auth", retryable: false }; return inner.save(request); },
    async markDeleted(request) { if (!await sameOwner()) return { status: "error", code: "auth", retryable: false }; return inner.markDeleted(request); },
    async purge(id) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.purge(id); },
  };
}

function guardedAssets(inner: CloudAssetStore, sameOwner: () => Promise<boolean>): CloudAssetStore {
  const denied = { status: "error", code: "auth", retryable: false } as const;
  return {
    async listStates(projectId) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.listStates(projectId); },
    async register(projectId, asset) { return await sameOwner() ? inner.register(projectId, asset) : denied; },
    async upload(asset, bytes) { return await sameOwner() ? inner.upload(asset, bytes) : denied; },
    async markReady(projectId, assetId) { return await sameOwner() ? inner.markReady(projectId, assetId) : denied; },
    async download(asset) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.download(asset); },
    async removeProjectObjects(owner, projectId) { if (!await sameOwner()) throw AUTH_ERROR(); return inner.removeProjectObjects(owner, projectId); },
  };
}

export function createCloudProjectService(ownerId: string, supabase: SupabaseClient): ProjectService {
  const sameOwner = identityGuard(supabase, ownerId);
  const repository = guardedRepository(new SupabaseProjectRepository(supabase), sameOwner);
  const assets = guardedAssets(new SupabaseAssetStore(supabase, ownerId), sameOwner);

  const makeCoordinator = (projectId: string, draft: LocalDraft) => createSaveCoordinator({
    ownerId, projectId, repository, assets,
    localAssets: { getBlob: (assetId) => getLocalAsset(ownerId, projectId, assetId) },
    jobs: idbSaveJobStore, clock, newMutationId: () => crypto.randomUUID(),
    isOnline: () => navigator.onLine, debounceMs: DEFAULTS.cloudDebounceMs,
    deletionGuard: deletionGuardFor(idbDeletionJobStore, ownerId, projectId),
    initial: {
      baseRevision: draft.baseRevision, localSequence: draft.localSequence,
      acknowledgedSequence: draft.acknowledgedSequence, content: draft.content, lastSavedAt: null,
    },
  });

  const loadCloud = async (projectId: string): Promise<CloudLoadResult> => {
    try {
      const record = await repository.load(projectId);
      return record ? { status: "ok", record } : { status: "missing" };
    } catch (error) {
      if (error instanceof CloudRepositoryError && error.reason === "schema_unsupported") return { status: "unsupported-schema" };
      return { status: "error" };
    }
  };

  /** Runs a one-shot sync of the stored draft while the caller holds the writer lock. */
  const syncOnce = async (projectId: string): Promise<CloudStatus> => {
    const draft = await getLocalDraft(ownerId, projectId);
    if (!draft) throw new Error("ไม่พบโปรเจกต์ในเครื่อง");
    const coordinator = makeCoordinator(projectId, draft);
    const job = await idbSaveJobStore.getSaveJob(ownerId, projectId);
    try {
      if (job) { coordinator.resumePersistedJob(job); await coordinator.whenIdle(); }
      coordinator.start();
      return await coordinator.saveNow();
    } finally {
      coordinator.stop();
    }
  };

  const ensureLocalDraft = async (projectId: string): Promise<LocalDraft> => {
    const existing = await getLocalDraft(ownerId, projectId);
    if (existing) return existing;
    const cloud = await loadCloud(projectId);
    if (cloud.status !== "ok") throw new Error(cloud.status === "missing" ? "ไม่พบโปรเจกต์นี้บน Cloud" : "โหลดโปรเจกต์จาก Cloud ไม่สำเร็จ ลองใหม่อีกครั้ง");
    return putCleanDraftFromCloud(ownerId, projectId, { title: cloud.record.title, document: cloud.record.document }, cloud.record.revision);
  };

  const describe = (status: CloudStatus): string | null => {
    switch (status.kind) {
      case "saved": return null;
      case "conflict": return "มีงานจากอีกเครื่องบันทึกไว้แล้ว เปิดโปรเจกต์เพื่อเลือกว่าจะใช้ฉบับใด";
      case "offline": return "เก็บในเครื่องแล้ว · รอเชื่อมต่อเพื่อบันทึกบน Cloud";
      case "auth": return "เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ";
      case "error": return `บันทึกบน Cloud ไม่สำเร็จ: ${status.message}`;
      case "unavailable": return "ไม่พบโปรเจกต์นี้บน Cloud หรือไม่มีสิทธิ์";
      case "stopped": return "หยุดบันทึกบน Cloud (โปรเจกต์อาจกำลังถูกลบหรือเปลี่ยนบัญชี)";
      case "pending": return "ยังบันทึกบน Cloud ไม่เสร็จ";
      default: return null;
    }
  };

  const resolveRemoteAsset = async (_projectId: string, asset: AssetReference): Promise<Blob | null> => {
    try { return await assets.download(asset); } catch { return null; }
  };

  // ------------------------------------------------------------------ open (plan05 §6)
  const opener: ProjectOpener = async (owner, projectId, access): Promise<OpenedProject> => {
    const [localDraft, persistedJob, deletionJob] = await Promise.all([
      getLocalDraft(owner, projectId), idbSaveJobStore.getSaveJob(owner, projectId), idbDeletionJobStore.get(owner, projectId),
    ]);
    if (!access.writer) {
      if (localDraft) return { draft: localDraft };
      const cloud = await loadCloud(projectId);
      if (cloud.status !== "ok") throw new Error("เปิดแบบอ่านอย่างเดียวไม่ได้: ไม่มีสำเนาในเครื่องและโหลดจาก Cloud ไม่สำเร็จ");
      return { draft: transientDraft(owner, projectId, cloud.record) };
    }
    let cloud: CloudLoadResult = { status: "not-loaded" };
    let decision: OpenDecision = decideOnOpen({ ownerId: owner, projectId, localDraft, persistedJob, deletionJob, cloud });
    let local = localDraft;
    for (let round = 0; round < 4; round++) {
      if (decision.kind === "load-cloud") {
        cloud = await loadCloud(projectId);
      } else if (decision.kind === "resume-job-first") {
        const base = decision.local ?? jobDraft(owner, projectId, decision.job);
        const coordinator = makeCoordinator(projectId, base);
        coordinator.resumePersistedJob(decision.job);
        await coordinator.whenIdle();
        const status = coordinator.getStatus();
        if (status.kind === "conflict" || status.kind === "unavailable") {
          const draft = decision.local ?? base;
          return { draft, createCloud: () => cloudSyncFrom(coordinator) };
        }
        coordinator.stop();
        local = await getLocalDraft(owner, projectId);
        const job = await idbSaveJobStore.getSaveJob(owner, projectId);
        if (job) {
          // Still unacknowledged (offline): keep working locally; the editor's coordinator retries it.
          const draft = local ?? base;
          return { draft, notice: "เปิดจากงานในเครื่อง · รอเชื่อมต่อเพื่อบันทึกบน Cloud", createCloud: (d) => { const next = makeCoordinator(projectId, d); next.resumePersistedJob(job); return cloudSyncFrom(next); } };
        }
      } else break;
      decision = decideOnOpen({ ownerId: owner, projectId, localDraft: local, persistedJob: await idbSaveJobStore.getSaveJob(owner, projectId), deletionJob, cloud });
    }
    // The editor store sets the pendingEdit blocker once it knows whether the recovery applies.
    const startSync = (draft: LocalDraft) => {
      const coordinator = makeCoordinator(projectId, draft);
      coordinator.start();
      return cloudSyncFrom(coordinator);
    };
    switch (decision.kind) {
      case "resume-deletion":
        throw new Error("โปรเจกต์นี้กำลังถูกลบ กลับไปหน้าโปรเจกต์เพื่อลบต่อให้เสร็จ");
      case "use-local-unpublished":
      case "use-local-then-sync":
        return { draft: decision.local, createCloud: startSync };
      case "offline-local":
        return { draft: decision.local, createCloud: startSync, notice: "เปิดจากงานในเครื่อง · ยังเชื่อมต่อ Cloud ไม่ได้" };
      case "use-cloud": {
        const record = decision.record;
        const draft = await putCleanDraftFromCloud(owner, projectId, { title: record.title, document: record.document }, record.revision);
        return { draft, createCloud: startSync };
      }
      case "conflict":
        return { draft: decision.local, createCloud: () => staticSync({ kind: "conflict", currentRevision: decision.currentRevision }) };
      case "schema-paused":
        if (!decision.local) throw new Error("เอกสารบน Cloud ใช้เวอร์ชันใหม่กว่าแอปนี้ กรุณาอัปเดตแอป");
        return { draft: decision.local, createCloud: () => staticSync({ kind: "error", retryable: false, message: "เอกสารบน Cloud ใช้เวอร์ชันใหม่กว่าแอปนี้ จึงหยุดบันทึกบน Cloud ชั่วคราว" }) };
      case "unavailable":
        if (!decision.local) throw new Error("ไม่พบโปรเจกต์นี้ หรือไม่มีสิทธิ์เปิด");
        return { draft: decision.local, createCloud: () => staticSync({ kind: "unavailable" }) };
      case "retry-needed":
        throw new Error("โหลดโปรเจกต์จาก Cloud ไม่สำเร็จ และยังไม่มีสำเนาในเครื่องนี้ ลองใหม่เมื่อเชื่อมต่อได้");
      default:
        throw new Error("เปิดโปรเจกต์ไม่สำเร็จ");
    }
  };

  const service: ProjectService = {
    mode: "cloud",
    ownerId,
    async list() {
      const [drafts, deletions] = await Promise.all([listLocalDrafts(ownerId), idbDeletionJobStore.list(ownerId)]);
      const deleting = new Set(deletions.map((job) => job.projectId));
      const localById = new Map(drafts.map((draft) => [draft.projectId, draft]));
      let warning: string | null = null;
      let cloud: Awaited<ReturnType<typeof repository.list>> = [];
      try { cloud = await repository.list(); }
      catch { warning = "โหลดรายการจาก Cloud ไม่สำเร็จ แสดงเฉพาะงานที่อยู่ในเครื่องนี้"; }
      const cards = new Map<string, ProjectCard>();
      for (const summary of cloud) {
        const draft = localById.get(summary.id);
        cards.set(summary.id, {
          id: summary.id, title: draft?.content.title ?? summary.title,
          updatedAt: draft && draft.savedAt > summary.updatedAt ? draft.savedAt : summary.updatedAt,
          localOnly: false, pendingSync: Boolean(draft && (draft.localSequence !== draft.acknowledgedSequence || draft.pendingEdit)),
          deleting: deleting.has(summary.id), firstSlideId: draft?.content.document.slides[0]?.id ?? null,
          revision: draft?.baseRevision ?? summary.revision,
        });
      }
      for (const draft of drafts) {
        if (cards.has(draft.projectId)) continue;
        // Published drafts missing from a failed/partial list stay visible locally.
        cards.set(draft.projectId, {
          id: draft.projectId, title: draft.content.title, updatedAt: draft.savedAt,
          localOnly: draft.baseRevision === null, pendingSync: draft.localSequence !== draft.acknowledgedSequence || draft.pendingEdit !== null,
          deleting: deleting.has(draft.projectId), firstSlideId: draft.content.document.slides[0]?.id ?? null,
          revision: draft.baseRevision,
        });
      }
      for (const job of deletions) {
        if (!cards.has(job.projectId)) cards.set(job.projectId, { id: job.projectId, title: job.title, updatedAt: job.createdAt, localOnly: false, pendingSync: false, deleting: true, firstSlideId: null, revision: job.expectedRevision });
      }
      return { warning, projects: [...cards.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    },
    async create() {
      // Local draft first, no network; the editor's coordinator reserves and publishes it.
      const id = crypto.randomUUID();
      await createLocalDraft(ownerId, id, createProjectContent());
      return id;
    },
    async rename(projectId, title) {
      await withWriterLock(ownerId, projectId, async () => {
        const draft = await ensureLocalDraft(projectId);
        const content = parseProjectContent({ ...draft.content, title: title.trim() });
        if (content.title !== draft.content.title) {
          await writeDraftContent(ownerId, projectId, { content, localSequence: draft.localSequence + 1, pendingEdit: draft.pendingEdit });
        }
        const status = await syncOnce(projectId);
        const problem = describe(status);
        if (problem) throw new Error(`เปลี่ยนชื่อในเครื่องแล้ว แต่ ${problem}`);
      });
    },
    async duplicate(projectId) {
      // Read-only access to the source: never write its draft without holding its writer lock.
      const local = await getLocalDraft(ownerId, projectId);
      let sourceContent: ProjectContent;
      if (local) sourceContent = local.content;
      else {
        const cloud = await loadCloud(projectId);
        if (cloud.status !== "ok") throw new Error(cloud.status === "missing" ? "ไม่พบโปรเจกต์นี้บน Cloud" : "โหลดโปรเจกต์จาก Cloud ไม่สำเร็จ ลองใหม่อีกครั้ง");
        sourceContent = { title: cloud.record.title, document: cloud.record.document };
      }
      const source = { content: sourceContent };
      const id = crypto.randomUUID();
      const copy = duplicateProjectContent(source.content, { ownerId, projectId: id });
      const blobs = await copyAssetBlobs(ownerId, projectId, copy.assetIdMap, (assetId) => {
        const asset = source.content.document.assets[assetId];
        return asset ? resolveRemoteAsset(projectId, asset) : Promise.resolve(null);
      });
      await createLocalDraft(ownerId, id, copy.content, blobs);
      await withWriterLock(ownerId, id, async () => { await syncOnce(id); });
      return id;
    },
    async remove(projectId, confirmedRevision): Promise<DeleteOutcome> {
      return withWriterLock(ownerId, projectId, async () => {
        let job = await idbDeletionJobStore.get(ownerId, projectId);
        if (!job) {
          const draft = await getLocalDraft(ownerId, projectId);
          const pendingSave = await idbSaveJobStore.getSaveJob(ownerId, projectId);
          if (pendingSave && draft) {
            // Resolve the in-flight save's outcome before tombstoning (plan05 §7 step 1).
            const coordinator = makeCoordinator(projectId, draft);
            coordinator.resumePersistedJob(pendingSave);
            await coordinator.whenIdle();
            coordinator.stop();
          }
          const current = await getLocalDraft(ownerId, projectId);
          // Only delete the revision the user actually saw (local base or the dashboard card); a newer
          // edit from another device makes mark_project_deleted return conflict (plan05 §7 step 3).
          const expectedRevision = current ? current.baseRevision : confirmedRevision ?? null;
          job = createDeletionJob({ ownerId, projectId, expectedRevision, title: current?.content.title ?? "โปรเจกต์" }, { newMutationId: () => crypto.randomUUID(), now: () => Date.now() });
          await idbDeletionJobStore.put(job);
        }
        const outcome = await runDeletion(job, {
          repository, assets, jobs: idbDeletionJobStore,
          waitForInFlightSave: async () => undefined,
          clearLocal: () => deleteLocalProjectData(ownerId, projectId, { keepDeletionJob: true }),
        });
        if (outcome.status === "deleted") return { status: "done" };
        if (outcome.status === "retry") return { status: "pending", message: outcome.reason === "auth" ? "ลบยังไม่เสร็จ: เข้าสู่ระบบอีกครั้งแล้วกดลบต่อ" : "ลบยังไม่เสร็จ: จะลบต่อได้เมื่อเชื่อมต่อ (กด “ลบต่อให้เสร็จ”)" };
        if (outcome.status === "conflict-reload") return { status: "conflict", message: "มีการแก้ไขจากอีกเครื่องหลังจากที่คุณเปิดดู จึงยังไม่ลบ กรุณาเปิดดูฉบับล่าสุดแล้วยืนยันใหม่" };
        throw new Error("ลบโปรเจกต์ไม่สำเร็จ");
      });
    },
    async importArchive(file, signal) {
      const id = crypto.randomUUID();
      const imported = await importArchiveInWorker(file, { ownerId, projectId: id }, { signal });
      await createLocalDraft(ownerId, id, imported.content, imported.blobs);
      return id;
    },
    async thumbnail(projectId, slideId) { return (await getThumbnail(ownerId, projectId, slideId).catch(() => null))?.blob ?? null; },
    opener,
    resolveRemoteAsset,
    cloudUi(projectId, router): CloudUi {
      return {
        async keepLocalCopy() {
          const state = useEditorStore.getState();
          if (!state.flushPendingEdits() || !state.history) return;
          const id = crypto.randomUUID();
          const copy = duplicateProjectContent(state.history.content, { ownerId, projectId: id }, " (สำเนาจากเครื่องนี้)");
          const blobs = await copyAssetBlobs(ownerId, projectId, copy.assetIdMap, (assetId) => {
            const asset = state.history?.content.document.assets[assetId];
            return asset ? resolveRemoteAsset(projectId, asset) : Promise.resolve(null);
          });
          await createLocalDraft(ownerId, id, copy.content, blobs);
          router.push(`/projects/${id}`);
        },
        async useCloudVersion() {
          const cloud = await loadCloud(projectId);
          if (cloud.status !== "ok") { useEditorStore.getState().setNotice("โหลดฉบับ Cloud ไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
          await idbSaveJobStore.deleteSaveJob(ownerId, projectId);
          await putCleanDraftFromCloud(ownerId, projectId, { title: cloud.record.title, document: cloud.record.document }, cloud.record.revision);
          await useEditorStore.getState().reload();
        },
        openLogin() {
          window.dispatchEvent(new CustomEvent("learning-suit:login-required"));
        },
      };
    },
  };
  return service;
}

function transientDraft(ownerId: string, projectId: string, record: ProjectRecord): LocalDraft {
  return {
    localVersion: 1, ownerId, projectId, content: { title: record.title, document: record.document },
    baseRevision: record.revision, localSequence: 0, acknowledgedSequence: 0, pendingEdit: null, savedAt: record.updatedAt,
  };
}
function jobDraft(ownerId: string, projectId: string, job: { content: ProjectContent; localSequence: number; expectedRevision: number }): LocalDraft {
  return {
    localVersion: 1, ownerId, projectId, content: job.content, baseRevision: job.expectedRevision === 0 ? null : job.expectedRevision,
    localSequence: job.localSequence, acknowledgedSequence: 0, pendingEdit: null, savedAt: new Date().toISOString(),
  };
}

