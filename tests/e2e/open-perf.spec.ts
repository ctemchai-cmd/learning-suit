import { test, expect } from "playwright/test";
import { createProject, drawRect, objectRows, stageBox } from "./helpers";

// Acceptance (opening a lesson fast, without ever risking the saved work): a lesson re-opened after a reload shows exactly what
// was saved, edits made after the reload are saved too, and background work (slide thumbnails) never starts before the
// board has had a quiet moment. The cloud-only shortcuts (metadata-only open, identity cache) are covered by unit tests
// (open-probe.test.ts, identity-guard.test.ts): the local development mode has no cloud to ask.

test("PERF-OPEN-01: a re-opened lesson shows its saved content, and edits made after the reload are saved and survive another reload", async ({ page }) => {
  await createProject(page, "เปิดซ้ำ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 120, box.cy - 60, box.cx - 20, box.cy + 20);
  await expect(await objectRows(page)).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");

  await page.reload();
  await expect(page.getByRole("heading", { name: "เปิดซ้ำ" })).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");

  // The board is writable after the fast open: a new edit is stored and still there after yet another reload.
  const box2 = await stageBox(page);
  await drawRect(page, box2.cx + 20, box2.cy - 60, box2.cx + 120, box2.cy + 20);
  await expect(await objectRows(page)).toHaveCount(2);
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  await page.reload();
  await expect(await objectRows(page)).toHaveCount(2);

  // Opening from the project list (client navigation, editor chunk possibly preloaded) shows the same lesson.
  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  await expect(page.getByRole("article", { name: "เปิดซ้ำ" })).toBeVisible();
  await page.getByRole("article", { name: "เปิดซ้ำ" }).getByRole("link", { name: "เปิดโปรเจกต์" }).click();
  await expect(page.getByRole("heading", { name: "เปิดซ้ำ" })).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(2);
});

test("PERF-OPEN-02: slide thumbnails wait for a quiet board after opening, then appear", async ({ page }) => {
  await createProject(page, "ภาพย่อช้า");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 80, box.cy - 50, box.cx + 80, box.cy + 50);
  await expect(page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").first().locator("img")).toHaveAttribute("src", /^blob:/);

  await page.reload();
  const thumbnail = page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").first().locator("img");
  await page.locator(".konvajs-content").waitFor();
  const opened = Date.now();
  // Nothing is drawn for the first moments (the lesson is still opening), then the picture arrives on its own.
  await page.waitForTimeout(600);
  await expect(thumbnail).toHaveCount(0);
  await expect(thumbnail).toHaveAttribute("src", /^blob:/, { timeout: 15_000 });
  expect(Date.now() - opened).toBeGreaterThanOrEqual(1500);
});
