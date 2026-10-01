import { test, expect } from "playwright/test";
import { createProject } from "./helpers";

test("draws by two clicks, edits properties and Thai text, then restores the draft", async ({ page }) => {
  await createProject(page, "บทเรียน Git");
  
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  const stage = page.locator(".konvajs-content");
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toBeVisible();
  await expect(page.getByText("เลือก 1 วัตถุ")).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60);
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  await page.getByRole("complementary", { name: "แผงคุณสมบัติ" }).getByLabel("สีเส้น").fill("#ff0000");
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");

  await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
  await page.mouse.click(box.x + box.width / 2 + 130, box.y + box.height / 2 - 80);
  const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
  await expect(textarea).toBeVisible();
  await textarea.fill("สวัสดี Git\nCommit อยู่ในเครื่อง");
  await textarea.press("Meta+Enter");
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(page.getByText("text: สวัสดี Git")).toBeVisible();
  // Double-click to edit. Right after an editor closes the text is back on the board only after the next
  // canvas frame; a human never clicks that fast, the test retries instead.
  const editText = () => expect(async () => {
    await page.mouse.dblclick(box.x + box.width / 2 + 140, box.y + box.height / 2 - 70);
    await expect(textarea).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editText();
  await textarea.fill("ข้อความที่ยกเลิก");
  await textarea.press("Escape");
  await expect(page.getByText("text: สวัสดี Git")).toBeVisible();
  await editText();
  await textarea.fill("แก้แล้ว Git");
  await textarea.press("Meta+Enter");
  await expect(page.getByText("text: แก้แล้ว Git")).toBeVisible();

  const toolbar = page.getByRole("toolbar", { name: "เครื่องมือโปรด" });
  const before = await toolbar.boundingBox();
  expect(before).not.toBeNull();
  if (!before) return;
  const handle = page.getByRole("button", { name: "ย้ายแถบเครื่องมือโปรด" });
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();
  if (!handleBox) return;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 100, handleBox.y + handleBox.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const after = await toolbar.boundingBox();
  expect(after?.x).toBeGreaterThan(before.x + 80);
  await page.getByRole("button", { name: "นำ ลูกศร ออกจากเครื่องมือโปรด" }).click();
  await expect(page.getByRole("button", { name: "เครื่องมือโปรด: ลูกศร" })).toHaveCount(0);
  await page.getByRole("button", { name: "เพิ่ม ลูกศร ในเครื่องมือโปรด" }).click();
  await expect(page.getByRole("button", { name: "เครื่องมือโปรด: ลูกศร" })).toBeVisible();

  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await expect(page.getByRole("button", { name: /สไลด์ 2/ })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  await page.reload();
  await expect(page.getByRole("heading", { name: "บทเรียน Git" })).toBeVisible();
  await expect(page.getByRole("button", { name: /สไลด์ 2/ })).toBeVisible();
  await page.getByRole("button", { name: /สไลด์ 1/ }).click();
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(page.getByText("rectangle")).toBeVisible();
  await expect(page.getByText("text: แก้แล้ว Git")).toBeVisible();
  const restoredToolbar = await page.getByRole("toolbar", { name: "เครื่องมือโปรด" }).boundingBox();
  expect(restoredToolbar?.x).toBeGreaterThan(before.x + 80);
});

test("ellipse, line and arrow use two points and Escape cancels a pending shape", async ({ page }) => {
  await createProject(page, "ทดสอบรูปทรง");
  const box = await page.locator(".konvajs-content").boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.click(box.x + box.width / 2 - 140, box.y + box.height / 2 - 80);
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 20);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toHaveCount(0);
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(page.getByText("ยังไม่มีวัตถุบนสไลด์")).toBeVisible();

  const cases = [
    { label: "วงกลม", result: "ellipse", offset: 0 },
    { label: "เส้น", result: "line", offset: 80 },
    { label: "ลูกศร", result: "arrow", offset: 160 },
  ];
  for (const item of cases) {
    await page.getByRole("button", { name: item.label, exact: true }).click();
    await page.mouse.click(box.x + box.width / 2 - 100 + item.offset, box.y + box.height / 2 - 50);
    await page.mouse.move(box.x + box.width / 2 - 30 + item.offset, box.y + box.height / 2 + 30);
    await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toBeVisible();
    await page.mouse.click(box.x + box.width / 2 - 30 + item.offset, box.y + box.height / 2 + 30);
    await expect(page.getByText(item.result, { exact: true })).toBeVisible();
  }
});

test("selects multiple objects, clears fill, filters locked objects and clones without another click", async ({ page }) => {
  await createProject(page, "ทดสอบการเลือก");
  const box = await page.locator(".konvajs-content").boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const offset of [-170, 30]) {
    await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
    await page.mouse.click(cx + offset, cy - 80);
    await page.mouse.move(cx + offset + 80, cy - 20);
    await page.mouse.click(cx + offset + 80, cy - 20);
  }
  await page.getByRole("tab", { name: "Objects" }).click();
  const rows = page.getByRole("button", { name: "เลือกวัตถุ rectangle" });
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();

  await page.mouse.click(cx - 220, cy + 80);
  await page.mouse.click(cx - 130, cy - 50);
  await page.keyboard.down("Shift");
  await page.mouse.click(cx + 70, cy - 50);
  await page.keyboard.up("Shift");
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();

  await page.mouse.move(cx - 210, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();
  await page.mouse.click(cx - 220, cy + 80);
  await expect(page.getByText("เลือก 2 วัตถุ")).toHaveCount(0);
  await page.mouse.move(cx - 210, cy - 110);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();

  await page.mouse.move(cx - 130, cy - 50);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy + 70, { steps: 6 });
  const originalStrokeAlpha = await page.evaluate(({ x, y }) => {
    // Document layer = second canvas (the first is the non-interactive grid layer).
    const canvas = document.querySelectorAll<HTMLCanvasElement>(".konvajs-content canvas")[1];
    const bounds = canvas?.getBoundingClientRect();
    const context = canvas?.getContext("2d");
    if (!canvas || !bounds || !context) return 0;
    const px = Math.round((x - bounds.left) * canvas.width / bounds.width);
    const py = Math.round((y - bounds.top) * canvas.height / bounds.height);
    const data = context.getImageData(px - 3, py - 3, 7, 7).data;
    return Math.max(...Array.from(data).filter((_, index) => index % 4 === 3));
  }, { x: cx - 170, y: cy - 50 });
  expect(originalStrokeAlpha).toBeGreaterThan(0);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(rows).toHaveCount(4);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(rows).toHaveCount(2);

  await rows.first().click();
  await page.getByRole("tab", { name: "Properties" }).click();
  const fillToggle = page.getByRole("checkbox", { name: "ใช้สีพื้น" });
  await expect(fillToggle).not.toBeChecked();
  await fillToggle.check();
  await page.getByRole("textbox", { name: "สีพื้น", exact: true }).fill("#00ff00");
  await fillToggle.uncheck();
  await expect(page.getByRole("textbox", { name: "สีพื้น", exact: true })).toHaveCount(0);
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();

  await page.getByRole("tab", { name: "Objects" }).click();
  await page.getByRole("button", { name: "ล็อก rectangle" }).first().click();
  await page.getByRole("button", { name: "ล็อกอยู่" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toBeDisabled();
  await page.getByRole("button", { name: "ปลดล็อก rectangle" }).click();
  await expect(page.getByText("ไม่มีวัตถุที่ล็อก")).toBeVisible();
  await page.getByRole("button", { name: "ทั้งหมด" }).click();
  await expect(rows).toHaveCount(2);
  await page.reload();
  await page.getByRole("tab", { name: "Objects" }).click();
  await expect(rows).toHaveCount(2);
});

test("resizes selected shapes with handles, respects zoom, and keeps one undo step", async ({ page }) => {
  await createProject(page, "ทดสอบจุดจับ");
  const stage = await page.locator(".konvajs-content").boundingBox();
  expect(stage).not.toBeNull();
  if (!stage) return;
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.click(cx - 50, cy - 30);
  await page.mouse.move(cx + 50, cy + 30);
  await page.mouse.click(cx + 50, cy + 30);
  const northwest = page.getByRole("button", { name: "ปรับขนาด มุมซ้ายบน" });
  const southeast = page.getByRole("button", { name: "ปรับขนาด มุมขวาล่าง" });
  await expect(northwest).toBeVisible();
  const anchor = await northwest.boundingBox();
  const before = await southeast.boundingBox();
  expect(anchor && before).toBeTruthy();
  if (!anchor || !before) return;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 + 50, { steps: 5 });
  await page.mouse.up();
  const enlarged = await southeast.boundingBox();
  const fixedAnchor = await northwest.boundingBox();
  expect(enlarged?.x).toBeGreaterThan(before.x + 70);
  expect(enlarged?.y).toBeGreaterThan(before.y + 40);
  expect(fixedAnchor?.x).toBeCloseTo(anchor.x, 0);
  expect(fixedAnchor?.y).toBeCloseTo(anchor.y, 0);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  const undone = await southeast.boundingBox();
  expect(undone?.x).toBeCloseTo(before.x, 0);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  const redone = await southeast.boundingBox();
  expect(redone?.x).toBeCloseTo(enlarged!.x, 0);

  await page.getByRole("button", { name: "ซูมเข้า" }).click();
  const zoomed = await southeast.boundingBox();
  expect(zoomed).not.toBeNull();
  if (!zoomed) return;
  expect(zoomed.width).toBeCloseTo(before.width, 0);
  expect(zoomed.height).toBeCloseTo(before.height, 0);
  await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomed.x + zoomed.width / 2 + 50, zoomed.y + zoomed.height / 2 + 25, { steps: 5 });
  await page.mouse.up();
  const afterZoomResize = await southeast.boundingBox();
  expect(afterZoomResize?.x).toBeGreaterThan(zoomed.x + 40);

  const cancelStart = await northwest.boundingBox();
  expect(cancelStart).not.toBeNull();
  if (!cancelStart) return;
  await page.mouse.move(cancelStart.x + cancelStart.width / 2, cancelStart.y + cancelStart.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x - 40, cancelStart.y - 40, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  const canceled = await northwest.boundingBox();
  expect(canceled?.x).toBeCloseTo(cancelStart.x, 0);
  expect(canceled?.y).toBeCloseTo(cancelStart.y, 0);

  await page.getByRole("button", { name: "Lock" }).click();
  await expect(southeast).toHaveCount(0);
  await page.getByRole("tab", { name: "Objects" }).click();
  await page.getByRole("button", { name: "ปลดล็อก rectangle" }).click();
  await page.getByRole("button", { name: "เลือกวัตถุ rectangle" }).click();
  await expect(southeast).toBeVisible();
});

test("resizes an ellipse and adjusts an arrow endpoint", async ({ page }) => {
  await createProject(page, "ทดสอบวงกลมและลูกศร");
  const stage = await page.locator(".konvajs-content").boundingBox();
  expect(stage).not.toBeNull();
  if (!stage) return;
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.mouse.click(cx - 100, cy - 50);
  await page.mouse.move(cx, cy + 50);
  await page.mouse.click(cx, cy + 50);
  const east = page.getByRole("button", { name: "ปรับขนาด ด้านขวา" });
  const eastBefore = await east.boundingBox();
  expect(eastBefore).not.toBeNull();
  if (!eastBefore) return;
  await page.mouse.move(eastBefore.x + eastBefore.width / 2, eastBefore.y + eastBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(eastBefore.x + eastBefore.width / 2 + 40, eastBefore.y + eastBefore.height / 2, { steps: 4 });
  await page.mouse.up();
  expect((await east.boundingBox())?.x).toBeGreaterThan(eastBefore.x + 30);

  await page.getByRole("button", { name: "ลูกศร", exact: true }).click();
  await page.mouse.click(cx + 80, cy - 30);
  await page.mouse.move(cx + 180, cy + 40);
  await page.mouse.click(cx + 180, cy + 40);
  const start = page.getByRole("button", { name: "ขยับ จุดเริ่ม" });
  const end = page.getByRole("button", { name: "ขยับ จุดปลาย" });
  const startBefore = await start.boundingBox();
  const endBefore = await end.boundingBox();
  expect(startBefore && endBefore).toBeTruthy();
  if (!startBefore || !endBefore) return;
  await page.mouse.move(endBefore.x + endBefore.width / 2, endBefore.y + endBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBefore.x + endBefore.width / 2 + 45, endBefore.y + endBefore.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  expect((await end.boundingBox())?.x).toBeGreaterThan(endBefore.x + 35);
  expect((await start.boundingBox())?.x).toBeCloseTo(startBefore.x, 0);
});

test("collapses and resizes the left panel while keeping slide navigation available", async ({ page }) => {
  await createProject(page, "ทดสอบแถบซ้าย");
  const stage = page.locator(".konvajs-content");
  const initialWidth = (await stage.boundingBox())?.width ?? 0;
  await page.getByRole("button", { name: "ยุบแถบซ้าย" }).click();
  await expect(page.getByRole("button", { name: "ขยายแถบซ้าย" })).toBeVisible();
  await expect.poll(async () => (await stage.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth + 150);
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await expect(page.getByRole("combobox", { name: "เลือกสไลด์" })).toHaveValue(/.+/);
  await page.getByRole("combobox", { name: "เลือกสไลด์" }).selectOption({ label: "1. สไลด์ 1" });
  await expect(page.locator("footer")).toContainText("สไลด์ 1");
  await page.reload();
  await expect(page.getByRole("button", { name: "ขยายแถบซ้าย" })).toBeVisible();
  await page.getByRole("button", { name: "ขยายแถบซ้าย" }).click();
  const separator = page.getByRole("separator", { name: "ปรับความกว้างแถบซ้าย" });
  await expect(separator).toBeVisible();
  const before = Number(await separator.getAttribute("aria-valuenow"));
  const box = await separator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 80));
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 80));
  await separator.focus();
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 64));
});

