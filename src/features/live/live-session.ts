"use client";

import type { DocumentTransaction } from "@/domain/document/commands";
import type { ProjectContent } from "@/domain/document/model";
import { screenToWorld } from "@/domain/document/camera";
import { LIMITS } from "@/domain/document/limits";
import { GuestReplica, guestPermission, participantColor, type LiveMessage, type Participant } from "@/domain/live/protocol";
import { inverseTransaction } from "@/domain/live/selective-undo";
import { getLocalAsset } from "@/services/persistence/local-db";
import { liveStats, openLiveTransport, type LiveTransport } from "@/services/live/transport";
import { setLiveHooks, useEditorStore } from "@/features/editor/store";
import { useLiveStore } from "./live-store";

// Runs a drawing room for the open editor (plan 08). One instance at a time.

type Step = { label: string; affectedSlideId: string | null; before: ProjectContent; after: ProjectContent };
const UNDO_LIMIT = 100;
const GUEST_OPS_PER_SECOND = 25;
const ROOM_KEY = (projectId: string) => `learning-suit-live-room:${projectId}`;

let active: { transport: LiveTransport; stop: () => void; follow?: () => void } | null = null;

type View = Extract<LiveMessage, { kind: "view" }>;

/** What part of the board I am looking at (world units), or null before the board is measured. */
function currentView(): View | null {
  const { activeSlideId, cameras, viewport } = useEditorStore.getState();
  const camera = activeSlideId ? cameras[activeSlideId] : undefined;
  if (!activeSlideId || !camera || viewport.width <= 0 || viewport.height <= 0) return null;
  const centre = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
  const round = (value: number) => Math.round(value * 10) / 10;
  return { kind: "view", slideId: activeSlideId, x: round(centre.x), y: round(centre.y), width: round(viewport.width / camera.zoom), height: round(viewport.height / camera.zoom) };
}

/** Shows the same part of the board on my screen (scaled to fit my screen size). */
function showView(view: View) {
  const store = useEditorStore.getState();
  if (store.activeSlideId !== view.slideId && !store.switchSlide(view.slideId)) return;
  const { viewport } = useEditorStore.getState();
  if (viewport.width <= 0 || viewport.height <= 0 || view.width <= 0 || view.height <= 0) return;
  const zoom = Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, Math.min(viewport.width / view.width, viewport.height / view.height)));
  useEditorStore.getState().setCamera(view.slideId, { zoom, x: viewport.width / 2 - view.x * zoom, y: viewport.height / 2 - view.y * zoom });
}

const newId = () => crypto.randomUUID();
export const newRoomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const savedRoomId = (projectId: string) => { try { return sessionStorage.getItem(ROOM_KEY(projectId)); } catch { return null; } };

/** Per-person Undo/Redo stacks; `record` decides where the next step of mine goes. */
function undoStacks(publish: (canUndo: boolean, canRedo: boolean) => void) {
  const past: Step[] = [], future: Step[] = [];
  let mode: "normal" | "undo" | "redo" = "normal";
  const update = () => publish(past.length > 0, future.length > 0);
  return {
    record(step: Step) {
      if (mode === "undo") future.unshift(step);
      else { past.push(step); if (past.length > UNDO_LIMIT) past.shift(); if (mode === "normal") future.length = 0; }
      update();
    },
    /** Runs the inverse of my latest step through `transact` (which records it on the other stack). */
    run(direction: "undo" | "redo", current: () => ProjectContent | null, transact: (tx: DocumentTransaction) => boolean) {
      const stack = direction === "undo" ? past : future;
      while (stack.length) {
        const step = direction === "undo" ? past.pop()! : future.shift()!;
        const now = current();
        if (!now) return;
        const inverse = inverseTransaction(step.before, step.after, now, direction === "undo" ? `เลิกทำ: ${step.label}` : `ทำซ้ำ: ${step.label}`, step.affectedSlideId);
        if (!inverse) continue; // already gone (someone else changed it back): try the step before
        mode = direction;
        try { if (transact(inverse)) break; } finally { mode = "normal"; }
      }
      update();
    },
  };
}

function setUndoState(canUndo: boolean, canRedo: boolean) {
  const live = useEditorStore.getState().live;
  if (live && (live.canUndo !== canUndo || live.canRedo !== canRedo)) useEditorStore.getState().setLive({ ...live, canUndo, canRedo });
}

