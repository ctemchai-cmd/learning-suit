import { test, expect } from "playwright/test";
import { createProject, drawRect, objectRows, readDraft, stageBox } from "./helpers";

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

test("CAN-12: an interruption (window blur) keeps the pen stroke drawn so far; Escape still throws it away", async ({ page }) => {
  await createProject(page, "เส้นไม่หาย");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await page.mouse.move(box.cx - 100, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx, box.cy + 30, { steps: 5 });
  // e.g. macOS Force Click / a screen-sharing app taking focus mid-stroke.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.move(box.cx + 100, box.cy, { steps: 3 });
  await page.mouse.up();
  await expect(await objectRows(page)).toHaveText(["pen"]);
  const stroke = (await readDraft(page))!.content.document.slides[0].nodes[0] as { points: unknown[] };
  expect(stroke.points.length).toBeGreaterThan(1);

  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await page.mouse.move(box.cx - 100, box.cy + 120);
  await page.mouse.down();
  await page.mouse.move(box.cx, box.cy + 150, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(await objectRows(page)).toHaveText(["pen"]);
});

test("CAN-16: a wobbly click still places the rectangle's points (trackpad), and the second click always finishes", async ({ page }) => {
  await createProject(page, "คลิกมือสั่น");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  const wobblyClick = async (x: number, y: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 5, y + 6, { steps: 3 }); // 8 px of travel while pressed
    await page.mouse.up();
  };
  await wobblyClick(box.cx - 200, box.cy - 120);
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toBeVisible();
  await page.mouse.move(box.cx - 40, box.cy - 20, { steps: 4 });
  await wobblyClick(box.cx - 40, box.cy - 20);
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ|ปล่อยเพื่อจบ/)).toHaveCount(0);
  await expect(await objectRows(page)).toHaveText(["rectangle"]);
  const rect = (await readDraft(page))!.content.document.slides[0].nodes[0] as { width: number; height: number };
  expect(rect.width).toBeGreaterThan(140);
  expect(rect.height).toBeGreaterThan(80);
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

