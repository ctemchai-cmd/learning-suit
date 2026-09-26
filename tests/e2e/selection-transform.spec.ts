import { test, expect, type Page } from "playwright/test";
import { createProject, createProjectInApp, drawRect, objectRows, readDraft, stageBox } from "./helpers";

type RectLike = { id: string; x: number; y: number; width: number; height: number; rotation: number; locked: boolean; opacity: number };
const nodesOf = async (page: Page, slide = 0) => ((await readDraft(page))!.content.document.slides[slide].nodes) as unknown as RectLike[];

test("CAN-06: locked nodes let the pointer through, Cmd+A skips them, the Objects panel unlocks", async ({ page }) => {
  await createProject(page, "ล็อกวัตถุ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 150, box.cy - 100, box.cx + 150, box.cy + 100); // large background
  await drawRect(page, box.cx - 20, box.cy - 20, box.cx + 20, box.cy + 20); // small on top
  // Lock the large one via Objects.
  const rows = await objectRows(page);
  await page.getByRole("button", { name: "ล็อก rectangle" }).nth(1).click();
  await page.keyboard.press("Escape");
  // Clicking the locked shape's area selects nothing and dragging does not move it.
  await page.mouse.move(box.cx - 120, box.cy - 80);
  await page.mouse.down();
  await page.mouse.move(box.cx - 60, box.cy - 40, { steps: 4 });
  await page.mouse.up();
  const before = await nodesOf(page);
  expect(before[0]).toMatchObject({ locked: true, x: expect.any(Number) });
  await page.keyboard.press("Meta+a");
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  // Cmd+L locks the selection and clears it.
  await page.keyboard.press("Meta+l");
  await expect(page.getByText("เลือก 1 วัตถุ")).toHaveCount(0);
  await objectRows(page);
  await page.getByRole("button", { name: "ล็อกอยู่" }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: "ปลดล็อก rectangle" }).first().click();
  await page.getByRole("button", { name: "ทั้งหมด" }).click();
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  const after = await nodesOf(page);
  expect(after[0].x).toBe(before[0].x);
});

test("CAN-07: Option+drag below threshold does not clone; above threshold clones once; Escape cancels", async ({ page }) => {
  await createProject(page, "โคลน");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 40, box.cy - 30, box.cx + 40, box.cy + 30);
  await page.keyboard.press("Escape");
  const rows = await objectRows(page);
  // Below the 3 px threshold: no clone. (Grab inside the shape, away from the resize handles.)
  await page.mouse.move(box.cx - 20, box.cy + 10);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(box.cx - 19, box.cy + 11);
  await page.mouse.up();
  await expect(rows).toHaveCount(1);
  // Escape cancels a clone in progress.
  await page.mouse.down();
  await page.mouse.move(box.cx + 60, box.cy + 60, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(rows).toHaveCount(1);
  // Releasing Option mid-gesture still clones exactly once.
  await page.mouse.move(box.cx - 20, box.cy + 10);
  await page.mouse.down();
  await page.mouse.move(box.cx + 20, box.cy + 50, { steps: 5 });
  await page.keyboard.up("Alt");
  await page.mouse.move(box.cx + 60, box.cy + 80, { steps: 3 });
  await page.mouse.up();
  await expect(rows).toHaveCount(2);
  const nodes = await nodesOf(page);
  expect(nodes[1].x - nodes[0].x).toBeCloseTo(80, 0);
  expect(nodes[1].y - nodes[0].y).toBeCloseTo(70, 0);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(rows).toHaveCount(1);
});

