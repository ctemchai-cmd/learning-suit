import { describe, expect, it } from "vitest";
import { LOGIN_NOTICES, describeAuthError } from "./auth-messages";

describe("Thai messages for Supabase Auth errors", () => {
  it("maps known codes and never shows server text", () => {
    expect(describeAuthError({ code: "invalid_credentials", status: 400 }, "sign-in")).toBe("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    expect(describeAuthError({ code: "invalid_credentials", status: 400 }, "change-password")).toBe("รหัสผ่านปัจจุบันไม่ถูกต้อง");
    expect(describeAuthError({ code: "over_request_rate_limit", status: 429 }, "sign-in")).toContain("รอสักครู่");
    expect(describeAuthError({ code: "weak_password", status: 422 }, "change-password")).toContain("12 ตัวอักษร");
    expect(describeAuthError({ code: "same_password", status: 422 }, "change-password")).toContain("ไม่ซ้ำ");
    expect(describeAuthError({ name: "AuthSessionMissingError", status: 400 }, "change-password")).toContain("เซสชันหมดอายุ");
  });

  it("falls back per step: network, bare 400, unknown", () => {
    expect(describeAuthError({ name: "AuthRetryableFetchError", status: 0 }, "sign-in")).toContain("อินเทอร์เน็ต");
    expect(describeAuthError({ status: 400 }, "sign-in")).toBe("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    expect(describeAuthError({ status: 500, code: "unexpected_failure" }, "change-password")).toBe("เปลี่ยนรหัสผ่านไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(describeAuthError(null, "sign-in")).toBe("เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง");
  });

  it("knows only the notices the app sends", () => {
    expect(Object.keys(LOGIN_NOTICES)).toEqual(["signed-out"]);
  });
});
