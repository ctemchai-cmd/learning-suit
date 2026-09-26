"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { cloudConfigured, localDevMode } from "@/services/runtime";
import { AuthShell, Notice, PasswordField } from "./auth-shell";
import { LOGIN_NOTICES, describeAuthError } from "./auth-messages";

export async function signInWithPassword(email: string, password: string): Promise<{ ownerId: string } | { error: string }> {
  try {
    const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const { data, error } = await getSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return { error: describeAuthError(error, "sign-in") };
    return { ownerId: data.user.id };
  } catch (error) {
    return { error: describeAuthError(error as { name?: string }, "sign-in") };
  }
}

/** Email/password for the owner account created in Supabase; there is no public sign-up. */
export function LoginFields({ onSignedIn, submitLabel = "เข้าสู่ระบบ", autoFocus = false }: {
  onSignedIn: (ownerId: string) => void; submitLabel?: string; autoFocus?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    void signInWithPassword(email, password).then((result) => {
      if ("error" in result) setError(result.error);
      else onSignedIn(result.ownerId);
    }).finally(() => setBusy(false));
  }}>
    <label className="block text-sm">อีเมล<input className="field mt-1" type="email" autoComplete="username" required autoFocus={autoFocus} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <PasswordField label="รหัสผ่าน" autoComplete="current-password" value={password} onChange={setPassword} />
    {error && <Notice tone="error">{error}</Notice>}
    <button className="app-button app-button-primary w-full" disabled={busy}><LogIn size={17} aria-hidden /> {busy ? "กำลังเข้าสู่ระบบ…" : submitLabel}</button>
  </form>;
}

/** `next` is already made safe by the server page; `notice` says why the page was opened. */
export default function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const router = useRouter();
  const message = notice ? LOGIN_NOTICES[notice] : undefined;
  return <AuthShell subtitle="เข้าสู่ระบบบัญชีเจ้าของ" footer="ไม่มีการสมัครสมาชิก บัญชีเจ้าของสร้างไว้ล่วงหน้าใน Supabase">
    {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
    {cloudConfigured
      ? <LoginFields autoFocus onSignedIn={() => { router.replace(next); router.refresh(); }} />
      : <div className="space-y-3 text-sm"><p className="muted">ยังไม่ได้ตั้งค่า Supabase สำหรับ environment นี้</p>
        {localDevMode && <Link className="app-button w-full" href="/projects">ใช้โหมดพัฒนาในเครื่อง</Link>}</div>}
  </AuthShell>;
}
