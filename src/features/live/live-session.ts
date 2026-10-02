"use client";

import type { DocumentTransaction } from "@/domain/document/commands";
import type { ProjectContent } from "@/domain/document/model";
import { GuestReplica, guestPermission, participantColor, type Participant } from "@/domain/live/protocol";
import { inverseTransaction } from "@/domain/live/selective-undo";
import { getLocalAsset } from "@/services/persistence/local-db";
import { openLiveTransport, type LiveTransport } from "@/services/live/transport";
import { setLiveHooks, useEditorStore } from "@/features/editor/store";
import { useLiveStore } from "./live-store";

// Runs a drawing room for the open editor (plan 08). One instance at a time.

type Step = { label: string; affectedSlideId: string | null; before: ProjectContent; after: ProjectContent };
const UNDO_LIMIT = 100;
const GUEST_OPS_PER_SECOND = 25;
const ROOM_KEY = (projectId: string) => `learning-suit-live-room:${projectId}`;

let active: { transport: LiveTransport; stop: () => void } | null = null;

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
    useLiveStore.getState().set({ participants });
    const ids = new Set(participants.map((participant) => participant.id));
    const cursors = useLiveStore.getState().cursors;
    for (const id of Object.keys(cursors)) if (!ids.has(id)) useLiveStore.getState().setCursor(id, null);
    onChange?.(participants);
  });
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
  useLiveStore.getState().set({ role: "host", roomId, status: "connecting", me, participants: [me], cursors: {} });

  const unsubscribers = [
    transport.onStatus((status) => useLiveStore.getState().set({ status: status === "open" ? "live" : "error" })),
    presenceTracker(transport),
    transport.onMessage((message) => {
      const state = useEditorStore.getState();
      switch (message.kind) {
        case "hello": {
          const content = state.history?.content;
          if (content) transport.send({ kind: "snapshot", to: message.from, epoch, seq, content, slideId: state.activeSlideId, hostName: me.name });
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
    // Students follow the teacher's slide.
    useEditorStore.subscribe((state) => {
      if (state.activeSlideId && state.activeSlideId !== ownPublishedSlide.id) {
        ownPublishedSlide.id = state.activeSlideId;
        transport.send({ kind: "slide", slideId: state.activeSlideId });
      }
    }),
  ];
  active = {
    transport,
    stop: () => { unsubscribers.forEach((unsubscribe) => unsubscribe()); transport.close(); },
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
  const hello = () => transport.send({ kind: "hello", from: me.id, name });
  useLiveStore.getState().set({ role: "guest", roomId, status: "connecting", me, participants: [me], cursors: {} });

  const show = () => { if (replica) useEditorStore.getState().replaceLiveContent(replica.content); };
  const sendPending = () => replica?.pending.forEach((item) => transport.send({ kind: "op", from: me.id, opId: item.opId, transaction: item.transaction }));
  const guestTransact = (transaction: DocumentTransaction): boolean => {
    const store = useEditorStore.getState();
    if (!replica || !hostPresent) { store.setNotice("ยังแก้ไม่ได้: รอครูเชื่อมต่อ"); return false; }
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
      if (status === "open") hello();
      else useLiveStore.getState().set({ status: "error" });
    }),
    presenceTracker(transport, (participants) => {
      const present = participants.some((participant) => participant.role === "host");
      if (present === hostPresent || useLiveStore.getState().status === "closed") return;
      hostPresent = present;
      if (present) hello(); // a returning teacher sends a fresh copy
      if (replica) useLiveStore.getState().set({ status: present ? "live" : "waiting-host" });
      useEditorStore.setState({ writable: present && Boolean(replica) });
    }),
    transport.onMessage((message) => {
      switch (message.kind) {
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
        case "slide":
          if (useLiveStore.getState().follow) useEditorStore.getState().switchSlide(message.slideId);
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
  ];
  // No teacher answer at all: the room is closed or the link is wrong.
  const timeout = setTimeout(() => { if (!replica) useLiveStore.getState().set({ status: "closed" }); }, 15_000);

  active = {
    transport,
    stop: () => { clearTimeout(timeout); unsubscribers.forEach((unsubscribe) => unsubscribe()); transport.close(); },
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

export function stopLive() {
  active?.stop();
  active = null;
  useEditorStore.getState().leaveLive();
  useLiveStore.getState().set({ role: null, roomId: null, status: "connecting", me: null, participants: [], cursors: {} });
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
