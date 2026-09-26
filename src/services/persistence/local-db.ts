import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AssetReference, ProjectContent, ProjectSummary } from "@/domain/document/model";
import type { Camera, DeletionJob, LocalDraft, PendingEdit, SaveJob } from "@/domain/document/session";
import { parseProjectContent } from "@/domain/document/schema";

// Local repository from docs/plan/05-persistence-security-and-export.md §2.
// Every key starts with ownerId so drafts of different accounts never mix.

export const LOCAL_DB_NAME = "learning-suit";
const LEGACY_DB_NAME = "learning-suit-local-v1";

export type LocalSession = {
  ownerId: string;
  projectId: string;
  activeSlideId: string;
  cameras: Record<string, Camera>;
};
/**
 * Bytes are stored as ArrayBuffer + MIME type rather than Blob: WebKit refuses Blob values in
 * IndexedDB for ephemeral/private sessions, while ArrayBuffers work everywhere.
 */
export type LocalAssetRecord = {
  ownerId: string;
  projectId: string;
  asset: AssetReference;
  bytes: ArrayBuffer;
};
type StoredThumbnail = { bytes: ArrayBuffer; type: string; localSequence: number; updatedAt: string };
export type ThumbnailRecord = { blob: Blob; localSequence: number; updatedAt: string };

type ProjectKey = [string, string];
type AssetKey = [string, string, string];

interface LocalDB extends DBSchema {
  drafts: { key: ProjectKey; value: LocalDraft };
  assets: { key: AssetKey; value: LocalAssetRecord };
  sessions: { key: ProjectKey; value: LocalSession };
  saveJobs: { key: ProjectKey; value: SaveJob };
  deletionJobs: { key: ProjectKey; value: DeletionJob };
  thumbnails: { key: AssetKey; value: StoredThumbnail };
}

/** Local write failed; the document stays in memory and the UI must offer an export backup. */
export class LocalWriteError extends Error {
  constructor(public code: "quota" | "unavailable" | "invalid" | "missing" | "unknown", message: string) {
    super(message);
    this.name = "LocalWriteError";
  }
}

function classify(error: unknown): LocalWriteError {
  if (error instanceof LocalWriteError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") return new LocalWriteError("quota", "พื้นที่เก็บข้อมูลในเครื่องเต็ม");
  if (name === "InvalidStateError" || name === "UnknownError") return new LocalWriteError("unavailable", "เข้าถึงพื้นที่เก็บข้อมูลในเครื่องไม่ได้");
  return new LocalWriteError("unknown", error instanceof Error ? error.message : "เก็บในเครื่องไม่สำเร็จ");
}

const projectRange = (ownerId: string, projectId: string) => IDBKeyRange.bound([ownerId, projectId], [ownerId, projectId, []]);
const ownerRange = (ownerId: string) => IDBKeyRange.bound([ownerId], [ownerId, []]);

let dbPromise: Promise<IDBPDatabase<LocalDB>> | null = null;
export function localDb(): Promise<IDBPDatabase<LocalDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new LocalWriteError("unavailable", "Browser นี้ไม่มี IndexedDB"));
  dbPromise ??= openDB<LocalDB>(LOCAL_DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore("drafts");
      database.createObjectStore("assets");
      database.createObjectStore("sessions");
      database.createObjectStore("saveJobs");
      database.createObjectStore("deletionJobs");
      database.createObjectStore("thumbnails");
    },
  }).catch((error: unknown) => { dbPromise = null; throw classify(error); });
  return dbPromise;
}

// ---------------------------------------------------------------- broadcast

export type LocalBroadcast =
  | { type: "draft"; ownerId: string; projectId: string; localSequence: number }
  | { type: "lock-released"; ownerId: string; projectId: string }
  | { type: "projects-changed"; ownerId: string };

let channel: BroadcastChannel | null = null;
function broadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel("learning-suit");
  return channel;
}
export function broadcast(message: LocalBroadcast): void {
  try { broadcastChannel()?.postMessage(message); } catch { /* Broadcast is best effort. */ }
}
export function subscribeBroadcast(listener: (message: LocalBroadcast) => void): () => void {
  const target = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("learning-suit");
  if (!target) return () => undefined;
  target.onmessage = (event: MessageEvent<LocalBroadcast>) => listener(event.data);
  return () => target.close();
}

// ---------------------------------------------------------------- writer lock (Web Locks API)

export type WriterLock = { key: string; release: () => void };
export const writerLockSupported = () => typeof navigator !== "undefined" && Boolean(navigator.locks);
export const writerLockKey = (ownerId: string, projectId: string) => `learning-suit:${ownerId}:${projectId}`;

