"use client";

import { create } from "zustand";
import { commitTransaction, createHistory, redo as redoHistory, undo as undoHistory, type HistoryState } from "@/domain/document/history";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { CanvasNode, ProjectContent, TextNode } from "@/domain/document/model";
import type { Camera, LocalDraft, PendingEdit } from "@/domain/document/session";
import { DEFAULTS } from "@/domain/document/limits";
import { parseProjectContent } from "@/domain/document/schema";
import { withConnectorUpdates } from "@/domain/document/connectors";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";
import {
  acquireWriterLock, getLocalDraft, getLocalSession, LocalWriteError, putLocalSession, subscribeBroadcast,
  writeDraftContent, writePendingEdit, type WriterLock,
} from "@/services/persistence/local-db";
import { readKeepDrawing, readToolDefaults, writeKeepDrawing, writeToolDefaults, type ToolDefaults } from "./tool-defaults";

export type EditorTool = "select" | "hand" | "pen" | "highlighter" | "rectangle" | "ellipse" | "line" | "arrow" | "text" | "image" | "stencil" | "table" | "code" | "eraser" | "laser";
export type LocalStatus = "loading" | "writing" | "stored" | "error";
export type RightPanel = "properties" | "objects" | "git";

/** Cloud save status shown next to the local status (plan01 UI texts). */
export type CloudStatusView =
  | { kind: "pending" }
  | { kind: "saved"; at: string | null }
  | { kind: "offline" }
  | { kind: "error"; retryable: boolean; message: string }
  | { kind: "conflict"; currentRevision: number | null }
  | { kind: "unavailable" }
  | { kind: "auth" }
  | { kind: "stopped" };

/** Adapter over the save coordinator; null in local-only (development fixture) mode. */
export interface CloudSync {
  localWriteAcknowledged(sequence: number, content: ProjectContent): void;
  setBlocked(reason: "pendingEdit" | "gesture", blocked: boolean): void;
  saveNow(): Promise<unknown>;
  retry(): void;
  /** Same owner signed in again after an expired session. */
  authRestored(ownerId: string): void;
  stop(): void;
  getStatus(): CloudStatusView;
  subscribe(listener: (status: CloudStatusView) => void): () => void;
}

export type OpenedProject = {
  draft: LocalDraft;
  /** Created after the writer lock is held; receives the draft that will be edited. */
  createCloud?: (draft: LocalDraft) => CloudSync | null;
  /** Message shown when the project opened from local data while the cloud could not be reached. */
  notice?: string | null;
};
/** Called after the writer lock attempt; a read-only tab must not start network side effects. */
export type ProjectOpener = (ownerId: string, projectId: string, access: { writer: boolean }) => Promise<OpenedProject>;

type PropertyPreview = { slideId: string; nodes: CanvasNode[] } | null;

/**
 * A shared drawing room attached to the editor (plan 08). The host's changes still go through history and are
 * saved as usual, then broadcast; a guest's changes go to the room instead (no storage). Undo/Redo are per person.
 */
export type LiveHooks = {
  role: "host" | "guest";
  /** Guest: show my change and send it; false when it is not allowed or does not apply. */
  guestTransact?: (transaction: DocumentTransaction) => boolean;
  /** Host: my change was applied (before → after). */
  hostCommitted?: (transaction: DocumentTransaction, before: ProjectContent, after: ProjectContent) => void;
  undo: () => void;
  redo: () => void;
};
let liveHooks: LiveHooks | null = null;
export function setLiveHooks(hooks: LiveHooks | null) { liveHooks = hooks; }
export const liveRole = () => liveHooks?.role ?? null;
export type TableEdit = { slideId: string; nodeId: string; row: number; col: number; selectAll?: boolean };
/** Code block being typed in; `draft` = recovered text after a crash, `selectAll` = replace the sample code. */
export type CodeEdit = { slideId: string; nodeId: string; selectAll?: boolean; draft?: string };