function presenceTracker(transport: LiveTransport, onChange?: (participants: Participant[]) => void) {
  return transport.onPresence((participants) => {
    const before = new Set(useLiveStore.getState().participants.map((participant) => participant.id));
    useLiveStore.getState().set({ participants });
    const ids = new Set(participants.map((participant) => participant.id));
    const { cursors, selections } = useLiveStore.getState();
    for (const id of Object.keys(cursors)) if (!ids.has(id)) useLiveStore.getState().setCursor(id, null);
    for (const id of Object.keys(selections)) if (!ids.has(id)) useLiveStore.getState().setSelection(id, null);
    // Someone new: they have not seen what I have selected yet.
    if (participants.some((participant) => !before.has(participant.id))) shareSelection(transport, true);
    onChange?.(participants);
  });
}

/** What I have selected and what I am doing with it (moving, typing). */
function mySelection() {
  const { activeSlideId, selectedIds, gestureActive, pendingEdit, tableEdit, codeEdit } = useEditorStore.getState();
  const editing = tableEdit?.nodeId ?? codeEdit?.nodeId ?? (pendingEdit && "nodeId" in pendingEdit ? pendingEdit.nodeId : null);
  const ids = editing ? [editing] : selectedIds;
  return { slideId: activeSlideId ?? "", ids, activity: editing ? "editing" as const : ids.length && gestureActive ? "moving" as const : null };
}
let sharedSelection = "";
/** Tells the room my selection when it changed (or always, for newcomers). */
function shareSelection(transport: LiveTransport, force = false) {
  const me = useLiveStore.getState().me;
  if (!me) return;
  const selection = mySelection();
  const key = JSON.stringify(selection);
  if (!force && key === sharedSelection) return;
  sharedSelection = key;
  transport.send({ kind: "select", from: me.id, ...selection });
}
/** Keeps the room up to date with my selection (a change goes out within 100 ms). */
function selectionSharer(transport: LiveTransport) {
  sharedSelection = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (state.selectedIds === previous.selectedIds && state.activeSlideId === previous.activeSlideId && state.gestureActive === previous.gestureActive
      && state.pendingEdit === previous.pendingEdit && state.tableEdit === previous.tableEdit && state.codeEdit === previous.codeEdit) return;
    if (timer) return;
    timer = setTimeout(() => { timer = null; shareSelection(transport); }, 100);
  });
  return () => { if (timer) clearTimeout(timer); unsubscribe(); };
}