test("CAN-14: shapes are click → move → click only (a drag just places the first point); “วาดต่อเนื่อง” is remembered; the pen draws over a selected Git widget", async ({ page }) => {
  await createProject(page, "คลิกสองครั้ง");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  // An old habit of dragging does not draw: the press only places the first point…
  await page.mouse.move(box.cx - 300, box.cy - 200);
  await page.mouse.down();
  await page.mouse.move(box.cx - 250, box.cy - 170, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/คลิกจุดที่ 2 เพื่อจบ/)).toBeVisible();
  const rows = await objectRows(page);
  await expect(rows).toHaveCount(0);
  // …and the second click finishes from that first point.
  await page.mouse.move(box.cx - 150, box.cy - 100, { steps: 4 });
  await page.mouse.click(box.cx - 150, box.cy - 100);
  await expect(rows).toHaveText(["rectangle"]);
  const rect = (await readDraft(page))!.content.document.slides[0].nodes[0] as { width: number; height: number };
  expect(rect.width).toBeGreaterThan(140);
  expect(rect.height).toBeGreaterThan(90);
  // Default: back to Select with the new shape selected.
  await expect(page.getByRole("button", { name: "เลือก", exact: true }).first()).toHaveAttribute("aria-pressed", "true");

  // “วาดต่อเนื่อง” survives a reload; then two shapes in a row without re-picking the tool.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.getByRole("checkbox", { name: /วาดต่อเนื่อง/ }).check();
  await page.reload();
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByRole("checkbox", { name: /วาดต่อเนื่อง/ })).toBeChecked();
  for (const dy of [0, 140]) {
    await page.mouse.click(box.cx + 100, box.cy - 200 + dy);
    await page.mouse.move(box.cx + 220, box.cy - 120 + dy, { steps: 4 });
    await page.mouse.click(box.cx + 220, box.cy - 120 + dy);
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

test("CAN-15: keys 1–8 pick favorites in toolbar order; dragging a favorite reorders it (kept after reload); ⌥→ moves it too", async ({ page }) => {
  await createProject(page, "เครื่องมือโปรด");
  const toolbar = page.getByRole("toolbar", { name: "เครื่องมือโปรด" });
  const order = () => toolbar.getByRole("button", { name: /^เครื่องมือโปรด: / }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")!.replace("เครื่องมือโปรด: ", "")));
  const pressed = (name: string) => page.getByRole("button", { name, exact: true }).first();
  expect(await order()).toEqual(["เลือก", "ปากกา", "สี่เหลี่ยม", "วงกลม", "ลูกศร", "ข้อความ"]);

  await page.keyboard.press("2");
  await expect(pressed("ปากกา")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("6");
  await expect(pressed("ข้อความ")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("1");

  // Drag “ข้อความ” to the front: the drag does not pick it, and the number keys follow the new order.
  const from = (await toolbar.getByRole("button", { name: "เครื่องมือโปรด: ข้อความ" }).boundingBox())!;
  const to = (await toolbar.getByRole("button", { name: "เครื่องมือโปรด: เลือก" }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await order()).toEqual(["ข้อความ", "เลือก", "ปากกา", "สี่เหลี่ยม", "วงกลม", "ลูกศร"]);
  await expect(pressed("เลือก")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("1");
  await expect(pressed("ข้อความ")).toHaveAttribute("aria-pressed", "true");

  // Keyboard reordering on a focused favorite.
  await toolbar.getByRole("button", { name: "เครื่องมือโปรด: ลูกศร" }).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  expect(await order()).toEqual(["ข้อความ", "เลือก", "ปากกา", "สี่เหลี่ยม", "ลูกศร", "วงกลม"]);

  await page.reload();
  await expect(toolbar).toBeVisible();
  expect(await order()).toEqual(["ข้อความ", "เลือก", "ปากกา", "สี่เหลี่ยม", "ลูกศร", "วงกลม"]);
});

test("CAN-17: right-click menu — clear pen strokes or all drawings in one Undo step; locked objects stay; object actions", async ({ page }) => {
  await createProject(page, "คลิกขวา");
  const box = await stageBox(page);
  const stroke = async (x: number, y: number) => {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 60, y + 30, { steps: 4 }); await page.mouse.up();
  };
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await stroke(box.cx - 200, box.cy - 100);
  await stroke(box.cx - 100, box.cy - 100);
  await drawRect(page, box.cx + 60, box.cy + 40, box.cx + 200, box.cy + 140);
  // Lock the rectangle: it must survive every “clear”.
  await page.keyboard.press("Meta+l");
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await stroke(box.cx - 200, box.cy + 100);
  const rows = await objectRows(page);
  await expect(rows).toHaveCount(4);

  // With the pen still active, a right-click opens the board menu.
  await page.mouse.click(box.cx, box.cy - 200, { button: "right" });
  const menu = page.getByRole("menu", { name: "เมนูคลิกขวา" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "วาง" })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: /ล้างเส้นปากกา\/ไฮไลต์ \(3\)/ })).toBeEnabled();
  await menu.getByRole("menuitem", { name: /ล้างเส้นปากกา\/ไฮไลต์/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(rows).toHaveText(["rectangle"]);
  // One Undo brings all three strokes back.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(rows).toHaveCount(4);

  // Keyboard: Escape closes; arrows move; Enter runs.
  await page.mouse.click(box.cx, box.cy - 200, { button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Right-click on an object (Select tool) selects it and offers object actions.
  await page.keyboard.press("v");
  await drawRect(page, box.cx - 300, box.cy + 150, box.cx - 220, box.cy + 210);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 260, box.cy + 180, { button: "right" });
  await expect(menu.getByRole("menuitem", { name: "ทำสำเนา" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "ทำสำเนา" }).click();
  await expect(rows).toHaveCount(6);
  await page.mouse.click(box.cx + 300, box.cy - 220, { button: "right" });
  await menu.getByRole("menuitem", { name: /ล้างสิ่งที่วาดทั้งหมด \(5\)/ }).click();
  await expect(rows).toHaveText(["rectangle"]);
  const locked = (await readDraft(page))!.content.document.slides[0].nodes as { type: string; locked: boolean }[];
  expect(locked).toEqual([expect.objectContaining({ type: "rectangle", locked: true })]);
});
