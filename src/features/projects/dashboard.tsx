"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Copy, FileUp, FolderOpen, KeyRound, LogOut, MonitorDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { LIMITS } from "@/domain/document/limits";
import { useRuntime } from "@/services/runtime";
import { installApp, useCanInstall } from "@/features/pwa/pwa";
import type { ProjectCard, ProjectService } from "@/services/projects/local-project-service";

function Thumbnail({ service, project }: { service: ProjectService; project: ProjectCard }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!project.firstSlideId) return;
    let active = true;
    let objectUrl: string | null = null;
    void service.thumbnail(project.id, project.firstSlideId).then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [service, project.id, project.firstSlideId, project.updatedAt]);
  return <div className="mb-4 flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
    {url
      // eslint-disable-next-line @next/next/no-img-element -- local object URL of a cached thumbnail
      ? <img src={url} alt="" className="h-full w-full object-contain" />
      : <BookOpen size={28} className="text-slate-400" aria-hidden />}
  </div>;
}

type DialogState = { kind: "rename" | "delete"; project: ProjectCard } | null;

export default function Dashboard() {
  const runtime = useRuntime();
  const router = useRouter();
  const canInstall = useCanInstall();
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const service = runtime.status === "ready" ? runtime.service : null;

  const refresh = useCallback(async () => {
    if (!service) return;
    try {
      const result = await service.list();
      setProjects(result.projects);
      setWarning(result.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดโปรเจกต์ไม่สำเร็จ");
      setProjects([]);
    }
  }, [service]);
  useEffect(() => {
    if (!service) return;
    let active = true;
    void service.list().then((result) => { if (active) { setProjects(result.projects); setWarning(result.warning); } })
      .catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : "โหลดโปรเจกต์ไม่สำเร็จ"); setProjects([]); } });
    return () => { active = false; };
  }, [service]);
  useEffect(() => {
    if (runtime.status === "signed-out") router.replace("/login");
  }, [runtime.status, router]);
  // Signed out (here or in another tab): go to the login page. Another account signed in: reload so the
  // list, drafts and cloud service belong to that account, never mixed with this one.
  useEffect(() => runtime.status === "ready" ? runtime.onAccountChange?.((ownerId) => {
    if (ownerId === null) router.replace("/login?notice=signed-out");
    else window.location.reload();
  }) : undefined, [runtime, router]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ"); }
    finally { setBusy(false); }
  };
  const create = () => service && run(async () => { const id = await service.create(); router.push(`/projects/${id}`); });
  const duplicate = (project: ProjectCard) => service && run(async () => { await service.duplicate(project.id); await refresh(); });
  const importFile = (file: File) => service && run(async () => { const id = await service.importArchive(file); router.push(`/projects/${id}`); });
  const submitDialog = () => {
    if (!service || !dialog) return;
    void run(async () => {
      if (dialog.kind === "rename") {
        const title = name.trim();
        if (!title || [...title].length > LIMITS.titleCodePoints) throw new Error("ชื่อต้องยาว 1–120 ตัวอักษร");
        await service.rename(dialog.project.id, title);
      } else {
        const outcome = await service.remove(dialog.project.id, dialog.project.revision);
        if (outcome.status !== "done") setWarning(outcome.message);
      }
      setDialog(null);
      await refresh();
    });
  };

  const email = runtime.status === "ready" ? runtime.email : null;
  const signOut = runtime.status === "ready" ? runtime.signOut : null;
  return <main className="min-h-screen">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-slate-900 p-2 text-white"><BookOpen size={22} /></div><div><div className="text-lg font-bold tracking-tight">Learning Suit</div><div className="text-xs muted">พื้นที่เตรียมบทเรียนของคุณ</div></div></div>
      {service && <div className="flex flex-wrap items-center gap-2">
        {email && <span className="text-sm muted">{email}</span>}
        {canInstall && <button className="app-button" onClick={() => void installApp()} title="ติดตั้ง Learning Suit เป็นแอปในเครื่องนี้ (เปิดเป็นหน้าต่างของตัวเอง)"><MonitorDown size={16} /> ติดตั้งแอป</button>}
        {signOut && <Link className="app-button" href="/change-password" title="เปลี่ยนรหัสผ่านของบัญชีนี้"><KeyRound size={16} /> เปลี่ยนรหัสผ่าน</Link>}
        {signOut && <button className="app-button" onClick={() => void signOut().then(() => router.replace("/login?notice=signed-out"))} title="ออกจากระบบเฉพาะเบราว์เซอร์นี้ (งานที่ยังไม่ sync เก็บไว้ในเครื่องสำหรับบัญชีนี้)"><LogOut size={16} /> ออกจากระบบ</button>}
        <button className="app-button" disabled={busy} onClick={() => fileInput.current?.click()} title="นำเข้าไฟล์ .learning-suit เป็นโปรเจกต์ใหม่"><FileUp size={17} /> Import</button>
        <button className="app-button app-button-primary" disabled={busy} onClick={() => void create()}><Plus size={18} /> สร้างโปรเจกต์</button>
      </div>}
    </div></header>
    <input ref={fileInput} type="file" accept=".learning-suit,application/zip" hidden aria-label="ไฟล์โปรเจกต์ที่จะนำเข้า"
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8"><h1 className="text-3xl font-bold tracking-tight">โปรเจกต์</h1><p className="muted mt-2">จัดสไลด์และวาดอธิบายได้ในที่เดียว</p></div>
      {(runtime.status === "disabled" || runtime.status === "error") && <div className="card max-w-2xl p-6" role="alert"><h2 className="font-semibold">ยังเปิดใช้งานไม่ได้</h2><p className="muted mt-2">{runtime.message}</p></div>}
      {error && <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700"><span className="flex-1">{error}</span><button aria-label="ปิดข้อความ" onClick={() => setError(null)}><X size={16} /></button></div>}
      {warning && <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{warning}</div>}
      {(runtime.status === "loading" || (service && projects === null)) && <p className="muted">กำลังโหลดโปรเจกต์…</p>}
      {service && projects?.length === 0 && <div className="card flex flex-col items-center px-6 py-20 text-center"><div className="rounded-2xl bg-slate-100 p-5 text-slate-600"><FolderOpen size={36} /></div><h2 className="mt-5 text-xl font-semibold">เริ่มบทเรียนแรก</h2><p className="muted mt-2 max-w-md">สร้างโปรเจกต์ แล้วเพิ่มสไลด์เพื่อวาดแนวคิดระหว่างสอนสด</p><button className="app-button app-button-primary mt-6" disabled={busy} onClick={() => void create()}><Plus size={18} /> สร้างโปรเจกต์</button></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{service && projects?.map((project) => <article className="card group p-5" key={project.id} aria-label={project.title}>
        <Thumbnail service={service} project={project} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="truncate text-lg font-semibold">{project.title}</h2>
            <p className="muted mt-1 text-sm">แก้ไข {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(project.updatedAt))}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {project.deleting && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">กำลังลบ…</span>}
              {service.mode === "cloud" && project.localOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">ยังอยู่ในเครื่อง</span>}
              {service.mode === "cloud" && project.pendingSync && !project.localOnly && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">รอ sync</span>}
              {service.mode === "local" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">เก็บในเครื่อง</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button className="app-button icon-button" aria-label={`เปลี่ยนชื่อ ${project.title}`} title="เปลี่ยนชื่อ" disabled={busy || project.deleting} onClick={() => { setName(project.title); setDialog({ kind: "rename", project }); }}><Pencil size={16} /></button>
            <button className="app-button icon-button" aria-label={`ทำสำเนา ${project.title}`} title="ทำสำเนา" disabled={busy || project.deleting} onClick={() => void duplicate(project)}><Copy size={16} /></button>
            <button className="app-button icon-button" aria-label={`ลบ ${project.title}`} title="ลบ" disabled={busy} onClick={() => setDialog({ kind: "delete", project })}><Trash2 size={16} /></button>
          </div>
        </div>
        {project.deleting
          ? <button className="app-button mt-5 w-full" disabled={busy} onClick={() => setDialog({ kind: "delete", project })}>ลบต่อให้เสร็จ</button>
          : <Link className="app-button mt-5 w-full" href={`/projects/${project.id}`}>เปิดโปรเจกต์</Link>}
      </article>)}</div>
    </div>
    <Dialog.Root open={dialog !== null} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
        <div className="flex items-start justify-between"><Dialog.Title className="text-xl font-semibold">{dialog?.kind === "rename" ? "เปลี่ยนชื่อโปรเจกต์" : "ลบโปรเจกต์"}</Dialog.Title><Dialog.Close className="app-button icon-button" aria-label="ปิด"><X size={18} /></Dialog.Close></div>
        {dialog?.kind === "delete"
          ? <Dialog.Description className="muted mt-4">ลบ “{dialog.project.title}” ทั้งสไลด์และรูปแนบอย่างถาวร การลบทั้งโปรเจกต์ย้อนกลับด้วย Undo ไม่ได้ หากต้องการเก็บไว้ ให้เปิดแล้ว Export ไฟล์โปรเจกต์ก่อน</Dialog.Description>
          : <><Dialog.Description className="muted mt-3">ตั้งชื่อที่จำได้ง่ายสำหรับบทเรียนนี้ (1–120 ตัวอักษร)</Dialog.Description><input className="field mt-4" autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) submitDialog(); }} aria-label="ชื่อโปรเจกต์" /></>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2"><Dialog.Close className="app-button" disabled={busy}>ยกเลิก</Dialog.Close><button className={`app-button ${dialog?.kind === "delete" ? "!border-red-700 !bg-red-700 !text-white" : "app-button-primary"}`} disabled={busy || (dialog?.kind === "rename" && !name.trim())} onClick={submitDialog}>{busy ? "กำลังทำ…" : dialog?.kind === "delete" ? "ลบโปรเจกต์" : "บันทึกชื่อ"}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </main>;
}