/**
 * Exclusive writer lock held for as long as the editor is open. Returns null when another tab
 * holds it. Never steals: the other tab must close its editor first.
 */
export function acquireWriterLock(ownerId: string, projectId: string): Promise<WriterLock | null> {
  if (!writerLockSupported()) return Promise.reject(new LocalWriteError("unavailable", "Browser นี้ไม่รองรับ Web Locks จึงเปิดแก้ไขไม่ได้"));
  const key = writerLockKey(ownerId, projectId);
  return new Promise<WriterLock | null>((resolve, reject) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => { release = done; });
    navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return; }
      let released = false;
      resolve({ key, release: () => { if (released) return; released = true; release(); } });
      await held;
      broadcast({ type: "lock-released", ownerId, projectId });
    }).catch(reject);
  });
}

/** Briefly holds the writer lock to run a dashboard mutation (rename/delete) safely. */
export async function withWriterLock<T>(ownerId: string, projectId: string, run: () => Promise<T>): Promise<T> {
  const lock = await acquireWriterLock(ownerId, projectId);
  if (!lock) throw new LocalWriteError("unavailable", "โปรเจกต์นี้กำลังเปิดแก้ไขอยู่ในอีกแท็บ");
  try { return await run(); } finally { lock.release(); }
}

// ---------------------------------------------------------------- drafts

export function localSummary(draft: LocalDraft): ProjectSummary & { baseRevision: number | null; dirty: boolean } {
  return {
    id: draft.projectId, ownerId: draft.ownerId, title: draft.content.title,
    revision: draft.baseRevision ?? 0, updatedAt: draft.savedAt, createdAt: draft.savedAt,
    baseRevision: draft.baseRevision,
    dirty: draft.localSequence !== draft.acknowledgedSequence || draft.pendingEdit !== null,
  };
}

