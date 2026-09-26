import { test, expect } from "playwright/test";

// e2e runs without Supabase env (local development adapter). Only sign in exists: no sign-up and no
// "forgot password" pages. Cloud sign-in is covered by the preview smoke (runbook §4).

test("AUTH-01: sign-in only — local mode link, no sign-up/forgot pages, change password needs an account, login notices", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "ใช้โหมดพัฒนาในเครื่อง" })).toBeVisible();
  await expect(page.getByText(/สมัครสมาชิก$|ลืมรหัสผ่าน/)).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);

  for (const path of ["/forgot-password", "/reset-password", "/auth/confirm", "/signup"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }

  // Change password needs an account: the server answers with a redirect to /login. Checked on the HTTP
  // response, because opening a page the dev server compiles for the first time reloads open tabs.
  const change = await page.request.get("/change-password", { maxRedirects: 0 });
  expect(change.status()).toBe(307);
  expect(change.headers().location).toMatch(/\/login$/);

  await page.goto("/login?notice=signed-out");
  await expect(page.getByRole("status")).toContainText("ออกจากระบบแล้ว");
  await page.goto("/login?notice=%3Cscript%3E");
  await expect(page.getByRole("status")).toHaveCount(0);
});
