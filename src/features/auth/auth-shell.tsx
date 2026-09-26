"use client";

import { useId, useState, type ReactNode } from "react";
import { BookOpen, CircleAlert, Eye, EyeOff, Info } from "lucide-react";

// Shared look of the account pages (login, change password): one centered card.

export function AuthShell({ subtitle, children, footer }: { subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center p-6">
    <div className="card w-full max-w-sm p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-slate-900 p-2 text-white"><BookOpen size={22} aria-hidden /></div>
        <div><h1 className="text-lg font-bold">Learning Suit</h1><p className="text-xs muted">{subtitle}</p></div>
      </div>
      {children}
      {footer && <div className="mt-6 text-xs muted">{footer}</div>}
    </div>
  </main>;
}

export function Notice({ tone, children }: { tone: "info" | "warning" | "error"; children: ReactNode }) {
  const style = tone === "info" ? "border-sky-200 bg-sky-50 text-sky-900" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800";
  const Icon = tone === "info" ? Info : CircleAlert;
  return <p role={tone === "error" ? "alert" : "status"} className={`flex gap-2 rounded-lg border px-3 py-2 text-sm leading-snug ${style}`}>
    <Icon size={16} className="mt-0.5 shrink-0" aria-hidden /><span>{children}</span>
  </p>;
}

/** Password input with a show/hide button (the button sits outside the label so it never joins the field's name). */
/** Length rules are checked by the form with a Thai message, not by the browser's own (maybe English) bubble. */
export function PasswordField({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (value: string) => void; autoComplete: "current-password" | "new-password";
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return <div className="text-sm">
    <label htmlFor={id}>{label}</label>
    <div className="relative mt-1">
      <input id={id} className="field pr-11" type={shown ? "text" : "password"} autoComplete={autoComplete} required
        value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[.6rem] text-slate-500 hover:text-slate-800"
        aria-label={shown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={shown} aria-controls={id} onClick={() => setShown(!shown)}>
        {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  </div>;
}