export async function listLocalDrafts(ownerId: string): Promise<LocalDraft[]> {
  const database = await localDb();
  const drafts = await database.getAll("drafts", ownerRange(ownerId));
  return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getLocalDraft(ownerId: string, projectId: string): Promise<LocalDraft | null> {
  const draft = await (await localDb()).get("drafts", [ownerId, projectId]);
  return draft ?? null;
}

/**
 * Creates a new local draft (baseRevision null) and optional asset blobs in ONE transaction,
 * used by Create, Duplicate, Import and "keep as copy".
 */
export async function createLocalDraft(ownerId: string, projectId: string, content: ProjectContent, blobs: Map<string, Blob> = new Map()): Promise<LocalDraft> {
  parseProjectContent(content);
  for (const assetId of blobs.keys()) {
    if (!content.document.assets[assetId]) throw new LocalWriteError("invalid", `ไม่พบข้อมูลรูป ${assetId}`);
  }
  const now = new Date().toISOString();
  const draft: LocalDraft = {
    localVersion: 1, ownerId, projectId, content,
    baseRevision: null, localSequence: 0, acknowledgedSequence: 0, pendingEdit: null, savedAt: now,
  };
  // Read every blob BEFORE opening the transaction: awaiting non-IDB work would auto-commit it.
  const buffers = await Promise.all([...blobs].map(async ([assetId, blob]) => [assetId, await blob.arrayBuffer()] as const));
  try {
    const database = await localDb();
    const tx = database.transaction(["drafts", "assets"], "readwrite");
    if (await tx.objectStore("drafts").get([ownerId, projectId])) throw new LocalWriteError("invalid", "มีโปรเจกต์นี้ในเครื่องแล้ว");
    const writes: Promise<unknown>[] = [tx.objectStore("drafts").put(draft, [ownerId, projectId])];
    for (const [assetId, bytes] of buffers) {
      writes.push(tx.objectStore("assets").put({ ownerId, projectId, asset: content.document.assets[assetId], bytes }, [ownerId, projectId, assetId]));
    }
    await Promise.all([...writes, tx.done]);
  } catch (error) { throw classify(error); }
  broadcast({ type: "projects-changed", ownerId });
  return draft;
}

/** Replaces the draft with a cloud snapshot that is known to be acknowledged (no local changes). */
export async function putCleanDraftFromCloud(ownerId: string, projectId: string, content: ProjectContent, revision: number): Promise<LocalDraft> {
  parseProjectContent(content);
  try {
    const database = await localDb();
    const tx = database.transaction("drafts", "readwrite");
    const existing = await tx.store.get([ownerId, projectId]);
    const sequence = (existing?.localSequence ?? 0) + 1;
    const draft: LocalDraft = {
      localVersion: 1, ownerId, projectId, content, baseRevision: revision,
      localSequence: sequence, acknowledgedSequence: sequence, pendingEdit: null, savedAt: new Date().toISOString(),
    };
    await Promise.all([tx.store.put(draft, [ownerId, projectId]), tx.done]);
    return draft;
  } catch (error) { throw classify(error); }
}

/**
 * Writes content + sequence (and the current pending edit) in one IndexedDB transaction.
 * baseRevision / acknowledgedSequence are preserved from the stored record.
 */
export async function writeDraftContent(ownerId: string, projectId: string, update: { content: ProjectContent; localSequence: number; pendingEdit: PendingEdit | null }): Promise<LocalDraft> {
  const started = typeof performance === "undefined" ? 0 : performance.now();
  try {
    const database = await localDb();
    const tx = database.transaction("drafts", "readwrite");
    const existing = await tx.store.get([ownerId, projectId]);
    if (!existing) throw new LocalWriteError("missing", "ไม่พบโปรเจกต์ในเครื่อง");
    if (update.localSequence <= existing.localSequence) throw new LocalWriteError("invalid", "ลำดับการเก็บในเครื่องไม่ถูกต้อง");
    const draft: LocalDraft = { ...existing, content: update.content, localSequence: update.localSequence, pendingEdit: update.pendingEdit, savedAt: new Date().toISOString() };
    await Promise.all([tx.store.put(draft, [ownerId, projectId]), tx.done]);
    // User Timing for PERF-03 (local draft write latency); no payload, no document data.
    if (started) performance.measure("learning-suit:local-write", { start: started });
    broadcast({ type: "draft", ownerId, projectId, localSequence: draft.localSequence });
    return draft;
  } catch (error) { throw classify(error); }
}

/** Pending text/Git editor recovery; does not touch content or sequences. */
export async function writePendingEdit(ownerId: string, projectId: string, pendingEdit: PendingEdit | null): Promise<void> {
  try {
    const database = await localDb();
    const tx = database.transaction("drafts", "readwrite");
    const existing = await tx.store.get([ownerId, projectId]);
    if (!existing) throw new LocalWriteError("missing", "ไม่พบโปรเจกต์ในเครื่อง");
    await Promise.all([tx.store.put({ ...existing, pendingEdit }, [ownerId, projectId]), tx.done]);
  } catch (error) { throw classify(error); }
}

/** Removes every local store of a project; the deletion job is kept when a cloud deletion owns it. */
export async function deleteLocalProjectData(ownerId: string, projectId: string, options: { keepDeletionJob?: boolean } = {}): Promise<void> {
  try {
    const database = await localDb();
    const tx = database.transaction(["drafts", "assets", "sessions", "saveJobs", "deletionJobs", "thumbnails"], "readwrite");
    await Promise.all([
      tx.objectStore("drafts").delete([ownerId, projectId]),
      tx.objectStore("sessions").delete([ownerId, projectId]),
      tx.objectStore("saveJobs").delete([ownerId, projectId]),
      options.keepDeletionJob ? Promise.resolve() : tx.objectStore("deletionJobs").delete([ownerId, projectId]),
      tx.objectStore("assets").delete(projectRange(ownerId, projectId)),
      tx.objectStore("thumbnails").delete(projectRange(ownerId, projectId)),
      tx.done,
    ]);
  } catch (error) { throw classify(error); }
  broadcast({ type: "projects-changed", ownerId });
}

// ---------------------------------------------------------------- sessions (device state, never synced)

export async function getLocalSession(ownerId: string, projectId: string): Promise<LocalSession | null> {
  return (await (await localDb()).get("sessions", [ownerId, projectId])) ?? null;
}
export async function putLocalSession(session: LocalSession): Promise<void> {
  await (await localDb()).put("sessions", session, [session.ownerId, session.projectId]);
}

// ---------------------------------------------------------------- assets

export async function putLocalAsset(ownerId: string, projectId: string, asset: AssetReference, blob: Blob): Promise<void> {
  const bytes = await blob.arrayBuffer();
  try { await (await localDb()).put("assets", { ownerId, projectId, asset, bytes }, [ownerId, projectId, asset.id]); }
  catch (error) { throw classify(error); }
}
export async function getLocalAsset(ownerId: string, projectId: string, assetId: string): Promise<Blob | null> {
  const record = await (await localDb()).get("assets", [ownerId, projectId, assetId]);
  return record ? new Blob([record.bytes], { type: record.asset.mimeType }) : null;
}

// ---------------------------------------------------------------- thumbnails (derived cache)

export async function putThumbnail(ownerId: string, projectId: string, slideId: string, record: ThumbnailRecord): Promise<void> {
  const stored: StoredThumbnail = { bytes: await record.blob.arrayBuffer(), type: record.blob.type, localSequence: record.localSequence, updatedAt: record.updatedAt };
  await (await localDb()).put("thumbnails", stored, [ownerId, projectId, slideId]);
}
export async function getThumbnail(ownerId: string, projectId: string, slideId: string): Promise<ThumbnailRecord | null> {
  const stored = await (await localDb()).get("thumbnails", [ownerId, projectId, slideId]);
  return stored ? { blob: new Blob([stored.bytes], { type: stored.type }), localSequence: stored.localSequence, updatedAt: stored.updatedAt } : null;
}

// ---------------------------------------------------------------- save / deletion jobs

export const idbSaveJobStore = {
  async getSaveJob(ownerId: string, projectId: string): Promise<SaveJob | null> {
    return (await (await localDb()).get("saveJobs", [ownerId, projectId])) ?? null;
  },
  async putSaveJob(job: SaveJob): Promise<void> {
    try { await (await localDb()).put("saveJobs", job, [job.ownerId, job.projectId]); }
    catch (error) { throw classify(error); }
  },
  async acknowledge(ownerId: string, projectId: string, ack: { sequence: number; revision: number; mutationId: string }): Promise<void> {
    const database = await localDb();
    const tx = database.transaction(["drafts", "saveJobs"], "readwrite");
    const draft = await tx.objectStore("drafts").get([ownerId, projectId]);
    const job = await tx.objectStore("saveJobs").get([ownerId, projectId]);
    const writes: Promise<unknown>[] = [];
    if (draft) {
      writes.push(tx.objectStore("drafts").put({
        ...draft,
        // Monotonic: a late ack from a stopped coordinator must never move the base backwards.
        baseRevision: Math.max(draft.baseRevision ?? 0, ack.revision),
        acknowledgedSequence: Math.max(draft.acknowledgedSequence, ack.sequence),
      }, [ownerId, projectId]));
    }
    if (job?.mutationId === ack.mutationId) writes.push(tx.objectStore("saveJobs").delete([ownerId, projectId]));
    await Promise.all([...writes, tx.done]);
  },
  async deleteSaveJob(ownerId: string, projectId: string): Promise<void> {
    await (await localDb()).delete("saveJobs", [ownerId, projectId]);
  },
};

export const idbDeletionJobStore = {
  async get(ownerId: string, projectId: string): Promise<DeletionJob | null> {
    return (await (await localDb()).get("deletionJobs", [ownerId, projectId])) ?? null;
  },
  getDeletionJob(ownerId: string, projectId: string): Promise<DeletionJob | null> { return idbDeletionJobStore.get(ownerId, projectId); },
  putDeletionJob(job: DeletionJob): Promise<void> { return idbDeletionJobStore.put(job); },
  deleteDeletionJob(ownerId: string, projectId: string): Promise<void> { return idbDeletionJobStore.delete(ownerId, projectId); },
  async list(ownerId: string): Promise<DeletionJob[]> {
    return (await localDb()).getAll("deletionJobs", ownerRange(ownerId));
  },
  async put(job: DeletionJob): Promise<void> {
    await (await localDb()).put("deletionJobs", job, [job.ownerId, job.projectId]);
  },
  async delete(ownerId: string, projectId: string): Promise<void> {
    await (await localDb()).delete("deletionJobs", [ownerId, projectId]);
  },
};

// ---------------------------------------------------------------- legacy prototype import

/**
 * The first prototype stored drafts in `learning-suit-local-v1` keyed by projectId only.
 * Copy them once under the local development owner so earlier lessons are not lost.
 */
export async function importLegacyPrototypeDrafts(ownerId: string): Promise<number> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return 0;
  const names = (await indexedDB.databases()).map((item) => item.name);
  if (!names.includes(LEGACY_DB_NAME)) return 0;
  type LegacyDraft = { projectId: string; content: unknown; savedAt?: string };
  const legacy = await openDB(LEGACY_DB_NAME);
  let imported = 0;
  try {
    if (!legacy.objectStoreNames.contains("drafts")) return 0;
    const drafts = (await legacy.getAll("drafts")) as LegacyDraft[];
    for (const item of drafts) {
      try {
        const content = parseProjectContent(item.content);
        if (await getLocalDraft(ownerId, item.projectId)) continue;
        await createLocalDraft(ownerId, item.projectId, content);
        imported++;
      } catch { /* Invalid legacy drafts are skipped, never partially imported. */ }
    }
  } finally {
    legacy.close();
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  return imported;
}
