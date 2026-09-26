import { test, expect } from "playwright/test";
import { createProject, objectRows, readDraft, stageBox } from "./helpers";

test("CAN-04: pen point, long pen stroke and highlighter; eraser removes whole strokes and Undo restores", async ({ page }) => {
  await createProject(page, "ปากกาและยางลบ");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  // A click without dragging becomes a single-point dot.
  await page.mouse.click(box.cx - 200, box.cy - 120);
  // Long stroke.
  await page.mouse.move(box.cx - 200, box.cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(box.cx - 200 + i * 8, box.cy + Math.sin(i / 4) * 40);
  await page.mouse.up();
  await page.getByRole("button", { name: "ไฮไลต์", exact: true }).click();
  await page.mouse.move(box.cx - 150, box.cy + 120);
  await page.mouse.down();
  await page.mouse.move(box.cx + 150, box.cy + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("tab", { name: "Objects" })).toBeVisible();
  const rows = await objectRows(page);
  await expect(rows).toHaveText(["highlighter", "pen", "pen"]);

  const draft = await readDraft(page);
  const nodes = draft!.content.document.slides[0].nodes as { type: string; points: unknown[]; opacity: number; strokeWidth: number }[];
  expect(nodes[0].points).toHaveLength(1);
  expect(nodes[1].points.length).toBeGreaterThan(5);
  expect(nodes[1].points.length).toBeLessThan(41); // RDP simplified but kept the curve
  expect(nodes[2]).toMatchObject({ type: "highlighter", opacity: 0.25, strokeWidth: 16 });

  // Eraser crossing the long stroke and the highlighter removes both in ONE transaction.
  await page.getByRole("button", { name: "ยางลบ", exact: true }).click();
  await page.mouse.move(box.cx - 40, box.cy - 80);
  await page.mouse.down();
  await page.mouse.move(box.cx - 40, box.cy + 160, { steps: 10 });
  await page.mouse.up();
  await expect(rows).toHaveText(["pen"]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(rows).toHaveText(["highlighter", "pen", "pen"]);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect(rows).toHaveText(["pen"]);
});

test("CAN-03: Shift constrains square/45° lines, arrow keeps start→end direction, Escape cancels", async ({ page }) => {
  await createProject(page, "Shift constraint");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.click(box.cx - 100, box.cy - 100);
  await page.keyboard.down("Shift");
  await page.mouse.move(box.cx + 20, box.cy - 40, { steps: 3 });
  await page.mouse.click(box.cx + 20, box.cy - 40);
  await page.keyboard.up("Shift");
  let draft = await readDraft(page);
  const square = draft!.content.document.slides[0].nodes[0] as { width: number; height: number };
  expect(square.width).toBeCloseTo(square.height, 5);

  // Arrow drawn right-to-left keeps start/end order.
  await page.getByRole("button", { name: "ลูกศร", exact: true }).click();
  await page.mouse.click(box.cx + 200, box.cy + 100);
  await page.mouse.move(box.cx + 60, box.cy + 110, { steps: 3 });
  await page.mouse.click(box.cx + 60, box.cy + 110);
  draft = await readDraft(page);
  const arrow = draft!.content.document.slides[0].nodes[1] as { x: number; points: { x: number; y: number }[] };
  expect(arrow.points[0].x).toBeGreaterThan(arrow.points[1].x);

  // Changing tool cancels a pending first point.
  await page.getByRole("button", { name: "เส้น", exact: true }).click();
  await page.mouse.click(box.cx - 200, box.cy + 150);
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toBeVisible();
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toHaveCount(0);
  await expect(await objectRows(page)).toHaveCount(2);
});

test("CAN-12: window blur during a pen stroke cancels the preview without creating an object", async ({ page }) => {
  await createProject(page, "ยกเลิกเส้น");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await page.mouse.move(box.cx - 100, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx, box.cy + 30, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.move(box.cx + 100, box.cy, { steps: 3 });
  await page.mouse.up();
  await expect(await objectRows(page)).toHaveCount(0);
  expect((await readDraft(page))!.content.document.slides[0].nodes).toHaveLength(0);
});

test("CAN-13: laser pointer (K) shows a dot with a fading trail and never draws, selects or saves", async ({ page }) => {
  await createProject(page, "เลเซอร์");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.move(box.cx + 150, box.cy + 150);
  await page.keyboard.press("k");
  await expect(page.getByRole("button", { name: "เลเซอร์พอยเตอร์", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  const before = JSON.stringify((await readDraft(page))!.content);

  await page.mouse.move(box.cx - 150, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + 100, box.cy + 60, { steps: 12 });
  const laser = page.getByTestId("laser-pointer");
  await expect(laser.locator("circle")).toHaveCount(2); // dot + halo
  expect(await laser.locator("line").count()).toBeGreaterThan(0); // trail
  await page.mouse.up();
  // The trail fades by itself; the dot stays while the pointer is on the board.
  await expect(laser.locator("line")).toHaveCount(0, { timeout: 3000 });
  await expect(laser.locator("circle")).toHaveCount(2);

  expect(JSON.stringify((await readDraft(page))!.content)).toBe(before);
  await expect(await objectRows(page)).toHaveCount(0);
  // Another tool removes it.
  await page.keyboard.press("v");
  await expect(laser).toHaveCount(0);
});

test("CAN-14: shapes draw by press-drag-release too; “วาดต่อเนื่อง” is remembered; the pen draws over a selected Git widget", async ({ page }) => {
  await createProject(page, "ลากวาด");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.move(box.cx - 300, box.cy - 200);
  await page.mouse.down();
  await page.mouse.move(box.cx - 150, box.cy - 100, { steps: 8 });
  await expect(page.getByText("ปล่อยเพื่อจบ")).toBeVisible();
  await page.mouse.up();
  const rows = await objectRows(page);
  await expect(rows).toHaveText(["rectangle"]);
  const rect = (await readDraft(page))!.content.document.slides[0].nodes[0] as { width: number; height: number };
  expect(rect.width).toBeGreaterThan(100);
  expect(rect.height).toBeGreaterThan(60);
  // Default: back to Select with the new shape selected.
  await expect(page.getByRole("button", { name: "เลือก", exact: true }).first()).toHaveAttribute("aria-pressed", "true");

  // “วาดต่อเนื่อง” survives a reload; then two drags make two shapes without re-picking the tool.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.getByRole("checkbox", { name: /วาดต่อเนื่อง/ }).check();
  await page.reload();
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByRole("checkbox", { name: /วาดต่อเนื่อง/ })).toBeChecked();
  for (const dy of [0, 140]) {
    await page.mouse.move(box.cx + 100, box.cy - 200 + dy);
    await page.mouse.down();
    await page.mouse.move(box.cx + 220, box.cy - 120 + dy, { steps: 6 });
    await page.mouse.up();
  }
  await expect(await objectRows(page)).toHaveText(["ellipse", "ellipse", "rectangle"]);
  await expect(page.getByRole("button", { name: "วงกลม", exact: true }).first()).toHaveAttribute("aria-pressed", "true");

  // A selected Git widget's file editor must not swallow the pen.
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  const file = await page.getByRole("textbox", { name: "แก้ไฟล์บนเครื่อง A" }).boundingBox();
  await page.getByRole("button", { name: "ปากกา", exact: true }).first().click();
  await expect(page.getByTestId("git-overlay")).toHaveCount(0);
  await page.mouse.move(file!.x + 20, file!.y + 20);
  await page.mouse.down();
  await page.mouse.move(file!.x + file!.width - 20, file!.y + file!.height - 20, { steps: 10 });
  await page.mouse.up();
  const nodes = (await readDraft(page))!.content.document.slides[0].nodes as { type: string }[];
  expect(nodes.filter((node) => node.type === "pen")).toHaveLength(1);
});