/** Teacher: opens (or resumes) the room for the project open in the editor. */
export function startHosting(roomId: string, name: string, ownerId: string, projectId: string) {
  stopLive();
  const me: Participant = { id: newId(), name, role: "host", color: "#0F172A" };
  const transport = openLiveTransport(roomId, me);
  const epoch = newId();
  let seq = 0;
  const seenOps: string[] = [];
  const rate = new Map<string, number[]>();
  const stacks = undoStacks(setUndoState);
  try { sessionStorage.setItem(ROOM_KEY(projectId), roomId); } catch { /* private mode */ }

  const broadcast = (transaction: DocumentTransaction, opId: string, author: string) => {
    seq += 1;
    transport.send({ kind: "applied", epoch, seq, opId, author, transaction });
  };
  const ownPublishedSlide = { id: useEditorStore.getState().activeSlideId };

  setLiveHooks({
    role: "host",
    hostCommitted: (transaction, before, after) => {
      stacks.record({ label: transaction.label, affectedSlideId: transaction.affectedSlideId, before, after });
      broadcast(transaction, newId(), me.id);
    },
    undo: () => stacks.run("undo", () => useEditorStore.getState().history?.content ?? null, (tx) => useEditorStore.getState().transact(tx)),
    redo: () => stacks.run("redo", () => useEditorStore.getState().history?.content ?? null, (tx) => useEditorStore.getState().transact(tx)),
  });
  useEditorStore.getState().setLive({ role: "host", canUndo: false, canRedo: false });
  useLiveStore.getState().set({ role: "host", roomId, status: "connecting", me, participants: [me], cursors: {}, selections: {} });

  const unsubscribers = [
    transport.onStatus((status) => useLiveStore.getState().set({ status: status === "open" ? "live" : "error" })),
    presenceTracker(transport),
    selectionSharer(transport),
    transport.onMessage((message) => {
      const state = useEditorStore.getState();
      switch (message.kind) {
        case "hello": {
          const content = state.history?.content;
          if (content) transport.send({ kind: "snapshot", to: message.from, epoch, seq, content, slideId: state.activeSlideId, hostName: me.name });
          const view = currentView();
          if (view) transport.send(view);
          return;
        }
        case "op": {
          if (seenOps.includes(message.opId)) return;
          seenOps.push(message.opId);
          if (seenOps.length > 1000) seenOps.splice(0, 500);
          const now = Date.now();
          const recent = (rate.get(message.from) ?? []).filter((time) => now - time < 1000);
          recent.push(now);
          rate.set(message.from, recent);
          const refusal = recent.length > GUEST_OPS_PER_SECOND ? "ส่งถี่เกินไป" : guestPermission(message.transaction);
          if (refusal) { transport.send({ kind: "reject", to: message.from, opId: message.opId, reason: refusal }); return; }
          const result = state.applyRemote(message.transaction);
          if (!result.ok) { transport.send({ kind: "reject", to: message.from, opId: message.opId, reason: result.message }); return; }
          // The teacher's copy may add connector moves: everyone applies exactly what the teacher applied.
          broadcast(result.transaction, message.opId, message.from);
          return;
        }
        case "cursor":
          useLiveStore.getState().setCursor(message.from, { slideId: message.slideId, x: message.x, y: message.y, at: Date.now() });
          return;
        case "select":
          useLiveStore.getState().setSelection(message.from, { slideId: message.slideId, ids: message.ids.slice(0, 500), activity: message.activity });
          return;
        case "asset-request": {
          const asset = state.history?.content.document.assets[message.assetId];
          if (!asset) { transport.send({ kind: "asset", to: message.from, assetId: message.assetId, mime: "", data: null }); return; }
          void getLocalAsset(ownerId, projectId, message.assetId).catch(() => null).then(async (blob) => {
            const data = blob ? await blobToBase64(blob) : null;
            transport.send({ kind: "asset", to: message.from, assetId: message.assetId, mime: blob?.type ?? asset.mimeType, data });
          });
          return;
        }
        default:
          return;
      }
    }),
    // Students follow the teacher's slide and view.
    useEditorStore.subscribe((state) => {
      if (state.activeSlideId && state.activeSlideId !== ownPublishedSlide.id) {
        ownPublishedSlide.id = state.activeSlideId;
        transport.send({ kind: "slide", slideId: state.activeSlideId });
      }
      scheduleView();
    }),
  ];
  // The view goes out at most ~5 times a second while the teacher scrolls or zooms (the last position always).
  let sentView = "", viewTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleView() {
    if (viewTimer) return;
    viewTimer = setTimeout(() => {
      viewTimer = null;
      const view = currentView();
      const key = JSON.stringify(view);
      if (!view || key === sentView) return;
      sentView = key;
      transport.send(view);
    }, 200);
  }
  // Heartbeat: students know the teacher is here and notice missed changes (they ask for a fresh copy).
  const heartbeat = setInterval(() => transport.send({ kind: "host-alive", epoch, seq }), 4000);
  liveStats.session = () => ({ epoch: epoch.slice(0, 8), seq });
  active = {
    transport,
    stop: () => { clearInterval(heartbeat); if (viewTimer) clearTimeout(viewTimer); unsubscribers.forEach((unsubscribe) => unsubscribe()); transport.close(); },
  };
}

/** Teacher closes the room: students see “closed”, the link stops working. */
export function closeRoom(projectId: string) {
  active?.transport.send({ kind: "closed" });
  try { sessionStorage.removeItem(ROOM_KEY(projectId)); } catch { /* ignore */ }
  stopLive();
}

