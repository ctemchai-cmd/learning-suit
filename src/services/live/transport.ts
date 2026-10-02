"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { LiveMessage, Participant } from "@/domain/live/protocol";
import { supabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Message channel of a drawing room (plan 08 §transport). Supabase Realtime broadcast + presence in the cloud;
// a BroadcastChannel between tabs of the same browser in the local development mode (and the e2e tests).
// Large messages (the lesson for a newcomer, an image) travel in chunks.

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
      const json = JSON.stringify(message);
      if (json.length <= CHUNK) { emit({ m: message }); return; }
      const id = crypto.randomUUID();
      const n = Math.ceil(json.length / CHUNK);
      for (let i = 0; i < n; i++) emit({ c: { id, i, n, d: json.slice(i * CHUNK, (i + 1) * CHUNK) } });
    },
    receive(wire: Wire): LiveMessage | null {
      if ("m" in wire) return wire.m;
      const { id, i, n, d } = wire.c;
      const now = Date.now();
      for (const [key, entry] of parts) if (now - entry.at > 60_000) parts.delete(key);
      const entry = parts.get(id) ?? { n, got: Array<string>(n), count: 0, at: now };
      if (entry.got[i] === undefined) { entry.got[i] = d; entry.count += 1; }
      parts.set(id, entry);
      if (entry.count < entry.n) return null;
      parts.delete(id);
      try { return JSON.parse(entry.got.join("")) as LiveMessage; } catch { return null; }
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
  const messages = new Listeners<LiveMessage>(), presence = new Listeners<Participant[]>(), status = new Listeners<"open" | "error">();
  const channel: RealtimeChannel = client.channel(`live:${roomId}`, { config: { broadcast: { self: false, ack: false }, presence: { key: me.id } } });
  const chunks = chunker((wire) => { void channel.send({ type: "broadcast", event: "w", payload: wire }); });
  channel.on("broadcast", { event: "w" }, ({ payload }) => {
    const message = chunks.receive(payload as Wire);
    if (message) messages.emit(message);
  });
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState<Participant>();
    presence.emit(Object.values(state).flatMap((entries) => entries.slice(0, 1).map(({ id, name, role, color }) => ({ id, name, role, color }))));
  });
  channel.subscribe((state) => {
    if (state === "SUBSCRIBED") { void channel.track(me); status.emit("open"); }
    else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") status.emit("error");
  });
  return {
    send: (message) => chunks.send(message),
    onMessage: (handler) => messages.add(handler),
    onPresence: (handler) => presence.add(handler),
    onStatus: (handler) => status.add(handler),
    close: () => { void channel.untrack(); void client.removeChannel(channel); },
  };
}

/** Same protocol between tabs of one browser (local mode): presence by heartbeat. */
function localTransport(roomId: string, me: Participant): LiveTransport {
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