type EditorState = {
  ownerId: string | null;
  projectId: string | null;
  history: HistoryState | null;
  activeSlideId: string | null;
  cameras: Record<string, Camera>;
  selectedIds: string[];
  tool: EditorTool;
  toolVersion: number;
  keepDrawing: boolean;
  toolDefaults: ToolDefaults;
  localStatus: LocalStatus;
  localError: string | null;
  loadError: string | null;
  notice: string | null;
  writable: boolean;
  readOnlyReason: "other-tab" | "unsupported" | null;
  cloudStatus: CloudStatusView | null;
  pendingEdit: PendingEdit | null;
  /** Recovered DOM draft after reload; consumed by the text editor / Git panel. */
  recoveredEdit: PendingEdit | null;
  gestureActive: boolean;
  pendingSave: boolean;
  teachingMode: boolean;
  rightPanel: RightPanel | null;
  /** Table cell being typed into (canvas DOM editor); `selectAll` = replace the text when typing starts. */
  tableEdit: TableEdit | null;
  codeEdit: CodeEdit | null;
  /** Shared room: my role and whether I have something to undo/redo (per person). */
  live: { role: "host" | "guest"; canUndo: boolean; canRedo: boolean } | null;
  propertyPreview: PropertyPreview;
  historyEpoch: number;
  /** Size of the visible canvas in CSS px (device state, used to place inserted objects). */
  viewport: { width: number; height: number };
  load: (ownerId: string, projectId: string, opener?: ProjectOpener, force?: boolean) => Promise<void>;
  /** Re-open the current project from storage (e.g. after choosing the cloud version). */
  reload: () => Promise<void>;
  cloudAuthRestored: (ownerId: string) => void;
  /** pagehide (tab closed / bfcache): release the writer lock so another tab can edit. */
  suspendWriter: () => void;
  close: () => Promise<void>;
  /** Deferred close tied to one project; a subsequent load (remount) cancels it. */
  scheduleClose: (projectId: string) => void;
  requestWriter: () => Promise<void>;
  transact: (transaction: DocumentTransaction) => boolean;
  undo: () => void;
  redo: () => void;
  setTool: (tool: EditorTool) => void;
  setKeepDrawing: (keep: boolean) => void;
  setToolDefaults: (update: (current: ToolDefaults) => ToolDefaults) => void;
  /** Returns false when an invalid DOM draft refused the change. */
  setSelectedIds: (ids: string[]) => boolean;
  setCamera: (slideId: string, camera: Camera) => void;
  switchSlide: (slideId: string) => boolean;
  setPendingEdit: (edit: PendingEdit | null) => void;
  consumeRecoveredEdit: () => PendingEdit | null;
  flushPendingEdits: () => boolean;
  registerFlusher: (flush: () => boolean) => () => void;
  setGestureActive: (active: boolean) => void;
  save: () => Promise<void>;
  retryCloud: () => void;
  setNotice: (notice: string | null) => void;
  setTeachingMode: (on: boolean) => void;
  setRightPanel: (panel: RightPanel | null) => void;
  setPropertyPreview: (preview: PropertyPreview) => void;
  setTableEdit: (edit: TableEdit | null) => void;
  setCodeEdit: (edit: CodeEdit | null) => void;
  waitForLocalWrites: () => Promise<void>;
  setViewport: (viewport: { width: number; height: number }) => void;
  setLive: (live: EditorState["live"]) => void;
  /** Guest: open the room's lesson (no storage, no locks). */
  joinLive: (roomId: string, content: ProjectContent, slideId: string | null) => void;
  /** Guest: the room's document changed (others' edits, my confirmed/refused ones). */
  replaceLiveContent: (content: ProjectContent) => void;
  /** Host: apply a validated change from a guest (saved like mine, not on my Undo stack). */
  /** The applied transaction includes connector moves; it is what the room broadcasts. */
  applyRemote: (transaction: DocumentTransaction) => { ok: true; transaction: DocumentTransaction; before: ProjectContent; after: ProjectContent } | { ok: false; message: string };
  leaveLive: () => void;
};

