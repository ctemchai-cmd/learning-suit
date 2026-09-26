import { test, expect } from "playwright/test";
import { createProject, drawRect, objectRows, stageBox } from "./helpers";

test("PST-02: an IndexedDB quota failure shows the local error and the export backup, never 'stored'", async ({ page }) => {
  await createProject(page, "พื้นที่เต็ม");
  // Inject QuotaExceededError into draft writes only (black-box failure injection).
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "drafts" && (window as unknown as { __failDrafts?: boolean }).__failDrafts) throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    (window as unknown as { __failDrafts?: boolean }).__failDrafts = true;
  });
  const box = await stageBox(page);
  await drawRect(page, box.cx - 50, box.cy - 30, box.cx + 50, box.cy + 30);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องไม่สำเร็จ");
  const banner = page.getByRole("alert").filter({ hasText: "พื้นที่ในเครื่องเต็ม" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Export สำรอง" }).click();
  await expect(page.getByRole("dialog", { name: "Export" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Recovery: once writes work again the next transaction stores everything.
  await page.evaluate(() => { (window as unknown as { __failDrafts?: boolean }).__failDrafts = false; });
  await drawRect(page, box.cx + 80, box.cy - 30, box.cx + 140, box.cy + 30);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  await page.reload();
  await expect(await objectRows(page)).toHaveCount(2);
});

test("UX-03: teaching mode hides panels, keeps drawing and slide navigation, and keeps zoom/center", async ({ page }) => {
  await createProject(page, "โหมดสอน");
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.getByRole("combobox", { name: "เลือกสไลด์" }).count().then(() => undefined);
  await page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").first().click();
  await page.getByRole("button", { name: "ซูมเข้า" }).click();
  const zoomLabel = page.getByText(/^125%/);
  await expect(zoomLabel).toBeVisible();
  await page.getByRole("button", { name: "โหมดสอน" }).click();
  await expect(page.getByRole("complementary", { name: "เครื่องมือและสไลด์" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "แผงคุณสมบัติ" })).toHaveCount(0);
  await expect(zoomLabel).toBeVisible();
  // Still draw via the floating favorites.
  await page.getByRole("button", { name: "เครื่องมือโปรด: สี่เหลี่ยม" }).click();
  const box = await stageBox(page);
  await page.mouse.click(box.cx - 40, box.cy - 40);
  await page.mouse.move(box.cx + 40, box.cy + 40);
  await page.mouse.click(box.cx + 40, box.cy + 40);
  await page.getByRole("button", { name: "สไลด์ถัดไป" }).click();
  await expect(page.locator("footer")).toContainText("สไลด์ 2/2");
  await page.keyboard.press("PageUp");
  await expect(page.locator("footer")).toContainText("สไลด์ 1/2");
  // Git/Properties panels open temporarily during teaching.
  await page.getByRole("button", { name: "ตัวจำลอง", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "แผงชั่วคราวระหว่างสอน" })).toBeVisible();
  await page.getByRole("button", { name: "ปิดแผงชั่วคราว" }).click();
  await page.getByRole("button", { name: "ออกจากโหมดสอน" }).click();
  await expect(page.getByRole("complementary", { name: "เครื่องมือและสไลด์" })).toBeVisible();
  await expect(zoomLabel).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(1);
});

test("UX-05: at 1024 px panels collapse to overlays; below 1024 px the editor suggests a computer", async ({ page }) => {
  await createProject(page, "จอแคบ");
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(page.getByRole("button", { name: "ขยายแถบซ้าย" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "แผงคุณสมบัติ" })).toHaveCount(0);
  await page.getByRole("button", { name: "แสดงแผงด้านขวา" }).click();
  await expect(page.getByRole("complementary", { name: "แผงคุณสมบัติ" })).toBeVisible();
  await page.getByRole("button", { name: "ซ่อนแผงด้านขวา" }).click();
  await page.getByRole("button", { name: "ขยายแถบซ้าย" }).click();
  await expect(page.getByRole("button", { name: "เพิ่มสไลด์" })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.getByRole("alertdialog", { name: "หน้าจอแคบเกินไป" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("link", { name: "ไปหน้าโปรเจกต์" }).click();
  await expect(page.getByRole("heading", { name: "โปรเจกต์" })).toBeVisible();
});

test("UX-04: icon buttons have accessible names and the shortcut help dialog traps focus", async ({ page }) => {
  await createProject(page, "การเข้าถึง");
  const unnamed = await page.locator("button").evaluateAll((buttons) => buttons
    .filter((button) => (button as HTMLElement).offsetParent !== null)
    .filter((button) => !(button.getAttribute("aria-label") || button.textContent?.trim() || button.getAttribute("title"))).length);
  expect(unnamed).toBe(0);
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "คีย์ลัด" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Disabled Undo explains itself through its title.
  await expect(page.getByRole("button", { name: "เลิกทำ" })).toHaveAttribute("title", /เลิกทำ/);
});

test("PST-01: refresh right after a transaction restores the same local work", async ({ page }) => {
  await createProject(page, "รีเฟรชทันที");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 50, box.cy - 30, box.cx + 50, box.cy + 30);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  await page.reload();
  await expect(page.getByRole("heading", { name: "รีเฟรชทันที" })).toBeVisible();
  await expect(await objectRows(page)).toHaveText(["rectangle"]);
});
