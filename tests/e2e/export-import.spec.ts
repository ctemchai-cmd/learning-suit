import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "playwright/test";
import { PDFDocument } from "pdf-lib";
import { createProject, drawRect, objectRows, readDraft, stageBox } from "./helpers";

const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

async function download(page: Page, action: () => Promise<void>) {
  const pending = page.waitForEvent("download");
  await action();
  const file = await pending;
  const path = await file.path();
  return { name: file.suggestedFilename(), bytes: await readFile(path!) };
}

test("EXP-02/03: PNG export follows content bounds, not the camera; empty slides are 1280×720", async ({ page }) => {
  await createProject(page, "ส่งออกภาพ");
  // Empty slide at 1× → exactly 1280×720.
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("combobox", { name: "ความละเอียด" }).selectOption("1");
  const empty = await download(page, () => page.getByRole("button", { name: "ส่งออก", exact: true }).click());
  expect(empty.name).toBe("ส่งออกภาพ-สไลด์ 1.png");
  expect(pngSize(empty.bytes)).toEqual({ width: 1280, height: 720 });
  await expect(page.getByRole("radio", { name: /เฉพาะวัตถุที่เลือก/ })).toBeDisabled();
  await page.getByRole("button", { name: "ปิด", exact: true }).first().click();

  const box = await stageBox(page);
  await drawRect(page, box.cx - 50, box.cy - 25, box.cx + 50, box.cy + 25); // world 100×50 at stroke 2
  const exportOnce = async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("combobox", { name: "ความละเอียด" }).selectOption("2");
    const file = await download(page, () => page.getByRole("button", { name: "ส่งออก", exact: true }).click());
    await page.keyboard.press("Escape");
    return pngSize(file.bytes);
  };
  const first = await exportOnce();
  // (100 + 2 stroke + 2×48 padding) × 2 = 396 (floor/ceil may add one world unit per side).
  expect(first.width).toBeGreaterThanOrEqual(396);
  expect(first.width).toBeLessThanOrEqual(400);
  // Pan and zoom must not change the output.
  await page.getByRole("button", { name: "ซูมเข้า" }).click();
  await page.getByRole("button", { name: "ซูมเข้า" }).click();
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.wheel(300, 200);
  expect(await exportOnce()).toEqual(first);
});

test("EXP-05: PDF has one page per slide in order, including empty slides", async ({ page }) => {
  await createProject(page, "ส่งออก PDF");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 50, box.cy - 25, box.cx + 350, box.cy + 25);
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("radio", { name: /PDF/ }).check();
  const file = await download(page, () => page.getByRole("button", { name: "ส่งออก", exact: true }).click());
  expect(file.name).toBe("ส่งออก PDF.pdf");
  const pdf = await PDFDocument.load(file.bytes);
  expect(pdf.getPageCount()).toBe(2);
  const [first, second] = pdf.getPages();
  expect(first.getWidth() / first.getHeight()).toBeGreaterThan(2);
  expect(second.getWidth()).toBe(1280);
  expect(second.getHeight()).toBe(720);
});

test("ARC-06/ARC-03: archive export → import creates a NEW project with the same drawing info", async ({ page }) => {
  await createProject(page, "ไฟล์โปรเจกต์");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 30, box.cx + 60, box.cy + 30);
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  const sourceUrl = page.url();
  const source = await readDraft(page);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("radio", { name: /\.learning-suit/ }).check();
  const archive = await download(page, () => page.getByRole("button", { name: "ส่งออก", exact: true }).click());
  expect(archive.name).toBe("ไฟล์โปรเจกต์.learning-suit");
  expect(archive.bytes.subarray(0, 2).toString()).toBe("PK");
  await page.keyboard.press("Escape");

  await page.goto("/projects");
  // A corrupt file is rejected without creating anything.
  const before = await page.getByRole("article").count();
  const badChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  await (await badChooser).setFiles({ name: "broken.learning-suit", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004 broken") });
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(before);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  await (await chooser).setFiles({ name: archive.name, mimeType: "application/zip", buffer: archive.bytes });
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  expect(page.url()).not.toBe(sourceUrl);
  await expect(page.getByRole("heading", { name: "ไฟล์โปรเจกต์" })).toBeVisible();
  await expect(await objectRows(page)).toHaveText(["git-simulator", "rectangle"]);
  const imported = await readDraft(page);
  const strip = (nodes: Record<string, unknown>[]) => nodes.map((node) => Object.fromEntries(Object.entries(node).filter(([key]) => key !== "id")));
  expect(strip(imported!.content.document.slides[0].nodes)).toEqual(strip(source!.content.document.slides[0].nodes));
  expect(imported!.content.document.slides[0].id).not.toBe(source!.content.document.slides[0].id);
});
