"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { LiveMessage, Participant } from "@/domain/live/protocol";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Message channel of a drawing room (plan 08 §transport). Supabase Realtime broadcast + presence in the cloud;
// a BroadcastChannel between tabs of the same browser in the local development mode (and the e2e tests).
// Large messages (the lesson for a newcomer, an image) travel in chunks.

/** Counters for `?debug=live` (what was sent/received, what the server refused). */
export type LiveStats = { sent: Record<string, number>; received: Record<string, number>; errors: string[]; channel: string; session: () => Record<string, string | number | boolean> };
export const liveStats: LiveStats = { sent: {}, received: {}, errors: [], channel: "-", session: () => ({}) };
const count = (table: Record<string, number>, kind: string) => { table[kind] = (table[kind] ?? 0) + 1; };
const noteError = (text: string) => { liveStats.errors.push(`${new Date().toLocaleTimeString()} ${text}`); if (liveStats.errors.length > 8) liveStats.errors.shift(); };

export interface LiveTransport {
  send(message: LiveMessage): void;
  onMessage(handler: (message: LiveMessage) => void): () => void;
  /** Everyone in the room (including me), updated on join/leave. */
  onPresence(handler: (participants: Participant[]) => void): () => void;
  /** "open" once messages can flow; "error" when the room cannot be reached. */
  onStatus(handler: (status: "open" | "error") => void): () => void;
  close(): void;
}

const CHUNK = 60 * 1024;
type Wire = { m: LiveMessage } | { c: { id: string; i: number; n: number; d: string } };

/** Splits a message that is too large for one broadcast; reassembles on the other side. */
function chunker(emit: (wire: Wire) => void) {
  const parts = new Map<string, { n: number; got: string[]; count: number; at: number }>();
  return {
    send(message: LiveMessage) {
      count(liveStats.sent, message.kind);
      const json = JSON.stringify(message);
      if (json.length <= CHUNK) { emit({ m: message }); return; }
      const id = crypto.randomUUID();
      const n = Math.ceil(json.length / CHUNK);
      for (let i = 0; i < n; i++) emit({ c: { id, i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) } });
    },
    receive(wire: Wire): LiveMessage | null {
      if ("m" in wire) { count(liveStats.received, wire.m.kind); return wire.m; }
      const { id, i, n, d } = wire.c;
      const now = Date.now();
      for (const [key, entry] of parts) if (now - entry.at > 60_000) parts.delete(key);
      const entry = parts.get(id) ?? { n, got: Array<string>(n), count: 0, at: now };
      if (entry.got[i] === undefined) { entry.got[i] = d; entry.count += 1; }
      parts.set(id, entry);
      if (entry.count < entry.n) return null;
      parts.delete(id);
      try { const message = JSON.parse(entry.got.join("")) as LiveMessage; count(liveStats.received, message.kind); return message; } catch { noteError("รวมข้อความไม่สำเร็จ"); return null; }
    },
  };
}

class Listeners<T> {
  private set = new Set<(value: T) => void>();
  add(handler: (value: T) => void) { this.set.add(handler); return () => { this.set.delete(handler); }; }
  emit(value: T) { for (const handler of [...this.set]) handler(value); }
}

