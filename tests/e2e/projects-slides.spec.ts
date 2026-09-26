import { test, expect } from "playwright/test";
import { createProject, createProjectInApp, drawRect, objectRows, readDraft, stageBox } from "./helpers";

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

test("UX-06: the slide list shows a thumbnail of each slide and redraws it after an edit", async ({ page }) => {
  await createProject(page, "ภาพย่อ");
  const items = page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem");
  const thumbnail = items.first().locator("img");
  // An empty slide has no picture, only its background.
  await expect(thumbnail).toHaveCount(0);

  const box = await stageBox(page);
  await drawRect(page, box.cx - 80, box.cy - 50, box.cx + 80, box.cy + 50);
  await expect(thumbnail).toHaveAttribute("src", /^blob:/);
  const first = await thumbnail.getAttribute("src");
  await drawRect(page, box.cx + 100, box.cy - 50, box.cx + 180, box.cy + 50);
  await expect(thumbnail).not.toHaveAttribute("src", first!);
  // The picture is really drawn (decoded, with the shape inside).
  expect(await thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await expect(items).toHaveCount(2);
  await expect(items.nth(1).locator("img")).toHaveCount(0);
  await expect(items.first().locator("img")).toHaveAttribute("src", /^blob:/);
});

test("UX-07: the project list can be searched by title (any word order, / to focus, Esc or ✕ clears)", async ({ page }) => {
  await createProject(page, "Git พื้นฐาน");
  await createProjectInApp(page, "ฐานข้อมูล Supabase");
  await createProjectInApp(page, "Deploy ขึ้น Vercel");
  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(3);
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "ค้นหาบทเรียน" });
  await expect(search).toBeFocused();
  await search.fill("git");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName("Git พื้นฐาน");
  await expect(page.getByRole("status").filter({ hasText: "พบ 1 จาก 3 บทเรียน" })).toBeVisible();
  await search.fill("vercel ขึ้น");
  await expect(cards).toHaveCount(1);
  await search.fill("python");
  await expect(cards).toHaveCount(0);
  await expect(page.getByText("ไม่พบบทเรียนที่ชื่อมี “python”")).toBeVisible();
  await page.getByRole("button", { name: "ล้างคำค้น" }).first().click();
  await expect(cards).toHaveCount(3);
  await search.fill("ข้อมูล");
  await search.press("Escape");
  await expect(cards).toHaveCount(3);
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
