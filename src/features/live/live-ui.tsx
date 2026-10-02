"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Radio, Users, X } from "lucide-react";
import { worldToScreen } from "@/domain/document/camera";
import type { Camera } from "@/domain/document/session";
import type { CanvasNode } from "@/domain/document/model";
import { getNodeBounds } from "@/domain/document/geometry";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";
import { useEditorStore } from "@/features/editor/store";
import { liveStats } from "@/services/live/transport";
import { closeRoom, followTeacher, lookAtCursor, newRoomId, savedRoomId, startHosting, stopLive } from "./live-session";
import { useLiveStore } from "./live-store";

const roomLink = (roomId: string) => `${window.location.origin}/live/${roomId}`;

/** People in the room; a name with a pointer on the board takes me there (“where is everyone drawing?”). */
function ParticipantList({ onGo }: { onGo?: () => void }) {
  const participants = useLiveStore((state) => state.participants);
  const me = useLiveStore((state) => state.me);
  const cursors = useLiveStore((state) => state.cursors);
  return <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="คนในห้อง">
    {participants.map((participant) => <li key={participant.id} className="flex items-center gap-2 text-sm">
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: participant.color }} />
      {participant.id !== me?.id && cursors[participant.id]
        ? <button type="button" className="truncate text-left underline decoration-dotted underline-offset-2 hover:text-sky-700" title={`ไปดูตรงที่${participant.name}อยู่บนกระดาน`}
          onClick={() => { if (lookAtCursor(participant.id)) onGo?.(); }}>{participant.name}</button>
        : <span className="truncate">{participant.name}</span>}
      {participant.role === "host" && <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">ครู</span>}
      {participant.id === me?.id && <span className="text-xs muted">(ฉัน)</span>}
    </li>)}
  </ul>;
}

/** Teacher: open / share / close the drawing room of this lesson. Resumes an open room after a reload. */
export function LiveButton({ projectId, ownerId, writable }: { projectId: string; ownerId: string; writable: boolean }) {
  const role = useLiveStore((state) => state.role);
  const roomId = useLiveStore((state) => state.roomId);
  const status = useLiveStore((state) => state.status);
  const count = useLiveStore((state) => state.participants.length);
  const history = useEditorStore((state) => Boolean(state.history));
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hosting = role === "host";

  // A reload keeps the room: students reconnect to the same link.
  useEffect(() => {
    const saved = savedRoomId(projectId);
    if (saved && writable && history && !useLiveStore.getState().role) startHosting(saved, "ครู", ownerId, projectId);
  }, [projectId, ownerId, writable, history]);
  // Leaving the lesson (navigation) ends hosting on this page; the saved room id resumes it on return.
  useEffect(() => () => { if (useLiveStore.getState().role === "host") stopLive(); }, []);

  const copy = async () => {
    if (!roomId) return;
    try { await navigator.clipboard.writeText(roomLink(roomId)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ }
  };
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>
      <button type="button" className={`app-button ${hosting ? "!border-green-600 !text-green-700" : ""}`} disabled={!writable && !hosting}
        title={hosting ? `ห้องวาดร่วมเปิดอยู่ · ${count} คน` : "เปิดห้องวาดร่วม: แชร์ลิงก์ให้ผู้เรียนวาดด้วยกันแบบสด"}>
        {hosting ? <Radio size={17} /> : <Users size={17} />}
        <span className="hidden lg:inline">{hosting ? `วาดร่วม · ${count}` : "วาดร่วม"}</span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content !w-[min(480px,calc(100vw-2rem))]">
      <div className="flex items-start justify-between gap-3">
        <Dialog.Title className="text-xl font-semibold">ห้องวาดร่วม</Dialog.Title>
        <Dialog.Close className="app-button icon-button shrink-0" aria-label="ปิด"><X size={16} /></Dialog.Close>
      </div>
      {!hosting ? <>
        <Dialog.Description className="muted mt-2 text-sm leading-relaxed">
          ผู้เรียนเปิดลิงก์แล้ววาด ย้าย และแก้บนบทเรียนนี้ได้พร้อมกันแบบสด (ไม่ต้องมีบัญชี) · การแก้ทั้งหมดบันทึกลงบทเรียนของคุณ ·
          ผู้เรียนจัดการสไลด์ ล็อก/ปลดล็อก และแทรกรูปไม่ได้ · ต้องเปิดหน้านี้ไว้ระหว่างใช้ห้อง
        </Dialog.Description>
        <button type="button" className="app-button app-button-primary mt-5 w-full" disabled={!writable}
          onClick={() => startHosting(newRoomId(), "ครู", ownerId, projectId)}><Radio size={17} /> เปิดห้องและสร้างลิงก์</button>
      </> : <>
        <Dialog.Description className="muted mt-2 text-sm">ส่งลิงก์นี้ให้ผู้เรียน ใครมีลิงก์ก็เข้าได้จนกว่าจะปิดห้อง</Dialog.Description>
        <div className="mt-4 flex gap-2">
          <input className="field font-mono !text-xs" readOnly value={roomId ? roomLink(roomId) : ""} aria-label="ลิงก์ห้องวาดร่วม" onFocus={(event) => event.target.select()} />
          <button type="button" className="app-button shrink-0" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "คัดลอกแล้ว" : "คัดลอก"}</button>
        </div>
        <p className={`mt-3 text-xs ${status === "error" ? "text-red-700" : "muted"}`} role="status">
          {status === "live" ? `เชื่อมต่อแล้ว · ในห้อง ${count} คน` : status === "error" ? "เชื่อมต่อห้องไม่ได้ ตรวจอินเทอร์เน็ตหรือการตั้งค่า Realtime" : "กำลังเชื่อมต่อ…"}
        </p>
        <div className="mt-3 rounded-xl border border-slate-200 p-3"><ParticipantList onGo={() => setOpen(false)} /></div>
        <button type="button" className="app-button mt-5 w-full !border-red-200 !text-red-700"
          onClick={() => { closeRoom(projectId); setOpen(false); }}>ปิดห้อง (ลิงก์ใช้ไม่ได้อีก)</button>
      </>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}

/** Student header: people in the room and “follow the teacher's slide”. */
export function LiveGuestBadge() {
  const count = useLiveStore((state) => state.participants.length);
  const follow = useLiveStore((state) => state.follow);
  const [open, setOpen] = useState(false);
  return <div className="relative flex items-center gap-1">
    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm" title="ดูสไลด์และตำแหน่งบนกระดานเดียวกับครู (เลื่อนจอเองจะเลิกตาม)">
      <input type="checkbox" checked={follow} onChange={(event) => followTeacher(event.target.checked)} />ตามครู
    </label>
    <button type="button" className="app-button" aria-expanded={open} onClick={() => setOpen(!open)} title="คนในห้อง"><Users size={17} /> {count}</button>
    {open && <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"><ParticipantList onGo={() => setOpen(false)} /></div>}
  </div>;
}

/** What other people have selected on this slide: outlined in their colour, their name (and what they are doing) on top. */
export function RemoteSelections({ slideId, nodes, camera }: { slideId: string; nodes: CanvasNode[]; camera: Camera }) {
  const selections = useLiveStore((state) => state.selections);
  const participants = useLiveStore((state) => state.participants);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return <svg aria-hidden className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
    {Object.entries(selections).map(([id, selection]) => {
      const person = participants.find((participant) => participant.id === id);
      const picked = selection.slideId === slideId ? selection.ids.map((nodeId) => byId.get(nodeId)).filter((node): node is CanvasNode => Boolean(node)) : [];
      if (!person || !picked.length) return null;
      const boxes = picked.map((node) => {
        const bounds = getNodeBounds(node, konvaFontMetrics);
        const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, camera);
        return { x: topLeft.x - 3, y: topLeft.y - 3, width: bounds.width * camera.zoom + 6, height: bounds.height * camera.zoom + 6 };
      });
      const left = Math.min(...boxes.map((box) => box.x)), top = Math.min(...boxes.map((box) => box.y));
      const label = `${person.name}${selection.activity === "editing" ? " · กำลังพิมพ์…" : selection.activity === "moving" ? " · กำลังย้าย…" : ""}`;
      return <g key={id} data-testid="remote-selection" data-person={person.name}>
        {boxes.map((box, index) => <rect key={index} {...box} rx={4} fill="none" stroke={person.color} strokeWidth={2} strokeDasharray={selection.activity ? undefined : "6 3"} />)}
        <foreignObject x={left} y={top - 22} width={260} height={20} className="overflow-visible">
          <span className="inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none text-white" style={{ background: person.color }}>{label}</span>
        </foreignObject>
      </g>;
    })}
  </svg>;
}

/** Other people's pointers on this slide (names next to them); stale ones fade out. */
export function RemoteCursors({ slideId, camera }: { slideId: string; camera: Camera }) {
  const cursors = useLiveStore((state) => state.cursors);
  const participants = useLiveStore((state) => state.participants);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(timer); }, []);
  return <>{Object.entries(cursors).map(([id, cursor]) => {
    const person = participants.find((participant) => participant.id === id);
    if (!person || cursor.slideId !== slideId || now - cursor.at > 10_000) return null;
    const at = worldToScreen({ x: cursor.x, y: cursor.y }, camera);
    return <div key={id} aria-hidden className="pointer-events-none absolute z-20 transition-transform duration-100 ease-linear" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
      <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow"><path d="M1 1l5.5 13 2-5.5L14 6.5z" fill={person.color} stroke="#fff" strokeWidth="1.2" /></svg>
      <span className="ml-3 block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: person.color }}>{person.name}</span>
    </div>;
  })}</>;
}

