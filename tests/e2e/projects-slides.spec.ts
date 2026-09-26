import { test, expect } from "playwright/test";
import { createProject, drawRect, objectRows, readDraft, stageBox } from "./helpers";

test("UX-01: create, rename, duplicate and reopen projects without losing drafts", async ({ page }) => {
  await createProject(page, "บทเรียนต้นฉบับ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 40, box.cx + 60, box.cy + 40);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  const originalUrl = page.url();

  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const card = page.getByRole("article", { name: "บทเรียนต้นฉบับ" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "ทำสำเนา บทเรียนต้นฉบับ" }).click();
  const copy = page.getByRole("article", { name: "บทเรียนต้นฉบับ สำเนา" });
  await expect(copy).toBeVisible();

  await copy.getByRole("button", { name: "เปลี่ยนชื่อ บทเรียนต้นฉบับ สำเนา" }).click();
  await page.getByRole("textbox", { name: "ชื่อโปรเจกต์" }).fill("  บทเรียนสำเนา  ");
  await page.getByRole("button", { name: "บันทึกชื่อ" }).click();
  await expect(page.getByRole("article", { name: "บทเรียนสำเนา" })).toBeVisible();

  await page.getByRole("article", { name: "บทเรียนสำเนา" }).getByRole("link", { name: "เปิดโปรเจกต์" }).click();
  await expect(page.getByRole("heading", { name: "บทเรียนสำเนา" })).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(1);
  const copyDraft = await readDraft(page);
  await page.goto(originalUrl);
  await expect(page.getByRole("heading", { name: "บทเรียนต้นฉบับ" })).toBeVisible();
  const originalDraft = await readDraft(page);
  // The copy owns new slide/node IDs (no shared references with the source).
  expect(copyDraft?.content.document.slides[0].id).not.toBe(originalDraft?.content.document.slides[0].id);
  expect(copyDraft?.content.document.slides[0].nodes[0].id).not.toBe(originalDraft?.content.document.slides[0].nodes[0].id);

  await page.reload();
  await expect(page.getByRole("heading", { name: "บทเรียนต้นฉบับ" })).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(1);
});

test("UX-02: slides add/rename/reorder/duplicate/delete with Undo; the last slide cannot be deleted", async ({ page }) => {
  await createProject(page, "จัดสไลด์");
  const deleteButton = page.getByRole("button", { name: "ลบสไลด์" });
  await expect(deleteButton).toBeDisabled();
  await expect(page.getByText("ต้องมีอย่างน้อยหนึ่งสไลด์ จึงลบสไลด์สุดท้ายไม่ได้")).toBeVisible();

  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  const slideItems = page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem");
  await expect(slideItems).toHaveText([/สไลด์ 1/, /สไลด์ 2/, /สไลด์ 3/]);

  await page.getByRole("button", { name: "เปลี่ยนชื่อสไลด์" }).click();
  await page.getByRole("textbox", { name: "ชื่อสไลด์" }).fill("สรุป");
  await page.getByRole("button", { name: "บันทึกชื่อ" }).click();
  await expect(slideItems).toHaveText([/สไลด์ 1/, /สไลด์ 2/, /สรุป/]);

  await page.getByRole("button", { name: "เลื่อนสไลด์ขึ้น" }).click();
  await expect(slideItems).toHaveText([/สไลด์ 1/, /สรุป/, /สไลด์ 2/]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(slideItems).toHaveText([/สไลด์ 1/, /สไลด์ 2/, /สรุป/]);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect(slideItems).toHaveText([/สไลด์ 1/, /สรุป/, /สไลด์ 2/]);

  // Drag reorder: move "สไลด์ 2" to the top.
  await slideItems.nth(2).dragTo(slideItems.nth(0));
  await expect(slideItems).toHaveText([/สไลด์ 2/, /สไลด์ 1/, /สรุป/]);

  await slideItems.nth(1).click();
  await page.getByRole("button", { name: "ทำสำเนาสไลด์" }).click();
  await expect(slideItems).toHaveText([/สไลด์ 2/, /สไลด์ 1/, /สไลด์ 1 สำเนา/, /สรุป/]);
  await expect(page.locator("footer")).toContainText("สไลด์ 1 สำเนา");

  await deleteButton.click();
  await page.getByRole("dialog").getByRole("button", { name: "ลบสไลด์" }).click();
  await expect(slideItems).toHaveCount(3);
  // plan01: after deleting, the next slide is opened.
  await expect(page.locator("footer")).toContainText("สรุป");
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(slideItems).toHaveCount(4);
  await expect(page.locator("footer")).toContainText("สไลด์ 1 สำเนา");

  await page.reload();
  await expect(slideItems).toHaveText([/สไลด์ 2/, /สไลด์ 1/, /สไลด์ 1 สำเนา/, /สรุป/]);
});

test("dashboard delete asks for confirmation and removes the local draft", async ({ page }) => {
  await createProject(page, "จะลบทิ้ง");
  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  const card = page.getByRole("article", { name: "จะลบทิ้ง" });
  await card.getByRole("button", { name: "ลบ จะลบทิ้ง" }).click();
  await expect(page.getByRole("dialog")).toContainText("ย้อนกลับด้วย Undo ไม่ได้");
  await page.getByRole("dialog").getByRole("button", { name: "ลบโปรเจกต์" }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("article", { name: "จะลบทิ้ง" })).toHaveCount(0);
});
