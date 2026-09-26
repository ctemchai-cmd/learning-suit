"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleCheck, KeyRound } from "lucide-react";
import { AuthShell, Notice, PasswordField } from "./auth-shell";
import { MIN_PASSWORD_LENGTH, describeAuthError } from "./auth-messages";

/**
 * Change the signed-in owner's password. The current password is checked first by signing in again,
 * which also counts as the recent login Supabase requires (`secure_password_change`), so no email is needed.
 * There is no "forgot password" and no sign-up: a lost password is reset by an admin (runbook).
 */
export default function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if ([...password].length < MIN_PASSWORD_LENGTH) { setError(`รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`); return; }
    if (password !== confirm) { setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน"); return; }
    if (password === current) { setError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม"); return; }
    setBusy(true); setError(null);
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const auth = getSupabaseBrowserClient().auth;
      const check = await auth.signInWithPassword({ email, password: current });
      if (check.error) { setError(describeAuthError(check.error, "change-password")); return; }
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) setError(describeAuthError(updateError, "change-password"));
      else { setDone(true); setCurrent(""); setPassword(""); setConfirm(""); }
    } catch (thrown) {
      setError(describeAuthError(thrown as { name?: string }, "change-password"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <AuthShell subtitle="เปลี่ยนรหัสผ่าน">
      <div className="space-y-4 text-sm" role="status">
        <p className="flex items-center gap-2 font-semibold text-slate-900"><CircleCheck size={18} className="text-green-600" aria-hidden />เปลี่ยนรหัสผ่านแล้ว</p>
        <p className="muted">ครั้งหน้าเข้าสู่ระบบด้วยรหัสผ่านใหม่นี้</p>
        <button type="button" className="app-button app-button-primary w-full" onClick={() => { router.replace("/projects"); router.refresh(); }}>ไปที่โปรเจกต์</button>
      </div>
    </AuthShell>;
  }
  return <AuthShell subtitle="เปลี่ยนรหัสผ่าน" footer={<Link href="/projects" className="font-medium text-slate-600 hover:underline">ยกเลิก กลับไปหน้าโปรเจกต์</Link>}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="text-sm muted">บัญชี <span className="font-medium text-slate-800">{email}</span></p>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <PasswordField label="รหัสผ่านปัจจุบัน" autoComplete="current-password" value={current} onChange={setCurrent} />
      <PasswordField label="รหัสผ่านใหม่" autoComplete="new-password" value={password} onChange={setPassword} />
      <PasswordField label="ยืนยันรหัสผ่านใหม่" autoComplete="new-password" value={confirm} onChange={setConfirm} />
      <p className="text-xs muted">รหัสผ่านใหม่อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="app-button app-button-primary w-full" disabled={busy}><KeyRound size={16} aria-hidden /> {busy ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}</button>
    </form>
  </AuthShell>;
}
