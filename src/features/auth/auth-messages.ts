// Thai copy for Supabase Auth results (sign in, change password). Pure: never echoes server text, so an
// error can't show English internals or hint whether an account exists.

type AuthErrorLike = { name?: string; code?: string | null; status?: number | null } | null | undefined;
export type AuthStep = "sign-in" | "change-password";

const FALLBACK: Record<AuthStep, string> = {
  "sign-in": "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
  "change-password": "เปลี่ยนรหัสผ่านไม่สำเร็จ ลองใหม่อีกครั้ง",
};

export const MIN_PASSWORD_LENGTH = 12; // = supabase/config.toml [auth] minimum_password_length

export function describeAuthError(error: AuthErrorLike, step: AuthStep): string {
  if (!error) return FALLBACK[step];
  if (error.name === "AuthRetryableFetchError") return "เชื่อมต่อระบบบัญชีไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
  switch (error.code) {
    case "invalid_credentials": return step === "change-password" ? "รหัสผ่านปัจจุบันไม่ถูกต้อง" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    case "email_not_confirmed": return "บัญชีนี้ยังไม่ได้ยืนยันอีเมล ให้ผู้ดูแลกดยืนยันใน Supabase ก่อน";
    case "user_banned": return "บัญชีนี้ถูกระงับการใช้งาน";
    case "over_request_rate_limit": return "ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่";
    case "weak_password": return `รหัสผ่านง่ายเกินไป ใช้อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร ผสมตัวอักษรและตัวเลข`;
    case "same_password": return "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม";
    case "session_not_found": case "session_expired": case "reauthentication_needed":
      return "เซสชันหมดอายุ ออกจากระบบแล้วเข้าใหม่ก่อนเปลี่ยนรหัสผ่าน";
  }
  if (error.name === "AuthSessionMissingError") return "เซสชันหมดอายุ ออกจากระบบแล้วเข้าใหม่ก่อนเปลี่ยนรหัสผ่าน";
  if (error.status === 429) return "ลองหลายครั้งเกินไป รอสักครู่แล้วลองใหม่";
  // Older Auth servers answer a wrong password with a bare 400.
  if (error.status === 400 && !error.code) return step === "change-password" ? "รหัสผ่านปัจจุบันไม่ถูกต้อง" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  return FALLBACK[step];
}

/** Why the login page was opened (`/login?notice=…`); unknown values show nothing. */
export const LOGIN_NOTICES: Record<string, { tone: "info" | "warning"; text: string }> = {
  "signed-out": { tone: "info", text: "ออกจากระบบแล้ว งานที่ยังไม่ได้ sync ยังเก็บไว้ในเครื่องนี้สำหรับบัญชีเดิม" },
};