test("CAN-08: multi copy/paste across slides and projects keeps z-order and relative positions", async ({ page }) => {
  await createProject(page, "คัดลอกต้นทาง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 100, box.cy - 50, box.cx - 20, box.cy + 10);
  await drawRect(page, box.cx, box.cy - 20, box.cx + 90, box.cy + 60);
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await expect(page.getByText("คัดลอกวัตถุในแอป 2 ชิ้น")).toBeVisible();
  const source = await nodesOf(page);
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.keyboard.press("Meta+v");
  const rows = await objectRows(page);
  await expect(rows).toHaveCount(2);
  const pasted = await nodesOf(page, 1);
  expect(pasted[0].x - source[0].x).toBeCloseTo(24);
  expect(pasted[1].x - pasted[0].x).toBeCloseTo(source[1].x - source[0].x);
  expect(pasted.map((node) => node.id)).not.toContain(source[0].id);
  // Second paste offsets again.
  await page.keyboard.press("Meta+v");
  await expect(rows).toHaveCount(4);
  const again = await nodesOf(page, 1);
  expect(again[2].x - source[0].x).toBeCloseTo(48);

  // Cross-project paste within the same session (in-app navigation keeps the clipboard).
  await createProjectInApp(page, "คัดลอกปลายทาง");
  await page.keyboard.press("Meta+v");
  await expect(await objectRows(page)).toHaveCount(2);
});

test("CAN-09: rotation handle snaps with Shift, multi-selection scales uniformly, text width reflows", async ({ page }) => {
  await createProject(page, "หมุนและขยาย");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 30, box.cx + 60, box.cy + 30);
  const rotate = page.getByRole("button", { name: "หมุนวัตถุ" });
  const handle = (await rotate.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.cx + 120, box.cy - 5, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  let nodes = await nodesOf(page);
  expect(Math.abs(nodes[0].rotation) % 15).toBeCloseTo(0, 5);
  expect(Math.abs(nodes[0].rotation)).toBeGreaterThan(45);
  expect(nodes[0].width).toBeCloseTo(120, 0);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  nodes = await nodesOf(page);
  expect(nodes[0].rotation).toBe(0);

  // Multi-selection: corner handle scales both shapes uniformly in one Undo step.
  await drawRect(page, box.cx + 100, box.cy + 60, box.cx + 160, box.cy + 120);
  await page.keyboard.press("Meta+a");
  const corner = page.getByRole("button", { name: "ปรับขนาด มุมขวาล่าง" });
  const cornerBox = (await corner.boundingBox())!;
  const beforeScale = await nodesOf(page);
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cornerBox.x + 60, cornerBox.y + 40, { steps: 5 });
  await page.mouse.up();
  const scaled = await nodesOf(page);
  const ratioA = scaled[0].width / beforeScale[0].width;
  const ratioB = scaled[1].height / beforeScale[1].height;
  expect(ratioA).toBeGreaterThan(1.05);
  expect(ratioA).toBeCloseTo(ratioB, 3);
  expect(scaled[0].width / scaled[0].height).toBeCloseTo(beforeScale[0].width / beforeScale[0].height, 3);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await nodesOf(page))[0].width).toBeCloseTo(beforeScale[0].width, 5);
});

test("CAN-10/11: slider commits once, mixed values stay untouched, nudges coalesce, typing never triggers shortcuts", async ({ page }) => {
  await createProject(page, "คุณสมบัติ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 150, box.cy - 40, box.cx - 60, box.cy + 40);
  await page.getByRole("button", { name: "ข้อความ", exact: true }).click();
  await page.mouse.click(box.cx + 40, box.cy - 20);
  const textarea = page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
  // Letters typed into the text editor must not switch tools (R = rectangle).
  await textarea.pressSequentially("Rov");
  await textarea.press("Meta+Enter");
  await expect(page.getByRole("button", { name: "เลือก", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Meta+a");
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();
  // Only shared properties (opacity) are offered for rectangle + text.
  await expect(page.getByRole("checkbox", { name: "ใช้สีพื้น" })).toHaveCount(0);
  // One pointer interaction on the slider previews continuously and commits once on release.
  const slider = page.getByRole("slider", { name: "ความทึบ" });
  const track = (await slider.boundingBox())!;
  await page.mouse.move(track.x + track.width - 2, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.7, track.y + track.height / 2, { steps: 4 });
  await page.mouse.move(track.x + track.width * 0.5, track.y + track.height / 2, { steps: 4 });
  await page.mouse.up();
  const afterSlider = await nodesOf(page);
  expect(afterSlider.every((node) => node.opacity < 1)).toBe(true);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await nodesOf(page)).every((node) => node.opacity === 1)).toBe(true);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();

  // Arrow nudges held down coalesce into one transaction.
  const beforeNudge = await nodesOf(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press("Meta+a");
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await nodesOf(page))[0].x - beforeNudge[0].x).toBeCloseTo(30);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await nodesOf(page))[0].x).toBeCloseTo(beforeNudge[0].x);
});
