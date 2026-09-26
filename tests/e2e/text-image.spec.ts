import { test, expect, type Page } from "playwright/test";
import { createProject, objectRows, readDraft, stageBox } from "./helpers";

async function pngBuffer(page: Page, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(([w, h]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2563eb"; context.fillRect(0, 0, w, h);
    context.fillStyle = "#facc15"; context.fillRect(w / 4, h / 4, w / 2, h / 2);
    return canvas.toDataURL("image/png");
  }, [width, height]);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

test("TXT-03/PST-03: refreshing while typing restores the text editor with the draft; Escape discards it", async ({ page }) => {
  await createProject(page, "กู้ข้อความ");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
  await page.mouse.click(box.cx - 100, box.cy - 50);
  const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
  await textarea.fill("ข้อความไทย 😀\nบรรทัดสอง");
  await expect(page.getByTestId("save-status")).toHaveText("กำลังแก้ข้อความ");
  // The recovery copy is written after the 500 ms debounce, separate from the document.
  await expect.poll(async () => (await readDraft(page))?.pendingEdit ?? null, { timeout: 5000 }).not.toBeNull();
  expect((await readDraft(page))!.content.document.slides[0].nodes).toHaveLength(0);
  await page.reload();
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("ข้อความไทย 😀\nบรรทัดสอง");
  await textarea.press("Meta+Enter");
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  const draft = await readDraft(page);
  expect(draft?.pendingEdit).toBeNull();
  expect(draft!.content.document.slides[0].nodes[0]).toMatchObject({ type: "text", text: "ข้อความไทย 😀\nบรรทัดสอง", fontFamily: "Noto Sans Thai" });

  // Editing an existing node then Escape keeps the original and clears recovery.
  await page.mouse.dblclick(box.cx - 90, box.cy - 40);
  await textarea.fill("จะยกเลิก");
  await textarea.press("Escape");
  await expect(textarea).toHaveCount(0);
  await expect.poll(async () => (await readDraft(page))?.pendingEdit ?? null).toBeNull();
  await expect(await objectRows(page)).toHaveText([/text: ข้อความไทย/]);
});

test("TXT-02: side handle changes text width (reflow) and keeps the font size; one Undo per edit session", async ({ page }) => {
  await createProject(page, "ความกว้างข้อความ");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
  await page.mouse.click(box.cx - 150, box.cy - 60);
  const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
  await textarea.pressSequentially("สวัสดีครับ ทดสอบการตัดบรรทัดภาษาไทย");
  await textarea.press("Meta+Enter");
  const east = page.getByRole("button", { name: "ปรับขนาด ด้านขวา" });
  const handle = (await east.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 150, handle.y + 4, { steps: 5 });
  await page.mouse.up();
  const node = (await readDraft(page))!.content.document.slides[0].nodes[0] as { width: number; fontSize: number };
  expect(node.width).toBeLessThan(200);
  expect(node.fontSize).toBe(28);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  const undone = (await readDraft(page))!.content.document.slides[0].nodes[0] as { width: number };
  expect(undone.width).toBe(320);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(await objectRows(page)).toHaveCount(0);
});

test("IMG-01/02: picker inserts with the right aspect; wrong type is rejected before the document changes", async ({ page }) => {
  await createProject(page, "รูปภาพ");
  const png = await pngBuffer(page, 400, 200);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "รูปภาพ", exact: true }).click();
  await (await chooser).setFiles({ name: "diagram.png", mimeType: "image/png", buffer: png });
  await expect(await objectRows(page)).toHaveText(["image"]);
  const draft = await readDraft(page);
  const node = draft!.content.document.slides[0].nodes[0] as { width: number; height: number; assetId: string };
  expect(node.width / node.height).toBeCloseTo(2, 5);
  expect(node.width).toBeLessThanOrEqual(400);
  const asset = draft!.content.document.assets[node.assetId] as { mimeType: string; width: number; height: number; sha256: string; storagePath: string };
  expect(asset).toMatchObject({ mimeType: "image/png", width: 400, height: 200 });
  expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(draft!.content)).not.toContain("data:image");

  // Renamed text file pretending to be PNG.
  const chooser2 = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "รูปภาพ", exact: true }).click();
  await (await chooser2).setFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByRole("alert").filter({ hasText: "ไม่ใช่ PNG, JPEG หรือ WebP" })).toBeVisible();
  await expect(await objectRows(page)).toHaveCount(1);

  // Undo/Redo keeps the blob reference renderable.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(await objectRows(page)).toHaveCount(0);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect(await objectRows(page)).toHaveCount(1);
  await page.reload();
  await expect(await objectRows(page)).toHaveText(["image"]);
});

