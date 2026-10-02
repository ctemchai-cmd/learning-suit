"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, LogIn } from "lucide-react";
import { EditorSkeleton } from "@/features/loading/skeletons";
import { useEditorStore } from "@/features/editor/store";
import type { ArchiveExporter } from "@/features/editor/export-dialog";
import { joinRoom, stopLive } from "./live-session";
import { useLiveStore } from "./live-store";

const Editor = dynamic(() => import("@/features/editor/editor"), { ssr: false, loading: () => <EditorSkeleton label="กำลังเข้าห้อง…" /> });
const NAME_KEY = "learning-suit-live-name";
const noExport: ArchiveExporter = async () => { throw new Error("ผู้เรียนส่งออกไฟล์บทเรียนไม่ได้"); };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center p-6"><div className="card w-full max-w-sm p-6">
    <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-slate-900 p-2 text-white"><BookOpen size={20} /></div><h1 className="text-lg font-semibold">{title}</h1></div>
    {children}
  </div></main>;
}

/** Student: name → join → the shared lesson in the editor. */
export default function LiveGuest({ roomId }: { roomId: string }) {
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; } });
  const [joined, setJoined] = useState(false);
  const [left, setLeft] = useState(false);
  const [requestAsset, setRequestAsset] = useState<((assetId: string) => Promise<Blob | null>) | null>(null);
  const status = useLiveStore((state) => state.status);
  const ready = useEditorStore((state) => state.history !== null && state.live?.role === "guest");
  useEffect(() => () => stopLive(), []);

  const guest = useMemo(() => requestAsset && { requestAsset, onLeave: () => { stopLive(); setLeft(true); } }, [requestAsset]);
  const join = () => {
    const clean = [...name.trim()].slice(0, 30).join("");
    if (!clean) return;
    try { localStorage.setItem(NAME_KEY, clean); } catch { /* private mode */ }
    const session = joinRoom(roomId, clean);
    setRequestAsset(() => session.requestAsset);
    setJoined(true);
  };

  if (left) return <Card title="ออกจากห้องแล้ว"><p className="muted text-sm">กดลิงก์ที่ครูส่งให้อีกครั้งเพื่อกลับเข้าห้อง</p></Card>;
  if (!joined) return <Card title="เข้าห้องวาดร่วม">
    <form onSubmit={(event) => { event.preventDefault(); join(); }}>
      <label className="block text-sm">ชื่อของคุณ (เพื่อนในห้องจะเห็นชื่อนี้)
        <input className="field mt-2" autoFocus value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="เช่น ต้น" aria-label="ชื่อของคุณ" />
      </label>
      <button type="submit" className="app-button app-button-primary mt-4 w-full" disabled={!name.trim()}><LogIn size={17} /> เข้าห้อง</button>
    </form>
  </Card>;
  if (status === "closed" && !ready) return <Card title="เข้าห้องไม่ได้"><p className="muted text-sm">ห้องนี้ปิดแล้ว หรือครูยังไม่ได้เปิดหน้าบทเรียน ลองถามครูหรือกดลิงก์อีกครั้งภายหลัง</p></Card>;
  if (status === "error" && !ready) return <Card title="เชื่อมต่อไม่ได้"><p className="muted text-sm">ตรวจอินเทอร์เน็ตแล้วลองโหลดหน้านี้ใหม่</p></Card>;
  if (!ready || !guest) return <EditorSkeleton label="กำลังเข้าห้อง… รอบทเรียนจากครู" />;
  return <>
    <Editor ownerId="live-guest" projectId={roomId} exportArchive={noExport} guest={guest} />
    {status === "closed" && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-6" role="alertdialog" aria-label="ห้องปิดแล้ว">
      <div className="card max-w-sm p-6 text-center"><h2 className="text-lg font-semibold">ครูปิดห้องแล้ว</h2><p className="muted mt-2 text-sm">ขอบคุณที่ร่วมวาด งานทั้งหมดถูกบันทึกในบทเรียนของครู</p></div>
    </div>}
  </>;
}