/** Student: joins a room, waits for the teacher's copy of the lesson, then edits through the room. */
export function joinRoom(roomId: string, name: string) {
  stopLive();
  const me: Participant = { id: newId(), name, role: "guest", color: participantColor(newId()) };
  const transport = openLiveTransport(roomId, me);
  let replica: GuestReplica | null = null;
  let epoch: string | null = null;
  let hostPresent = false;
  const stacks = undoStacks(setUndoState);
  const assetWaiters = new Map<string, ((blob: Blob | null) => void)[]>();
  // At most one request for a fresh copy every 3 s (a large lesson takes a moment to arrive).
  let lastHello = 0;
  const hello = () => { const now = Date.now(); if (now - lastHello < 3000) return; lastHello = now; transport.send({ kind: "hello", from: me.id, name }); };
  useLiveStore.getState().set({ role: "guest", roomId, status: "connecting", me, participants: [me], cursors: {}, selections: {} });

  const show = () => { if (replica) useEditorStore.getState().replaceLiveContent(replica.content); };
  // Where the teacher is (slide and view), to follow it or to go back to it.
  let hostSlide: string | null = null;
  let hostView: View | null = null;
  const follow = () => {
    if (!replica) return;
    if (hostView) showView(hostView);
    else if (hostSlide) useEditorStore.getState().switchSlide(hostSlide);
  };
  // The teacher counts as here when presence lists them OR a teacher message arrived recently (presence can lag).
  let hostInPresence = false;
  let lastHostSignal = 0;
  const refreshHost = () => {
    if (useLiveStore.getState().status === "closed") return;
    const present = hostInPresence || Date.now() - lastHostSignal < 12_000;
    if (present === hostPresent) return;
    hostPresent = present;
    if (present) hello(); // a returning teacher sends a fresh copy
    if (replica) useLiveStore.getState().set({ status: present ? "live" : "waiting-host" });
    useEditorStore.setState({ writable: present && Boolean(replica) });
  };
  const hostTimer = setInterval(refreshHost, 3000);
  liveStats.session = () => ({ epoch: epoch?.slice(0, 8) ?? "-", seq: replica?.seq ?? "-", pending: replica?.pending.length ?? "-", hostPresent, hostInPresence, lastHostSignal: lastHostSignal ? `${Math.round((Date.now() - lastHostSignal) / 1000)} วิ` : "-" });
  const sendPending = () => replica?.pending.forEach((item) => transport.send({ kind: "op", from: me.id, opId: item.opId, transaction: item.transaction }));
  const guestTransact = (transaction: DocumentTransaction): boolean => {
    const store = useEditorStore.getState();
    if (!replica) { store.setNotice("ยังแก้ไม่ได้: รอครูเชื่อมต่อ"); return false; }
    const refusal = guestPermission(transaction);
    if (refusal) { store.setNotice(refusal); return false; }
    const before = replica.content;
    const opId = newId();
    const after = replica.local(opId, transaction);
    if (!after) return true; // nothing changed
    stacks.record({ label: transaction.label, affectedSlideId: transaction.affectedSlideId, before, after });
    transport.send({ kind: "op", from: me.id, opId, transaction });
    show();
    return true;
  };

  setLiveHooks({
    role: "guest",
    guestTransact,
    undo: () => stacks.run("undo", () => replica?.content ?? null, guestTransact),
    redo: () => stacks.run("redo", () => replica?.content ?? null, guestTransact),
  });

  const unsubscribers = [
    transport.onStatus((status) => {
      if (status === "open") { lastHello = 0; hello(); }
      else useLiveStore.getState().set({ status: "error" });
    }),
    selectionSharer(transport),
    presenceTracker(transport, (participants) => {
      hostInPresence = participants.some((participant) => participant.role === "host");
      refreshHost();
    }),
    transport.onMessage((message) => {
      if (message.kind === "snapshot" || message.kind === "applied" || message.kind === "slide" || message.kind === "host-alive") {
        lastHostSignal = Date.now();
        if (!hostPresent) refreshHost();
      }
      switch (message.kind) {
        case "host-alive":
          // A different teacher session, or changes I never received: ask for a fresh copy.
          if (replica && (message.epoch !== epoch || message.seq > replica.seq)) hello();
          return;
        case "snapshot": {
          if (message.to !== me.id) return;
          const first = !replica;
          if (first) {
            replica = new GuestReplica(message.content, message.seq);
            useEditorStore.getState().joinLive(roomId, message.content, message.slideId);
            useEditorStore.getState().setLive({ role: "guest", canUndo: false, canRedo: false });
          } else {
            replica!.reset(message.content, message.seq);
            show();
          }
          epoch = message.epoch;
          if (message.slideId) hostSlide = message.slideId;
          hostPresent = true;
          useEditorStore.setState({ writable: true });
          useLiveStore.getState().set({ status: "live" });
          sendPending();
          return;
        }
        case "applied": {
          if (!replica) return;
          if (message.epoch !== epoch) { hello(); return; }
          const result = replica.applied(message.seq, message.opId, message.transaction);
          if (result === "gap") { hello(); return; }
          if (result === "ok") show();
          return;
        }
        case "reject":
          if (message.to !== me.id || !replica) return;
          replica.rejected(message.opId);
          show();
          useEditorStore.getState().setNotice(`ครูไม่รับการแก้นี้: ${message.reason}`);
          return;
        case "cursor":
          useLiveStore.getState().setCursor(message.from, { slideId: message.slideId, x: message.x, y: message.y, at: Date.now() });
          return;
        case "select":
          useLiveStore.getState().setSelection(message.from, { slideId: message.slideId, ids: message.ids.slice(0, 500), activity: message.activity });
          return;
        case "slide":
          hostSlide = message.slideId;
          if (hostView?.slideId !== message.slideId) hostView = null;
          if (useLiveStore.getState().follow) useEditorStore.getState().switchSlide(message.slideId);
          return;
        case "view":
          hostSlide = message.slideId;
          hostView = message;
          if (useLiveStore.getState().follow) showView(message);
          return;
        case "asset": {
          if (message.to !== me.id) return;
          const waiters = assetWaiters.get(message.assetId) ?? [];
          assetWaiters.delete(message.assetId);
          const blob = message.data ? base64ToBlob(message.data, message.mime) : null;
          waiters.forEach((resolve) => resolve(blob));
          return;
        }
        case "closed":
          useLiveStore.getState().set({ status: "closed" });
          useEditorStore.setState({ writable: false });
          return;
        default:
          return;
      }
    }),
    // My screen size changed (or was measured for the first time): fit the teacher's view again.
    useEditorStore.subscribe((state, previous) => {
      if (state.viewport !== previous.viewport && useLiveStore.getState().follow && hostView) showView(hostView);
    }),
  ];
  // No teacher answer at all: the room is closed or the link is wrong.
  const timeout = setTimeout(() => { if (!replica) useLiveStore.getState().set({ status: "closed" }); }, 15_000);

  active = {
    transport,
    stop: () => { clearTimeout(timeout); clearInterval(hostTimer); unsubscribers.forEach((unsubscribe) => unsubscribe()); transport.close(); },
    follow,
  };
  return {
    /** Images of the lesson come from the teacher's machine. */
    requestAsset(assetId: string): Promise<Blob | null> {
      return new Promise((resolve) => {
        const waiters = assetWaiters.get(assetId) ?? [];
        waiters.push(resolve);
        assetWaiters.set(assetId, waiters);
        if (waiters.length === 1) transport.send({ kind: "asset-request", from: me.id, assetId });
        setTimeout(() => resolve(null), 30_000);
      });
    },
  };
}