let writeQueue: Promise<void> = Promise.resolve();
let sequence = 0;
let openedEpoch = 0;
let writerLock: WriterLock | null = null;
let cloud: CloudSync | null = null;
let openedProject: (OpenedProject & { opener: ProjectOpener }) | null = null;
let cloudUnsubscribe: (() => void) | null = null;
let broadcastUnsubscribe: (() => void) | null = null;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEditTimer: ReturnType<typeof setTimeout> | null = null;
const flushers = new Set<() => boolean>();
let flushing = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let closing = false;
const historyListeners = new Set<() => void>();

/** Called on Undo/Redo/load so session-only feedback (e.g. Git result text) is cleared. */
export function onHistoryNavigate(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => historyListeners.delete(listener);
}

function localErrorMessage(error: unknown): string {
  if (error instanceof LocalWriteError && error.code === "quota") return "เก็บในเครื่องไม่สำเร็จ: พื้นที่ในเครื่องเต็ม";
  return "เก็บในเครื่องไม่สำเร็จ";
}

/** A recovered text draft is valid only if the document still contains the version it was based on. */
function recoveryStillApplies(edit: PendingEdit, content: ProjectContent): boolean {
  const slide = content.document.slides.find((item) => item.id === edit.slideId);
  if (!slide) return false;
  const node = slide.nodes.find((item) => item.id === edit.nodeId);
  if (edit.kind === "text") {
    if (!edit.before) return !node;
    return Boolean(node && !node.locked && JSON.stringify(node) === JSON.stringify(edit.before));
  }
  if (edit.kind === "code") return Boolean(node && !node.locked && JSON.stringify(node) === JSON.stringify(edit.before));
  if (!node || node.type !== "git-simulator" || node.locked) return false;
  const working = node.state.machines[edit.machine].working;
  return JSON.stringify(working) === JSON.stringify(edit.before);
}

const defaultOpener: ProjectOpener = async (ownerId, projectId) => {
  const draft = await getLocalDraft(ownerId, projectId);
  if (!draft) throw new Error("ไม่พบโปรเจกต์นี้ในเครื่อง");
  return { draft };
};