test("reorders selected objects from the Objects panel and restores order with Undo", async ({ page }) => {
  await createProject(page, "ทดสอบลำดับซ้อน");
  const stage = await page.locator(".konvajs-content").boundingBox();
  expect(stage).not.toBeNull();
  if (!stage) return;
  for (const [index, label] of ["A", "B", "C"].entries()) {
    await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
    await page.mouse.click(stage.x + stage.width / 2 - 120 + index * 30, stage.y + stage.height / 2 - 90 + index * 55);
    const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
    await textarea.fill(label);
    await textarea.press("Meta+Enter");
  }
  await page.getByRole("tab", { name: "Objects" }).click();
  const rows = page.getByRole("button", { name: /^เลือกวัตถุ text:/ });
  await expect(rows).toHaveCount(3);
  await expect(rows).toHaveText(["text: C", "text: B", "text: A"]);
  await page.getByRole("button", { name: "เลือกวัตถุ text: A" }).click();
  await page.getByRole("button", { name: "นำขึ้นบนสุด" }).click();
  await expect(rows).toHaveText(["text: A", "text: C", "text: B"]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(rows).toHaveText(["text: C", "text: B", "text: A"]);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect(rows).toHaveText(["text: A", "text: C", "text: B"]);
  await page.getByRole("button", { name: "ย้ายลงหนึ่งชั้น" }).click();
  await expect(rows).toHaveText(["text: C", "text: A", "text: B"]);
  await page.keyboard.press("Meta+]");
  await expect(rows).toHaveText(["text: A", "text: C", "text: B"]);
});

test("keeps the second tab read-only until the first tab releases its writer lease", async ({ page, context }) => {
  await createProject(page, "สองแท็บ");
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  const url = page.url();
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByText("อ่านอย่างเดียว")).toBeVisible();
  await expect(second.getByRole("button", { name: "เพิ่มสไลด์" })).toBeDisabled();
  await page.goto("/projects");
  await expect(async () => {
    await second.getByRole("button", { name: "เปิดแก้ไข" }).click();
    await expect(second.getByRole("button", { name: "เพิ่มสไลด์" })).toBeEnabled();
  }).toPass({ timeout: 30_000 });
});