/** `?debug=live`: what the room sent and received, and what the server refused (for diagnosing a room that does not sync). */
export function LiveDebug() {
  const role = useLiveStore((state) => state.role);
  const status = useLiveStore((state) => state.status);
  const participants = useLiveStore((state) => state.participants);
  const [enabled] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "live");
  const [stats, setStats] = useState<{ channel: string; sent: string; received: string; errors: string[]; session: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const counts = (table: Record<string, number>) => Object.entries(table).map(([kind, value]) => `${kind} ${value}`).join(" · ") || "-";
    const read = () => setStats({
      channel: liveStats.channel, sent: counts(liveStats.sent), received: counts(liveStats.received), errors: [...liveStats.errors],
      session: Object.entries(liveStats.session()).map(([key, value]) => `${key}=${String(value)}`).join(" "),
    });
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  if (!enabled || !role || !stats) return null;
  return <div data-board-chrome className="fixed bottom-3 left-3 z-[60] max-w-[min(26rem,calc(100vw-1.5rem))] rounded-lg bg-slate-900/90 p-3 font-mono text-[11px] leading-relaxed text-slate-100 shadow-xl" aria-label="ข้อมูลวินิจฉัยห้องวาดร่วม">
    <div>บทบาท {role} · สถานะ {status} · ช่อง {stats.channel}</div>
    <div>คนในห้อง {participants.map((participant) => `${participant.name}${participant.role === "host" ? "(ครู)" : ""}`).join(", ")}</div>
    <div>{stats.session}</div>
    <div>ส่ง: {stats.sent}</div>
    <div>รับ: {stats.received}</div>
    {stats.errors.length > 0 && <div className="mt-1 text-rose-300">{stats.errors.map((error, index) => <div key={index}>{error}</div>)}</div>}
  </div>;
}