export const useEditorStore = create<EditorState>((set, get) => {
  const enqueueWrite = (content: ProjectContent) => {
    if (liveHooks?.role === "guest") return;
    const { ownerId, projectId, writable } = get();
    if (!ownerId || !projectId || !writable) return;
    const jobSequence = ++sequence;
    const epoch = openedEpoch;
    set({ localStatus: "writing" });
    writeQueue = writeQueue.then(async () => {
      try {
        await writeDraftContent(ownerId, projectId, { content, localSequence: jobSequence, pendingEdit: get().pendingEdit });
        if (epoch !== openedEpoch) return;
        if (jobSequence === sequence) set({ localStatus: "stored", localError: null });
        cloud?.localWriteAcknowledged(jobSequence, content);
      } catch (error) {
        if (epoch === openedEpoch) set({ localStatus: "error", localError: localErrorMessage(error) });
      }
    });
  };

  const enqueuePendingEditWrite = () => {
    const { ownerId, projectId, writable } = get();
    if (!ownerId || !projectId || !writable) return;
    const epoch = openedEpoch;
    writeQueue = writeQueue.then(async () => {
      try {
        await writePendingEdit(ownerId, projectId, get().pendingEdit);
      } catch (error) {
        if (epoch === openedEpoch) set({ localStatus: "error", localError: localErrorMessage(error) });
      }
    });
  };

  const sanitizeSelection = (history: HistoryState, slideId: string, ids: string[]) => {
    const slide = history.content.document.slides.find((item) => item.id === slideId);
    return ids.filter((id) => slide?.nodes.some((node) => node.id === id && !node.locked));
  };

  const updateHistory = (history: HistoryState, affectedSlideId: string | null, navigated: boolean) => {
    const slides = history.content.document.slides;
    const current = get().activeSlideId;
    const preferred = navigated && affectedSlideId && slides.some((slide) => slide.id === affectedSlideId) ? affectedSlideId : current;
    const nextSlideId = preferred && slides.some((slide) => slide.id === preferred)
      ? preferred
      : affectedSlideId && slides.some((slide) => slide.id === affectedSlideId) ? affectedSlideId : slides[0].id;
    const selectedIds = nextSlideId === current ? sanitizeSelection(history, nextSlideId, get().selectedIds) : [];
    set({ history, activeSlideId: nextSlideId, selectedIds, propertyPreview: null });
    if (navigated) {
      set({ historyEpoch: get().historyEpoch + 1 });
      historyListeners.forEach((listener) => listener());
    }
    enqueueWrite(history.content);
  };

  const persistSession = () => {
    if (liveHooks?.role === "guest") return;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => {
      const { ownerId, projectId, activeSlideId, cameras } = get();
      if (ownerId && projectId && activeSlideId) void putLocalSession({ ownerId, projectId, activeSlideId, cameras }).catch(() => undefined);
    }, 300);
  };

  const attachCloud = (sync: CloudSync | null) => {
    cloudUnsubscribe?.();
    cloud = sync;
    cloudUnsubscribe = sync ? sync.subscribe((status) => set({ cloudStatus: status })) : null;
    set({ cloudStatus: sync ? sync.getStatus() : null });
  };

  const releaseEverything = () => {
    cloudUnsubscribe?.(); cloudUnsubscribe = null;
    cloud?.stop(); cloud = null;
    broadcastUnsubscribe?.(); broadcastUnsubscribe = null;
    writerLock?.release(); writerLock = null;
    if (sessionTimer) clearTimeout(sessionTimer);
    if (pendingEditTimer) clearTimeout(pendingEditTimer);
    sessionTimer = null; pendingEditTimer = null;
    flushers.clear();
  };

  const watchAsReader = (ownerId: string, projectId: string) => {
    broadcastUnsubscribe?.();
    broadcastUnsubscribe = subscribeBroadcast((message) => {
      if (message.type !== "draft" || message.ownerId !== ownerId || message.projectId !== projectId || get().writable) return;
      void getLocalDraft(ownerId, projectId).then((draft) => {
        if (!draft || get().writable || get().projectId !== projectId) return;
        const history = createHistory(draft.content);
        const slides = draft.content.document.slides;
        const activeSlideId = slides.some((slide) => slide.id === get().activeSlideId) ? get().activeSlideId : slides[0].id;
        set({ history, activeSlideId, selectedIds: [] });
      });
    });
  };

  return {
    ownerId: null, projectId: null, history: null, activeSlideId: null, cameras: {}, selectedIds: [],
    tool: "select", toolVersion: 0, keepDrawing: readKeepDrawing(), toolDefaults: readToolDefaults(),
    localStatus: "loading", localError: null, loadError: null, notice: null,
    writable: false, readOnlyReason: null, cloudStatus: null, pendingEdit: null, recoveredEdit: null,
    gestureActive: false, pendingSave: false, teachingMode: false, rightPanel: "properties",
    propertyPreview: null, historyEpoch: 0, viewport: { width: 1024, height: 700 }, tableEdit: null, codeEdit: null, live: null,

    async load(ownerId, projectId, opener = defaultOpener, force = false) {
      // A remount (StrictMode replay or navigation back) cancels the deferred close of the previous mount.
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      if (!force && !closing && get().projectId === projectId && get().ownerId === ownerId && (get().history || get().localStatus === "loading") && !get().loadError) return;
      const epoch = ++openedEpoch;
      closing = false;
      releaseEverything();
      set({
        ownerId, projectId, history: null, activeSlideId: null, selectedIds: [], cameras: {}, localStatus: "loading",
        localError: null, loadError: null, notice: null, writable: false, readOnlyReason: null, cloudStatus: null,
        pendingEdit: null, recoveredEdit: null, pendingSave: false, gestureActive: false, propertyPreview: null, tableEdit: null, codeEdit: null,
      });
      let lock: WriterLock | null = null;
      try {
        let readOnlyReason: EditorState["readOnlyReason"] = null;
        try { lock = await acquireWriterLock(ownerId, projectId); if (!lock) readOnlyReason = "other-tab"; }
        catch { readOnlyReason = "unsupported"; }
        if (epoch !== openedEpoch) { lock?.release(); return; }
        // The opener runs after the lock attempt so only the writer reconciles with the cloud.
        const opened = await opener(ownerId, projectId, { writer: Boolean(lock) });
        openedProject = { ...opened, opener };
        const session = await getLocalSession(ownerId, projectId).catch(() => null);
        if (epoch !== openedEpoch) { lock?.release(); return; }
        const draft = opened.draft;
        // Drafts come from IndexedDB/cloud: validate the whole document once on open (never re-parsed per edit).
        try { parseProjectContent(draft.content); }
        catch { throw new Error("เอกสารนี้ไม่ผ่านการตรวจรูปแบบ (อาจเป็นเวอร์ชันใหม่กว่าแอป) จึงไม่เปิดแก้ไขเพื่อไม่เขียนทับข้อมูล"); }
        writerLock = lock;
        sequence = draft.localSequence;
        writeQueue = Promise.resolve();
        const slides = draft.content.document.slides;
        const activeSlideId = session && slides.some((slide) => slide.id === session.activeSlideId) ? session.activeSlideId : slides[0].id;
        const recovered = lock && draft.pendingEdit && recoveryStillApplies(draft.pendingEdit, draft.content) ? draft.pendingEdit : null;
        set({
          history: createHistory(draft.content), activeSlideId, cameras: session?.cameras ?? {},
          writable: Boolean(lock), readOnlyReason, localStatus: "stored", notice: opened.notice ?? null,
          recoveredEdit: recovered, historyEpoch: get().historyEpoch + 1,
        });
        historyListeners.forEach((listener) => listener());
        if (lock) {
          if (draft.pendingEdit && !recovered) enqueuePendingEditWrite();
          attachCloud(opened.createCloud?.(draft) ?? null);
          // Cloud saves wait only for a recovery that will actually be reopened.
          cloud?.setBlocked("pendingEdit", Boolean(recovered));
        } else {
          watchAsReader(ownerId, projectId);
        }
      } catch (error) {
        if (writerLock !== lock) lock?.release();
        if (epoch === openedEpoch) set({ loadError: error instanceof Error ? error.message : "เปิดโปรเจกต์ไม่สำเร็จ", localStatus: "error" });
      }
    },

    async reload() {
      const { ownerId, projectId } = get();
      if (!ownerId || !projectId) return;
      await get().load(ownerId, projectId, openedProject?.opener ?? defaultOpener, true);
    },
    cloudAuthRestored(ownerId) { cloud?.authRestored(ownerId); },
    suspendWriter() {
      if (!writerLock) return;
      cloudUnsubscribe?.(); cloudUnsubscribe = null;
      cloud?.stop(); cloud = null;
      writerLock.release(); writerLock = null;
      set({ writable: false, readOnlyReason: "other-tab", cloudStatus: null });
    },
    async close() {
      const epoch = ++openedEpoch;
      closing = true;
      try {
        const queue = writeQueue;
        try { await queue; } catch { /* Errors stay visible until navigation. */ }
        if (epoch !== openedEpoch) return;
        releaseEverything();
        set({ projectId: null, ownerId: null, history: null, writable: false, pendingEdit: null, recoveredEdit: null, cloudStatus: null });
      } finally {
        if (epoch === openedEpoch) closing = false;
      }
    },
    scheduleClose(projectId) {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (get().projectId === projectId) void get().close();
      }, 0);
    },

    async requestWriter() {
      const { ownerId, projectId, writable } = get();
      if (!ownerId || !projectId || writable) return;
      // Re-run the full open protocol (lock → reconcile with cloud → resume jobs) instead of
      // reusing the read-only opener result.
      await get().load(ownerId, projectId, openedProject?.opener ?? defaultOpener, true);
      if (get().projectId === projectId && !get().writable && get().readOnlyReason === "other-tab") {
        set({ notice: "ยังมีอีกแท็บเปิดแก้ไขโปรเจกต์นี้อยู่ ปิด editor ในแท็บนั้นก่อนแล้วกดเปิดแก้ไขอีกครั้ง" });
      }
    },
    transact(original) {
      const { history, writable } = get();
      if (!history || !writable) return false;
      // Connectors attached to what this change moves follow in the same transaction (one Undo step).
      const transaction = withConnectorUpdates(history.content, original, konvaFontMetrics);
      if (liveHooks?.role === "guest") return liveHooks.guestTransact?.(transaction) ?? false;
      const started = performance.now();
      const change = commitTransaction(history, transaction);
      performance.measure("learning-suit:transaction", { start: started });
      if (change.result.status === "invalid") { set({ notice: `ทำรายการไม่สำเร็จ: ${change.result.message}` }); return false; }
      if (!change.result.changed) return true;
      updateHistory(change.history, transaction.affectedSlideId, false);
      liveHooks?.hostCommitted?.(transaction, history.content, change.history.content);
      return true;
    },
    undo() {
      if (liveHooks) { if (get().writable && get().flushPendingEdits()) liveHooks.undo(); return; }
      const { history, writable } = get();
      if (!history || !writable || !history.past.length || !get().flushPendingEdits()) return;
      const result = undoHistory(history);
      updateHistory(result.history, result.affectedSlideId, true);
    },
    redo() {
      if (liveHooks) { if (get().writable && get().flushPendingEdits()) liveHooks.redo(); return; }
      const { history, writable } = get();
      if (!history || !writable || !history.future.length || !get().flushPendingEdits()) return;
      const result = redoHistory(history);
      updateHistory(result.history, result.affectedSlideId, true);
    },
    setTool(tool) { set((state) => tool === state.tool ? state : { tool, toolVersion: state.toolVersion + 1 }); },
    setKeepDrawing(keep) { writeKeepDrawing(keep); set({ keepDrawing: keep }); },
    setToolDefaults(update) {
      const next = update(get().toolDefaults);
      writeToolDefaults(next);
      set({ toolDefaults: next });
    },
    setSelectedIds(ids) {
      const { history, activeSlideId, selectedIds } = get();
      const next = history && activeSlideId ? sanitizeSelection(history, activeSlideId, ids) : [];
      if (next.length === selectedIds.length && next.every((id, index) => id === selectedIds[index])) return true;
      // A Git/Text DOM draft belongs to the current selection: flush (or refuse) before changing it.
      if (!get().flushPendingEdits()) return false;
      set({ selectedIds: next, propertyPreview: null });
      return true;
    },
    setCamera(slideId, camera) {
      set((state) => ({ cameras: { ...state.cameras, [slideId]: camera } }));
      persistSession();
    },
    switchSlide(slideId) {
      const state = get();
      if (!state.history?.content.document.slides.some((slide) => slide.id === slideId)) return false;
      if (slideId === state.activeSlideId) return true;
      if (!state.flushPendingEdits()) return false;
      set({ activeSlideId: slideId, selectedIds: [], propertyPreview: null, tableEdit: null, codeEdit: null });
      persistSession();
      return true;
    },
    setPendingEdit(edit) {
      set({ pendingEdit: edit });
      cloud?.setBlocked("pendingEdit", edit !== null);
      if (pendingEditTimer) clearTimeout(pendingEditTimer);
      pendingEditTimer = null;
      if (edit) pendingEditTimer = setTimeout(() => { pendingEditTimer = null; enqueuePendingEditWrite(); }, DEFAULTS.pendingEditDebounceMs);
      else enqueuePendingEditWrite();
    },
    consumeRecoveredEdit() {
      const edit = get().recoveredEdit;
      if (edit) set({ recoveredEdit: null });
      return edit;
    },
    flushPendingEdits() {
      // Re-entrancy guard: a flusher may itself change selection (e.g. select the new text node).
      if (flushing) return true;
      flushing = true;
      try {
        for (const flush of [...flushers]) if (!flush()) return false;
        return true;
      } finally {
        flushing = false;
      }
    },
    registerFlusher(flush) {
      flushers.add(flush);
      return () => flushers.delete(flush);
    },
    setGestureActive(active) {
      if (get().gestureActive === active) return;
      set({ gestureActive: active });
      cloud?.setBlocked("gesture", active);
      if (!active && get().pendingSave) {
        set({ pendingSave: false });
        void get().save();
      }
    },
    async save() {
      if (!get().writable) return;
      if (!get().flushPendingEdits()) return;
      if (get().gestureActive) { set({ pendingSave: true }); return; }
      await get().waitForLocalWrites();
      if (cloud) await cloud.saveNow();
    },
    retryCloud() { cloud?.retry(); },
    setNotice(notice) { set({ notice }); },
    setTeachingMode(on) {
      if (!get().flushPendingEdits()) return;
      set({ teachingMode: on, rightPanel: on ? null : get().rightPanel ?? "properties" });
    },
    setRightPanel(panel) {
      if (panel === get().rightPanel) return;
      if (!get().flushPendingEdits()) return;
      set({ rightPanel: panel });
    },
    setPropertyPreview(preview) { set({ propertyPreview: preview }); },
    setTableEdit(tableEdit) { set({ tableEdit }); },
    setCodeEdit(codeEdit) { set({ codeEdit }); },
    setViewport(viewport) { set({ viewport }); },
    setLive(live) { set({ live }); },
    joinLive(roomId, content, slideId) {
      releaseEverything();
      const slides = content.document.slides;
      set({
        ownerId: "live-guest", projectId: roomId, history: createHistory(content), activeSlideId: slideId && slides.some((slide) => slide.id === slideId) ? slideId : slides[0].id,
        selectedIds: [], localStatus: "stored", localError: null, loadError: null, notice: null, writable: true, readOnlyReason: null, cloudStatus: null,
        pendingEdit: null, recoveredEdit: null, pendingSave: false, gestureActive: false, propertyPreview: null, tableEdit: null, codeEdit: null,
        historyEpoch: get().historyEpoch + 1,
      });
    },
    replaceLiveContent(content) {
      const { history, activeSlideId } = get();
      if (!history || history.content === content) return;
      const next = { content, past: [], future: [] };
      const slides = content.document.slides;
      const slideId = activeSlideId && slides.some((slide) => slide.id === activeSlideId) ? activeSlideId : slides[0].id;
      set({ history: next, activeSlideId: slideId, selectedIds: slideId === activeSlideId ? sanitizeSelection(next, slideId, get().selectedIds) : [] });
    },
    applyRemote(original) {
      const { history, writable } = get();
      if (!history || !writable) return { ok: false, message: "ครูเปิดแบบอ่านอย่างเดียว" };
      const transaction = withConnectorUpdates(history.content, original, konvaFontMetrics);
      const change = commitTransaction(history, transaction);
      if (change.result.status === "invalid") return { ok: false, message: change.result.message };
      if (change.result.changed) updateHistory(change.history, transaction.affectedSlideId, false);
      return { ok: true, transaction, before: history.content, after: change.history.content };
    },
    leaveLive() {
      const guest = liveHooks?.role === "guest";
      liveHooks = null;
      set({ live: null });
      if (guest) set({ history: null, ownerId: null, projectId: null, writable: false });
    },
    async waitForLocalWrites() {
      let queue: Promise<void>;
      do { queue = writeQueue; await queue; } while (queue !== writeQueue);
    },
  };
});

export function selectActiveSlide(state: Pick<EditorState, "history" | "activeSlideId">) {
  return state.history?.content.document.slides.find((slide) => slide.id === state.activeSlideId) ?? null;
}

export type { TextNode };
