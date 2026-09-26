"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Info, RotateCcw, SkipForward, Snail, TriangleAlert } from "lucide-react";
import { useFlowSession, type FlowResult } from "./flow-session";

// Clean DOM pieces shared by the flow simulators' panels (plan 07 §2): few words, one control per idea.
// Details live on the board (caption bar); the panel only holds what the teacher presses.

export function PanelHeader({ icon, color, title }: { icon: ReactNode; color: string; title: string }) {
  return <header className="flex items-center gap-2.5">
    <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${color}`}>{icon}</span>
    <h2 className="font-semibold text-slate-900">{title}</h2>
    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">จำลอง</span>
  </header>;
}

/** Lesson step dropdown; the step's one-line description is its tooltip. */
export function StepSelect<V extends string>({ id, value, steps, disabled, onChange }: {
  id: string; value: V; steps: { id: V; label: string; description: string }[]; disabled: boolean; onChange: (value: V) => void;
}) {
  const current = steps.find((item) => item.id === value);
  return <div className="relative">
    <label htmlFor={`${id}-view`} className="sr-only">ขั้นของบทเรียน</label>
    <select id={`${id}-view`} value={value} disabled={disabled} title={current?.description} onChange={(event) => onChange(event.target.value as V)}
      className="w-full appearance-none truncate rounded-xl border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-[13px] font-semibold text-slate-800 outline-none transition-colors hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20">
      {steps.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.label}</option>)}
    </select>
    <ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
  </div>;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">{title}</h3>
      {aside}
    </div>
    {children}
  </section>;
}

/** One choice out of a few (aria-pressed buttons). */
export function Segmented<V extends string | boolean>({ label, value, options, onChange, disabled }: {
  label: string; value: V; options: { value: V; label: string; icon?: ReactNode; tone?: "good" | "bad" }[]; onChange: (value: V) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className="grid gap-1 rounded-xl bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((option) => {
      const active = option.value === value;
      const color = !active ? "text-slate-500 hover:text-slate-800" : option.tone === "good" ? "bg-white text-green-700 shadow-sm" : option.tone === "bad" ? "bg-white text-red-700 shadow-sm" : "bg-white text-slate-900 shadow-sm";
      return <button key={String(option.value)} type="button" aria-pressed={active} disabled={disabled} onClick={() => onChange(option.value)}
        className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${color}`}>
        {option.icon && <span aria-hidden className="shrink-0">{option.icon}</span>}
        <span className="truncate">{option.label}</span>
      </button>;
    })}
  </div>;
}

/** A pressable scenario: icon + short label. `primary` = the thing to try first, `danger` = removes data. */
export function Action({ children, onClick, disabled, icon, primary, danger, count }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; icon?: ReactNode; primary?: boolean; danger?: boolean; count?: number;
}) {
  const tone = primary ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
    : danger ? "border-slate-200 bg-white text-red-700 hover:border-red-200 hover:bg-red-50" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50";
  return <button type="button" disabled={disabled} onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}>
    {icon && <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${primary ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{icon}</span>}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {count !== undefined && <span className={`rounded-full px-1.5 text-[11px] font-semibold ${primary ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{count}</span>}
  </button>;
}

export function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
    <select className="field !py-1.5 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </label>;
}

export function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
    <input className="field !py-1.5 text-sm" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

/** Compact playback bar: continuous / frame by frame, slow toggle; while playing: progress, next, skip, replay. */
export function PlaybackControls({ nodeId }: { nodeId: string }) {
  const play = useFlowSession((s) => s.plays[nodeId]);
  const auto = useFlowSession((s) => s.auto);
  const speed = useFlowSession((s) => s.speed);
  const flow = useFlowSession.getState();
  const busy = play ? play.index < play.frames.length - 1 || play.phase === "moving" : false;
  const canNext = Boolean(play && play.phase === "landed" && play.index < play.frames.length - 1);
  return <div className="space-y-2 rounded-xl bg-slate-50 p-2">
    <div className="flex items-center gap-1.5">
      <div role="group" aria-label="วิธีเล่น" className="grid flex-1 grid-cols-2 gap-1 rounded-lg bg-white p-0.5 shadow-sm">
        {([true, false] as const).map((value) => <button key={String(value)} type="button" aria-pressed={auto === value} onClick={() => flow.setAuto(value)}
          className={`whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] font-semibold ${auto === value ? "bg-slate-900 text-white" : "text-slate-500"}`}>{value ? "ต่อเนื่อง" : "ทีละจังหวะ"}</button>)}
      </div>
      <button type="button" aria-pressed={speed === "slow"} aria-label="เล่นช้า" title="เล่นช้า" onClick={() => flow.setSpeed(speed === "slow" ? "normal" : "slow")}
        className={`grid h-7 w-7 place-items-center rounded-lg ${speed === "slow" ? "bg-slate-900 text-white" : "bg-white text-slate-500 shadow-sm"}`}><Snail size={15} /></button>
    </div>
    {play && <div className="flex items-center gap-1.5">
      <span className="whitespace-nowrap text-[11px] font-medium text-slate-500">จังหวะ {play.index + 1}/{play.frames.length}</span>
      <div aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${((play.index + (play.phase === "landed" ? 1 : 0.5)) / play.frames.length) * 100}%` }} />
      </div>
      {!auto && <button type="button" disabled={!canNext} onClick={() => flow.next(nodeId)}
        className="flex items-center gap-0.5 whitespace-nowrap rounded-lg bg-blue-600 py-1 pl-2 pr-1 text-[11px] font-semibold text-white disabled:opacity-40">ถัดไป<ChevronRight aria-hidden size={13} /></button>}
      <button type="button" aria-label="ข้ามไปจบ" title="ข้ามไปจบ" disabled={!busy} onClick={() => flow.finish(nodeId)}
        className="grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white disabled:opacity-30"><SkipForward size={14} /></button>
      <button type="button" aria-label="เล่นซ้ำ" title="เล่นซ้ำ" onClick={() => flow.replay(nodeId)}
        className="grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white"><RotateCcw size={13} /></button>
    </div>}
  </div>;
}

/** Latest result; sticky so it stays visible at the bottom of the panel. */
export function ResultMessage({ result }: { result: FlowResult | undefined }) {
  const icon = !result ? null
    : result.outcome === "success" ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-600" aria-hidden />
      : result.outcome === "failed" ? <CircleX size={15} className="mt-0.5 shrink-0 text-red-600" aria-hidden />
      : result.outcome === "rejected" ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
        : <Info size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />;
  const tone = !result ? "" : result.outcome === "success" ? "border-green-200 bg-green-50 text-green-900"
    : result.outcome === "failed" ? "border-red-200 bg-red-50 text-red-900"
      : result.outcome === "rejected" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
  return <div aria-live="polite" className={result ? "sticky bottom-0 z-10 -mx-4 bg-white/95 px-4 pb-3 pt-2 backdrop-blur-sm" : ""}>
    {result && <p className={`flex gap-2 rounded-xl border px-3 py-2 text-xs leading-snug shadow-sm ${tone}`}>{icon}<span>{result.message}</span></p>}
  </div>;
}

export function ResetLink({ title, disabled, onClick }: { title: string; disabled: boolean; onClick: () => void }) {
  return <footer className="flex justify-end pt-1">
    <button type="button" disabled={disabled} title={title} onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-700">
      <RotateCcw size={12} />เริ่มใหม่
    </button>
  </footer>;
}