/** My pointer on the board (throttled by the caller). Large rooms only share the teacher's pointer. */
export function sendCursor(slideId: string, x: number, y: number) {
  const { me, participants } = useLiveStore.getState();
  if (!active || !me || (me.role === "guest" && participants.length > 12)) return;
  active.transport.send({ kind: "cursor", from: me.id, slideId, x, y });
}

/** Student ticks “follow the teacher” again: jump to the teacher's slide and view. */
export function followTeacher(on: boolean) {
  useLiveStore.getState().set({ follow: on });
  if (on) active?.follow?.();
}

/** I moved the board myself: a student stops following the teacher (tick “ตามครู” to go back). */
export function movedViewMyself() {
  const live = useLiveStore.getState();
  if (live.role !== "guest" || !live.follow) return;
  live.set({ follow: false });
  useEditorStore.getState().setNotice("เลื่อนจอเองแล้ว จึงเลิกตามครู — ติ๊ก “ตามครู” เพื่อกลับไปดูตรงที่ครูดู");
}

/** Centres my screen on someone's pointer (finding a student on the board). */
export function lookAtCursor(participantId: string) {
  const cursor = useLiveStore.getState().cursors[participantId];
  if (!cursor) return false;
  const store = useEditorStore.getState();
  if (store.activeSlideId !== cursor.slideId && !store.switchSlide(cursor.slideId)) return false;
  movedViewMyself();
  const { viewport, cameras } = useEditorStore.getState();
  const zoom = cameras[cursor.slideId]?.zoom ?? 1;
  useEditorStore.getState().setCamera(cursor.slideId, { zoom, x: viewport.width / 2 - cursor.x * zoom, y: viewport.height / 2 - cursor.y * zoom });
  return true;
}

export function stopLive() {
  active?.stop();
  active = null;
  useEditorStore.getState().leaveLive();
  useLiveStore.getState().set({ role: null, roomId: null, status: "connecting", me: null, participants: [], cursors: {}, selections: {} });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}