function supabaseTransport(roomId: string, me: Participant): LiveTransport {
  const client = getSupabaseBrowserClient();
  const topic = `live:${roomId}`;
  const messages = new Listeners<LiveMessage>(), presence = new Listeners<Participant[]>(), status = new Listeners<"open" | "error">();
  let channel: RealtimeChannel | null = null;
  let joined = false, everOpened = false, closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const queue: Wire[] = [];
  const push = (target: RealtimeChannel, wire: Wire) => {
    void target.send({ type: "broadcast", event: "w", payload: wire }).then((result) => { if (result !== "ok") noteError(`ส่งไม่สำเร็จ: ${result}`); }, (error) => noteError(`ส่งไม่สำเร็จ: ${String(error)}`));
  };
  // Until the room is joined, messages wait (a send before that would go out without us being able to hear replies).
  const chunks = chunker((wire) => { if (channel && joined) push(channel, wire); else queue.push(wire); });

  const connect = async () => {
    // Supabase hands back an existing channel with the same name — e.g. one still closing after the teacher left
    // and came back — and that one never hears anything again. Finish removing it first.
    channel = null;
    joined = false;
    for (const old of client.getChannels().filter((item) => item.topic === `realtime:${topic}`)) await client.removeChannel(old).catch(() => "error");
    if (closed) return;
    // ack: the server confirms each message, so refusals (limits, permissions) show up in `?debug=live`.
    const current = client.channel(topic, { config: { broadcast: { self: false, ack: true }, presence: { key: me.id } } });
    channel = current;
    current.on("broadcast", { event: "w" }, ({ payload }) => {
      const message = chunks.receive(payload as Wire);
      if (message) messages.emit(message);
    });
    current.on("presence", { event: "sync" }, () => {
      const state = current.presenceState<Participant>();
      presence.emit(Object.values(state).flatMap((entries) => entries.slice(0, 1).map(({ id, name, role, color }) => ({ id, name, role, color }))));
    });
    current.subscribe((state, error) => {
      if (channel !== current || closed) return;
      liveStats.channel = state;
      if (state === "SUBSCRIBED") {
        joined = true;
        everOpened = true;
        void current.track(me).then((result) => { if (result !== "ok") noteError(`presence: ${result}`); });
        queue.splice(0).forEach((wire) => push(current, wire));
        status.emit("open");
        return;
      }
      joined = false;
      noteError(`ช่อง ${state}${error ? `: ${error.message}` : ""}`);
      // Lost the room (network, expired sign-in…): join again; only a room never reached counts as an error.
      if (!everOpened && state !== "CLOSED") status.emit("error");
      if (!retry) retry = setTimeout(() => { retry = null; if (!closed) void connect(); }, 3000);
    });
  };
  void connect();

  return {
    send: (message) => chunks.send(message),
    onMessage: (handler) => messages.add(handler),
    onPresence: (handler) => presence.add(handler),
    onStatus: (handler) => status.add(handler),
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (channel) { const last = channel; void last.untrack().finally(() => client.removeChannel(last)); }
    },
  };
}

/** Same protocol between tabs of one browser (local mode): presence by heartbeat. */
function localTransport(roomId: string, me: Participant): LiveTransport {
  liveStats.channel = "local";
  const raw = new BroadcastChannel(`learning-suit-live:${roomId}`);
  let closed = false;
  const channel = { postMessage: (data: unknown) => { if (!closed) raw.postMessage(data); } };
  const messages = new Listeners<LiveMessage>(), presence = new Listeners<Participant[]>(), status = new Listeners<"open" | "error">();
  const seen = new Map<string, { participant: Participant; at: number }>([[me.id, { participant: me, at: Date.now() }]]);
  const chunks = chunker((wire) => channel.postMessage({ type: "w", wire }));
  const publish = () => presence.emit([...seen.values()].map((entry) => entry.participant));
  const beat = () => channel.postMessage({ type: "here", participant: me });
  raw.onmessage = (event: MessageEvent) => {
    const data = event.data as { type: "w"; wire: Wire } | { type: "here"; participant: Participant } | { type: "bye"; id: string } | { type: "who" };
    if (data.type === "w") { const message = chunks.receive(data.wire); if (message) messages.emit(message); return; }
    if (data.type === "who") { beat(); return; }
    if (data.type === "bye") { if (seen.delete(data.id)) publish(); return; }
    const known = seen.has(data.participant.id);
    seen.set(data.participant.id, { participant: data.participant, at: Date.now() });
    if (!known) publish();
  };
  const timer = setInterval(() => {
    beat();
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of seen) if (id !== me.id && now - entry.at > 8000) { seen.delete(id); changed = true; }
    if (changed) publish();
  }, 2000);
  const leave = () => channel.postMessage({ type: "bye", id: me.id });
  window.addEventListener("pagehide", leave);
  setTimeout(() => { if (closed) return; beat(); channel.postMessage({ type: "who" }); publish(); status.emit("open"); }, 0);
  return {
    send: (message) => chunks.send(message),
    onMessage: (handler) => messages.add(handler),
    onPresence: (handler) => presence.add(handler),
    onStatus: (handler) => status.add(handler),
    close: () => { clearInterval(timer); leave(); closed = true; window.removeEventListener("pagehide", leave); raw.close(); },
  };
}

export function openLiveTransport(roomId: string, me: Participant): LiveTransport {
  return supabaseConfigured ? supabaseTransport(roomId, me) : localTransport(roomId, me);
}