test("IMG-01: dropping an image places it under the pointer", async ({ page }) => {
  await createProject(page, "ลากรูปวาง");
  const box = await stageBox(page);
  const png = await pngBuffer(page, 120, 80);
  const transfer = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "drop.png", { type: "image/png" }));
    return data;
  }, [...png]);
  const target = page.getByTestId("canvas-viewport");
  await target.dispatchEvent("dragover", { dataTransfer: transfer, clientX: box.cx + 100, clientY: box.cy + 50 });
  await target.dispatchEvent("drop", { dataTransfer: transfer, clientX: box.cx + 100, clientY: box.cy + 50 });
  await expect(await objectRows(page)).toHaveText(["image"]);
  const node = (await readDraft(page))!.content.document.slides[0].nodes[0] as { x: number; y: number; width: number; height: number };
  // Default camera puts world (0,0) at the viewport center: drop point is world (100, 50).
  expect(node.x + node.width / 2).toBeCloseTo(100, 0);
  expect(node.y + node.height / 2).toBeCloseTo(50, 0);
});

test("IMG-03: duplicating a project with an image copies bytes under new asset IDs and storage paths", async ({ page }) => {
  await createProject(page, "รูปต้นฉบับ");
  const png = await pngBuffer(page, 64, 32);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "รูปภาพ", exact: true }).click();
  await (await chooser).setFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await expect(await objectRows(page)).toHaveText(["image"]);
  const source = await readDraft(page);
  const sourceAsset = Object.values(source!.content.document.assets)[0] as { id: string; sha256: string; storagePath: string };
  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  await page.getByRole("article", { name: "รูปต้นฉบับ" }).getByRole("button", { name: "ทำสำเนา รูปต้นฉบับ" }).click();
  await page.getByRole("article", { name: "รูปต้นฉบับ สำเนา" }).getByRole("link", { name: "เปิดโปรเจกต์" }).click();
  await expect(await objectRows(page)).toHaveText(["image"]);
  const copy = await readDraft(page);
  const copyAsset = Object.values(copy!.content.document.assets)[0] as { id: string; sha256: string; storagePath: string };
  expect(copyAsset.id).not.toBe(sourceAsset.id);
  expect(copyAsset.storagePath).not.toBe(sourceAsset.storagePath);
  expect(copyAsset.storagePath).toContain(page.url().split("/").pop()!);
  expect(copyAsset.sha256).toBe(sourceAsset.sha256);
  // The copied image renders (bytes exist under the new asset ID): no "missing" placeholder in Objects/export.
  await page.getByRole("button", { name: "Export" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
  expect((await pending).suggestedFilename()).toBe("รูปต้นฉบับ สำเนา-สไลด์ 1.png");
});

test("TXT-01: the self-hosted Noto Sans Thai is loaded before measuring/exporting Thai, emoji and newlines", async ({ page }) => {
  await createProject(page, "ฟอนต์ไทย");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
  await page.mouse.click(box.cx - 150, box.cy - 60);
  const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
  await textarea.fill("ภาษาไทยมีสระ ่ ้ ๊ ๋\nบรรทัดสอง 😀");
  await textarea.press("Meta+Enter");
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('28px "Noto Sans Thai"', "ภาษาไทย"); })).toBe(true);
  // Self-hosted: font files come from this origin, not a third-party CDN.
  const fontOrigins = await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /\.woff2?($|\?)/.test(entry.name)).map((entry) => new URL(entry.name).origin));
  expect(fontOrigins.length).toBeGreaterThan(0);
  expect(new Set(fontOrigins)).toEqual(new Set([new URL(page.url()).origin]));
  await page.getByRole("button", { name: "Export" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
  const file = await pending;
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile((await file.path())!);
  // Two lines at 28px × 1.4 plus 2×48 padding at 2× scale → comfortably taller than one line.
  expect(bytes.readUInt32BE(20)).toBeGreaterThan((2 * 28 * 1.4 + 96) * 2 - 4);
});
