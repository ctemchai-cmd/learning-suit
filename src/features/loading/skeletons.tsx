import { ArrowLeft, BookOpen } from "lucide-react";

// Loading skeletons (plan 01 §loading): the same shapes as the real screens, so nothing jumps when the content
// arrives. Server-safe (no hooks): used by route `loading.tsx` files and by the client components while they load.

/** One shimmering block. */
export function Bone({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <div aria-hidden className={`${dark ? "skeleton-dark" : "skeleton"} rounded-md ${className}`} />;
}

/** A project card while loading: thumbnail, title, date, button. */
export function ProjectCardSkeleton() {
  return <div className="card p-5" aria-hidden>
    <Bone className="mb-4 aspect-video !rounded-xl" />
    <Bone className="h-5 w-2/3" />
    <Bone className="mt-2 h-3.5 w-2/5" />
    <Bone className="mt-5 h-10 w-full !rounded-[.65rem]" />
  </div>;
}

export function ProjectGridSkeleton({ count = 6 }: { count?: number }) {
  return <div className="loading-reveal grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="กำลังโหลดบทเรียน">
    {Array.from({ length: count }, (_, index) => <ProjectCardSkeleton key={index} />)}
    <span className="sr-only">กำลังโหลดบทเรียน…</span>
  </div>;
}

/** The whole projects page before the app is ready (route loading state). */
export function DashboardSkeleton() {
  return <main className="min-h-dvh">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-slate-900 p-2 text-white"><BookOpen size={22} /></div><div><div className="text-lg font-bold tracking-tight">Learning Suit</div><div className="text-xs muted">พื้นที่เตรียมบทเรียนของคุณ</div></div></div>
      <div className="loading-reveal flex gap-2"><Bone className="h-10 w-24 !rounded-[.65rem]" /><Bone className="h-10 w-36 !rounded-[.65rem]" /></div>
    </div></header>
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8"><h1 className="text-3xl font-bold tracking-tight">โปรเจกต์</h1><p className="muted mt-2">จัดสไลด์และวาดอธิบายได้ในที่เดียว</p></div>
      <ProjectGridSkeleton />
    </div>
  </main>;
}

/**
 * The editor while a lesson opens: top bar, tools and slide list, the empty board grid with a small
 * “opening” label, properties. One shape from the first byte until the lesson is drawn.
 */
export function EditorSkeleton({ label = "กำลังเปิดบทเรียน…" }: { label?: string }) {
  return <div className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-slate-100" role="status" aria-label={label}>
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <div className="grid h-[2.3rem] w-[2.3rem] shrink-0 place-items-center rounded-[.65rem] border border-slate-200 text-slate-400"><ArrowLeft size={18} /></div>
      <div className="loading-reveal min-w-0 flex-1"><Bone className="h-4 w-44" /><Bone className="mt-1.5 h-3 w-24" /></div>
      <div className="loading-reveal flex gap-2">
        {[0, 1].map((key) => <Bone key={key} className="h-[2.3rem] w-[2.3rem] !rounded-[.65rem]" />)}
        <Bone className="hidden h-[2.3rem] w-32 !rounded-[.65rem] lg:block" /><Bone className="hidden h-[2.3rem] w-24 !rounded-[.65rem] lg:block" />
        {[0, 1, 2].map((key) => <Bone key={key} className="h-[2.3rem] w-[2.3rem] !rounded-[.65rem]" />)}
      </div>
    </header>
    <div className="relative flex min-h-0 flex-1">
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-slate-200 bg-white min-[1100px]:flex">
        <div className="border-b border-slate-200 px-3 py-[1.05rem] text-xs font-semibold uppercase tracking-wider text-slate-500">เครื่องมือและสไลด์</div>
        <div className="border-b border-slate-200 p-3">
          <div className="mb-2 text-xs text-slate-500">กดดาวเพื่อปักหมุด · กด 1–8 เลือกเร็ว</div>
          <div className="loading-reveal grid grid-cols-5 gap-2">{Array.from({ length: 15 }, (_, index) => <Bone key={index} className="h-9 !rounded-lg" />)}</div>
          <div className="mt-3 text-xs text-slate-500">เพิ่มตัวจำลอง</div>
          <div className="loading-reveal mt-1 grid grid-cols-4 gap-1.5">{Array.from({ length: 4 }, (_, index) => <Bone key={index} className="h-12 !rounded-lg" />)}</div>
        </div>
        <div className="flex-1 space-y-2 p-3">
          <h2 className="mb-3 text-sm font-semibold">สไลด์</h2>
          {[0, 1, 2].map((key) => <div key={key} className="loading-reveal flex items-center gap-2.5"><Bone className="aspect-[16/10] w-[76px] !rounded" /><div className="flex-1"><Bone className="h-3 w-6" /><Bone className="mt-1.5 h-3.5 w-20" /></div></div>)}
        </div>
      </aside>
      <div className="board-grid relative min-w-0 flex-1">
        <div className="loading-reveal absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600 motion-reduce:animate-none" />
          {label}
        </div>
      </div>
      <aside className="hidden w-[280px] shrink-0 border-l border-slate-200 bg-white min-[1100px]:block">
        <div className="flex border-b border-slate-200 p-2">{["Properties", "Objects", "ตัวจำลอง"].map((tab) => <div key={tab} className="flex-1 py-2 text-center text-sm muted">{tab}</div>)}</div>
        <div className="loading-reveal space-y-4 p-4"><Bone className="h-3 w-40" /><Bone className="h-3 w-24" /><Bone className="h-9 w-full !rounded-[.6rem]" /></div>
      </aside>
    </div>
    <footer className="h-8 shrink-0 border-t border-slate-200 bg-white" />
  </div>;
}
