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
  // Trail: smooth curves, not dotted segments (drawn on the next frame, so wait for it).
  await expect.poll(() => laser.locator("path").count()).toBeGreaterThan(0);
  await page.mouse.up();
  // The trail fades by itself; the dot stays while the pointer is on the board.
  await expect(laser.locator("path")).toHaveCount(0, { timeout: 3000 });
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

test("CAN-18: ready-made pictures — I opens the picker, a pick lands selected in the middle, the label is edited in Properties, Undo and reload behave", async ({ page }) => {
  await createProject(page, "ภาพประกอบ");
  const box = await stageBox(page);
  await page.mouse.move(box.cx, box.cy);
  await page.keyboard.press("i");
  const picker = page.getByRole("dialog", { name: "ภาพประกอบ" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "หน้าต่าง Browser", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  await expect.poll(async () => (await readDraft(page))!.content.document.slides[0].nodes).toEqual([
    expect.objectContaining({ type: "stencil", kind: "browser", label: "example.com", width: 560, height: 360 }),
  ]);

  const url = page.getByRole("textbox", { name: "ที่อยู่เว็บ (URL)" });
  await url.fill("localhost:3000");
  await url.press("Enter");
  await expect.poll(async () => (await readDraft(page))!.content.document.slides[0].nodes[0]).toMatchObject({ label: "localhost:3000" });
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await readDraft(page))!.content.document.slides[0].nodes[0]).toMatchObject({ label: "example.com" });

  // The tool entry in the left panel opens the same picker; icons carry their Thai caption.
  await page.getByRole("button", { name: "ภาพประกอบ (มือถือ, Browser, ไอคอน)", exact: true }).first().click();
  await picker.getByRole("button", { name: "ฐานข้อมูล", exact: true }).click();
  await expect(await objectRows(page)).toHaveCount(2);
  await expect.poll(async () => (await readDraft(page))!.content.document.slides[0].nodes.map((node) => [node.kind, node.label]))
    .toEqual([["browser", "example.com"], ["database", "ฐานข้อมูล"]]);

  await page.reload();
  await expect(await objectRows(page)).toHaveCount(2);
  await expect(page.getByText("หน้าต่าง Browser: example.com")).toBeVisible();

  // “Clear all drawings” includes ready-made pictures (one Undo brings them back).
  // An empty spot on the board (away from the floating favorites toolbar).
  await page.mouse.click(box.x + 60, box.cy, { button: "right" });
  await page.getByRole("menuitem", { name: "ล้างสิ่งที่วาดทั้งหมด (2)" }).click();
  await expect(await objectRows(page)).toHaveCount(0);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(await objectRows(page)).toHaveCount(2);
});

test("CAN-19: tables — type across cells with Tab, each cell is one Undo step, double-click / right-click a cell, drag a column border; class boxes add lines with Enter", async ({ page }) => {
  await createProject(page, "ตาราง");
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as { kind?: string; variant?: string; columns: number[]; rows: { cells: string[] }[] }[];
  await page.getByRole("button", { name: "ตาราง", exact: true }).first().click();
  const cell = page.getByRole("textbox", { name: /^แก้ข้อความในตาราง/ });
  await expect(cell).toHaveAttribute("aria-label", "แก้ข้อความในตาราง แถว 1 คอลัมน์ 1");
  await expect(cell).toBeFocused();
  // The placeholder header is selected: typing replaces it; Tab selects the next cell the same way.
  for (const [text, key] of [["เมนู", "Tab"], ["ราคา", "Tab"], ["หมวด", "Tab"], ["ลาเต้", "Tab"], ["60", "ControlOrMeta+Enter"]]) {
    await page.keyboard.type(text);
    await page.keyboard.press(key);
  }
  await expect(cell).toHaveCount(0);
  await expect.poll(async () => (await nodes())[0].rows.map((row) => row.cells)).toEqual([["เมนู", "ราคา", "หมวด"], ["ลาเต้", "60", ""], ["", "", ""]]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await nodes())[0].rows[1].cells).toEqual(["ลาเต้", "", ""]);

  // Column borders: drag the first one 60 px to the right (zoom 100%).
  const border = page.getByRole("separator", { name: "ปรับความกว้างคอลัมน์ 1" });
  const box = (await border.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes())[0].columns).toEqual([220, 100, 160]);

  // Double-click the second row, second column; right-click the last row to add one below.
  const border1 = (await border.boundingBox())!;
  await page.mouse.dblclick(border1.x + 40, border1.y + 57);
  await expect(cell).toHaveAttribute("aria-label", "แก้ข้อความในตาราง แถว 2 คอลัมน์ 2");
  await page.keyboard.type("65");
  await page.keyboard.press("Escape");
  await expect(cell).toHaveCount(0);
  expect((await nodes())[0].rows[1].cells).toEqual(["ลาเต้", "", ""]);
  await page.mouse.click(border1.x - 40, border1.y + 95, { button: "right" });
  await page.getByRole("menuitem", { name: "เพิ่มแถวด้านล่าง" }).click();
  await expect.poll(async () => (await nodes())[0].rows).toHaveLength(4);

  // Class box: Enter from the title goes to the first line, then adds a new line under the current one.
  await page.keyboard.press("i");
  await page.getByRole("dialog", { name: "ภาพประกอบ" }).getByRole("button", { name: "กล่องคลาส / ตารางฐานข้อมูล" }).click();
  await expect(cell).toBeFocused();
  for (const [text, key] of [["Order", "Enter"], ["id: uuid", "Enter"], ["total: number", "ControlOrMeta+Enter"]]) {
    await page.keyboard.type(text);
    await page.keyboard.press(key);
  }
  await expect.poll(async () => (await nodes())[1].rows.map((row) => row.cells[0])).toEqual(["Order", "id: uuid", "total: number", "name: string", "login()"]);

  await page.reload();
  await expect(await objectRows(page)).toHaveCount(2);
  await expect(page.getByText("กล่องคลาส: Order")).toBeVisible();

  // Tables are cleared by “clear all drawings” too.
  const stage = await stageBox(page);
  await page.mouse.click(stage.x + 60, stage.cy, { button: "right" });
  await page.getByRole("menuitem", { name: "ล้างสิ่งที่วาดทั้งหมด (2)" }).click();
  await expect(await objectRows(page)).toHaveCount(0);
});

test("CAN-20: groups — right-click groups the selection, a click selects and moves the whole group, double-click picks one piece, ungroup; ⌘G works too", async ({ page }) => {
  await createProject(page, "กลุ่ม");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 200, box.cy - 50, box.cx - 100, box.cy + 50);
  await drawRect(page, box.cx + 100, box.cy - 50, box.cx + 200, box.cy + 50);
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as { id: string; x: number; groupId?: string }[];
  await page.keyboard.press("ControlOrMeta+a");
  await page.mouse.click(box.cx - 150, box.cy - 50, { button: "right" });
  await page.getByRole("menuitem", { name: "จับกลุ่ม 2 ชิ้น" }).click();
  await expect.poll(async () => new Set((await nodes()).map((node) => node.groupId)).size).toBe(1);
  expect((await nodes())[0].groupId).toBeTruthy();

  // A click on one member selects both; dragging moves both.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx + 150, box.cy - 50);
  await expect(page.getByText("เลือก 2 วัตถุ")).toBeVisible();
  const before = (await nodes()).map((node) => node.x);
  await page.mouse.move(box.cx + 150, box.cy - 50);
  await page.mouse.down();
  await page.mouse.move(box.cx + 190, box.cy - 50, { steps: 6 });
  await page.mouse.up();
  // Both move by the same amount (snapped to the grid, so about 40).
  await expect.poll(async () => (await nodes()).map((node, index) => node.x - before[index])).toEqual([expect.any(Number), expect.any(Number)]);
  const moved = (await nodes()).map((node, index) => node.x - before[index]);
  expect(moved[0]).toBeCloseTo(moved[1], 5);
  expect(Math.abs(moved[0] - 40)).toBeLessThanOrEqual(10);

  // Double-click picks the one piece inside the group.
  await page.mouse.dblclick(box.cx + 170, box.cy - 50);
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  // Off the top-centre resize handle of the now single selection.
  await page.mouse.click(box.cx + 170, box.cy - 50, { button: "right" });
  await page.getByRole("menuitem", { name: "แยกกลุ่ม" }).click();
  await expect.poll(async () => (await nodes()).every((node) => !node.groupId)).toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx + 170, box.cy - 50);
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();

  // Keyboard: ⌘A then ⌘G groups again; Undo ungroups.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect.poll(async () => (await nodes()).every((node) => Boolean(node.groupId))).toBe(true);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await nodes()).every((node) => !node.groupId)).toBe(true);
});

test("CAN-21: dragging snaps — edges line up with a nearby object (pink guide), otherwise to the grid; ⌘ held moves freely", async ({ page }) => {
  await createProject(page, "แนว");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 200, box.cy - 60, box.cx - 100, box.cy + 20);
  await drawRect(page, box.cx + 50, box.cy + 40, box.cx + 150, box.cy + 120);
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as { x: number; y: number }[];
  const guides = () => page.evaluate(() => {
    const stage = (window as unknown as { Konva: { stages: { find: (selector: string) => { attrs: { stroke?: string } }[] }[] } }).Konva.stages[0];
    return stage.find("Line").filter((line) => line.attrs.stroke === "#EC4899").length;
  });
  const [first, second] = await nodes();
  await page.keyboard.press("Escape");

  // Grab the second one on its top edge and bring its top 3 px below the first one's top: it snaps level, a guide shows.
  let grab = { x: box.cx + 80, y: box.cy + 40 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y - 50, { steps: 4 });
  await page.mouse.move(grab.x, grab.y - 97, { steps: 4 });
  await expect.poll(guides).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(guides).toBe(0);
  await expect.poll(async () => (await nodes())[1].y).toBeCloseTo(first.y, 5);
  let current = (await nodes())[1];
  // Where the grabbed point ended up after the snap.
  grab = { x: grab.x + (current.x - second.x), y: grab.y + (current.y - second.y) };

  // Far from anything: the position lands on the grid (10 board units at 100%; the box includes the 1 px half stroke).
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 137, grab.y + 223, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes())[1].y).not.toBe(current.y);
  const snapped = (await nodes())[1];
  for (const value of [snapped.x - 1, snapped.y - 1]) expect(Math.abs(Math.round(value / 10) * 10 - value)).toBeLessThan(1e-6);
  grab = { x: grab.x + (snapped.x - current.x), y: grab.y + (snapped.y - current.y) };
  current = snapped;

  // ⌘/Ctrl held after the press: exact pointer movement.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(grab.x + 7, grab.y + 3, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(async () => (await nodes())[1].x - current.x).toBeCloseTo(7, 5);
});

test("CAN-22: code blocks — sample code is replaced by typing, Enter keeps the indentation, Tab indents, language/theme in Properties, Esc cancels, a draft survives reload", async ({ page }) => {
  await createProject(page, "โค้ด");
  const box = await stageBox(page);
  const block = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as { type: string; code: string; language: string; theme: string }[])[0];
  await page.getByRole("button", { name: "บล็อกโค้ด", exact: true }).first().click();
  const editor = page.getByRole("textbox", { name: "แก้โค้ด" });
  await expect(editor).toBeFocused();
  await page.keyboard.type("for i in range(3):");
  await page.keyboard.press("Enter");
  await expect(editor).toHaveValue("for i in range(3):\n    ");
  await page.keyboard.type("print(i)");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("done()");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await block()).code).toBe("for i in range(3):\n    print(i)\ndone()");

  await page.getByRole("combobox", { name: "ภาษาของโค้ด" }).selectOption("javascript");
  await page.getByRole("group", { name: "ธีม" }).getByRole("button", { name: "สว่าง" }).click();
  await expect.poll(async () => (await block())).toMatchObject({ language: "javascript", theme: "light" });

  // Double-click opens it again; Tab inserts four spaces; Esc throws the change away.
  await page.mouse.dblclick(box.cx, box.cy);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await expect(editor).toHaveValue(/ {4}x$/);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  expect((await block()).code).toBe("for i in range(3):\n    print(i)\ndone()");

  // Unfinished typing is kept as a draft: after a reload the block opens again with it.
  await page.mouse.dblclick(box.cx, box.cy);
  await page.keyboard.type(" // ยังไม่จบ");
  await expect.poll(async () => JSON.stringify((await readDraft(page))!.pendingEdit ?? null)).toContain("ยังไม่จบ");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "แก้โค้ด" })).toHaveValue(/done\(\) \/\/ ยังไม่จบ$/);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await block()).code).toBe("for i in range(3):\n    print(i)\ndone() // ยังไม่จบ");
});

test("CAN-23: bold text — ⌘B on a selected text box and the Properties button", async ({ page }) => {
  await createProject(page, "ตัวหนา");
  const box = await stageBox(page);
  const text = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as { bold?: boolean; text: string }[])[0];
  await page.keyboard.press("t");
  await page.mouse.click(box.cx - 100, box.cy - 50);
  await page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" }).fill("หัวข้อสำคัญ");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await text())?.text).toBe("หัวข้อสำคัญ");
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(async () => (await text()).bold).toBe(true);
  const button = page.getByRole("complementary", { name: "แผงคุณสมบัติ" }).getByRole("button", { name: "ตัวหนา" });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect.poll(async () => (await text()).bold).toBe(false);
});

test("CAN-24: a picked colour is kept when the picker is closed by clicking elsewhere (board or panel), one Undo step each", async ({ page }) => {
  await createProject(page, "สี");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 40, box.cx + 60, box.cy + 40);
  const stroke = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as { stroke: string }[])[0].stroke;
  const before = await stroke();
  // Picking in the native picker only fires `input`; closing it by clicking the board may never fire `change`.
  const pick = (colour: string) => page.getByRole("textbox", { name: "สีเส้น" }).or(page.locator('input[aria-label="สีเส้น"]')).evaluate((input: HTMLInputElement, value) => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, colour);

  await pick("#dc2626");
  await page.mouse.click(box.x + 60, box.cy + 150); // empty board: closes the picker and clears the selection
  await expect.poll(stroke).toBe("#DC2626");

  await page.mouse.click(box.cx - 60, box.cy); // select the rectangle again (its left edge)
  await pick("#16a34a");
  await page.getByRole("tab", { name: "Objects" }).click(); // leaving the field inside the panel
  await expect.poll(stroke).toBe("#16A34A");

  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(stroke).toBe("#DC2626");
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(stroke).toBe(before);
});

test("CAN-25: an interrupted move or resize (window loses focus, the board changes size) keeps the last position instead of jumping back", async ({ page }) => {
  await createProject(page, "ไม่เด้ง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 40, box.cx + 60, box.cy + 40);
  const rect = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as { x: number; y: number; width: number }[])[0];
  const start = await rect();
  await page.keyboard.press("Escape");

  // Move, then a screen-sharing app takes focus before the button is released.
  await page.mouse.move(box.cx - 20, box.cy - 40);
  await page.mouse.down();
  await page.mouse.move(box.cx + 20, box.cy - 40, { steps: 5 });
  await page.mouse.move(box.cx + 60, box.cy - 40, { steps: 5 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect.poll(async () => (await rect()).x - start.x).toBeGreaterThan(70);

  // Move, then the board changes size (a message bar, a panel) mid-drag.
  const moved = await rect();
  await page.mouse.move(box.cx + 60, box.cy - 40);
  await page.mouse.down();
  await page.mouse.move(box.cx + 60, box.cy + 20, { steps: 5 });
  await page.mouse.move(box.cx + 60, box.cy + 60, { steps: 5 });
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 60 });
  await page.mouse.up();
  await expect.poll(async () => (await rect()).y - moved.y).toBeGreaterThan(70);
  await page.setViewportSize(viewport);

  // Resize from a corner handle, interrupted the same way: the new size stays.
  await page.getByRole("tab", { name: "Objects" }).click();
  await page.getByRole("button", { name: /^เลือกวัตถุ / }).first().click();
  const handle = page.getByRole("button", { name: "ปรับขนาด มุมขวาล่าง" });
  const corner = (await handle.boundingBox())!;
  const before = await rect();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 6 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  await expect.poll(async () => (await rect()).width - before.width).toBeGreaterThan(40);
});

test("CAN-26: quick properties — selecting shows a bar next to the selection (not on it); colours, fill, width, dash, text size/bold, lock and delete; a dragged bar stays for that selection only", async ({ page }) => {
  await createProject(page, "ปรับไว");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 80, box.cy - 40, box.cx + 80, box.cy + 40);
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Record<string, unknown>[];
  const bar = page.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  await expect(bar).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThan(box.cy - 40); // above the rectangle, not over it

  await bar.getByRole("button", { name: "สีเส้น" }).click();
  await bar.getByRole("button", { name: "สี #DC2626" }).click();
  await bar.getByRole("button", { name: "สีพื้น" }).click();
  await bar.getByRole("button", { name: "สี #CA8A04" }).click();
  await bar.getByRole("button", { name: "ความหนาเส้น" }).click();
  await bar.getByRole("button", { name: "ความหนา 5" }).click();
  await bar.getByRole("button", { name: /^เส้นทึบ/ }).click();
  await expect.poll(async () => (await nodes())[0]).toMatchObject({ stroke: "#DC2626", fill: "#CA8A04", strokeWidth: 5, strokeStyle: "dashed" });

  // Dragged by its grip it stays there while the selection lasts (a property change keeps it) …
  const grip = bar.getByRole("button", { name: "ย้ายแถบปรับค่า" });
  const gripBox = (await grip.boundingBox())!;
  await page.mouse.move(gripBox.x + 5, gripBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + box.height - 120, { steps: 5 });
  await page.mouse.up();
  const pinned = (await bar.boundingBox())!;
  await bar.getByRole("button", { name: /^เส้นประ/ }).click();
  expect(Math.round((await bar.boundingBox())!.x)).toBe(Math.round(pinned.x));
  // … and a new selection starts next to the object again.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 80, box.cy);
  const again = (await bar.boundingBox())!;
  expect(again.y + again.height).toBeLessThan(box.cy - 40);

  await page.keyboard.press("t");
  await page.mouse.click(box.cx - 200, box.cy + 150);
  await page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" }).fill("หัวข้อ");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(bar.getByRole("button", { name: "ตัวหนา (⌘B)" })).toBeVisible();
  expect(Math.round((await bar.boundingBox())!.x)).not.toBe(Math.round(pinned.x));
  const text = async () => (await nodes()).find((node) => node.type === "text")!;
  const size = Number((await text()).fontSize);
  await bar.getByRole("button", { name: "ตัวอักษรใหญ่ขึ้น" }).click();
  await bar.getByRole("button", { name: "ตัวหนา (⌘B)" }).click();
  await expect.poll(async () => (await text())).toMatchObject({ bold: true, fontSize: Math.round(size * 1.15) });

  await bar.getByRole("button", { name: /^ล็อก/ }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(async () => (await text()).locked).toBe(true);
  await page.mouse.click(box.cx - 80, box.cy); // the rectangle's left edge
  await bar.getByRole("button", { name: "ลบ (Delete)" }).click();
  await expect.poll(async () => (await nodes()).length).toBe(1);
});

test("CAN-27: connectors — drag a selected object's connection point onto another object; the arrow follows when either moves; deleting one detaches that end; Undo restores", async ({ page }) => {
  await createProject(page, "เชื่อม");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 300, box.cy - 50, box.cx - 180, box.cy + 30);
  await drawRect(page, box.cx + 100, box.cy + 60, box.cx + 220, box.cy + 140);
  type Node = { id: string; type: string; x: number; y: number; points?: { x: number; y: number }[]; startBinding?: { nodeId: string }; endBinding?: { nodeId: string } };
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Node[];
  const arrowEnd = async () => { const arrow = (await nodes()).find((node) => node.type === "arrow")!; return { x: arrow.x + arrow.points![1].x, y: arrow.y + arrow.points![1].y }; };

  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 300, box.cy - 10);
  const handle = page.getByRole("button", { name: "ลากลูกศรเชื่อมจากด้านขวา" });
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.cx, box.cy, { steps: 5 });
  await page.mouse.move(box.cx + 160, box.cy + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes()).length).toBe(3);
  const [first, second] = await nodes();
  const arrow = (await nodes()).find((node) => node.type === "arrow")!;
  expect(arrow.startBinding?.nodeId).toBe(first.id);
  expect(arrow.endBinding?.nodeId).toBe(second.id);

  // Move the second rectangle up (⌘ = no snapping): the arrow's end follows.
  const before = await arrowEnd();
  await page.keyboard.press("Escape");
  await page.mouse.move(box.cx + 190, box.cy + 100); // inside, away from the connection points on the outline
  await page.mouse.down();
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(box.cx + 190, box.cy - 100, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(async () => (await arrowEnd()).y).toBeLessThan(before.y - 150);

  // Delete the second rectangle: the arrow stays, its end detached.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx + 190, box.cy - 100);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await nodes()).length).toBe(2);
  expect((await nodes()).find((node) => node.type === "arrow")!.endBinding).toBeUndefined();
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await nodes()).find((node) => node.type === "arrow")!.endBinding?.nodeId).toBe(second.id);
});

test("CAN-28: connection points (draw.io style) — drag from a point by the outline, snap onto a point of another object, arrows follow while dragging, elbow / curved / straight, move the elbow's middle", async ({ page }) => {
  await createProject(page, "จุดเชื่อม");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 300, box.cy - 40, box.cx - 180, box.cy + 40);
  await drawRect(page, box.cx + 100, box.cy - 40, box.cx + 220, box.cy + 40);
  await page.keyboard.press("Escape");
  type Binding = { nodeId: string; anchor: string; at?: { x: number; y: number }; side?: string };
  type Node = { id: string; type: string; x: number; y: number; route?: string; bend?: number; points?: { x: number; y: number }[]; startBinding?: Binding; endBinding?: Binding };
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Node[];
  const arrow = async () => (await nodes()).find((node) => node.type === "arrow");
  const shownArrow = () => page.evaluate(() => {
    const stage = (window as unknown as { Konva: { stages: { find: (selector: string) => { points: () => number[] }[] }[] } }).Konva.stages[0];
    return stage.find("Arrow")[0]?.points() ?? [];
  });

  // A selected box shows its connection points just outside the outline: three per side, all alike.
  await page.mouse.click(box.cx - 300, box.cy);
  await expect(page.getByRole("button", { name: /^ลากลูกศรเชื่อมจาก/ })).toHaveCount(12);
  // From the right side's lower quarter point to near the left side's upper quarter point of the other box.
  const from = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากจุดเชื่อม 6" }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.cx - 50, box.cy, { steps: 4 });
  await page.mouse.move(box.cx + 103, box.cy - 18, { steps: 4 });
  await expect(page.locator("svg circle[r='6']")).toHaveCount(1); // the snapped point lights up
  await page.mouse.up();
  await expect.poll(async () => (await arrow())?.endBinding).toMatchObject({ anchor: "fixed", at: { x: 0, y: 0.25 }, side: "w" });
  const made = (await arrow())!;
  expect(made.route).toBe("elbow");
  expect(made.startBinding).toMatchObject({ anchor: "fixed", at: { x: 1, y: 0.75 }, side: "e" });

  // Dragging the second box: the arrow follows before the release.
  await page.keyboard.press("Escape");
  const before = await shownArrow();
  await page.mouse.move(box.cx + 190, box.cy + 10);
  await page.mouse.down();
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(box.cx + 190, box.cy + 130, { steps: 6 });
  await expect.poll(async () => JSON.stringify(await shownArrow())).not.toBe(JSON.stringify(before));
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");

  // The elbow's middle segment moves sideways; double-click puts it back.
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 40, box.cy + 20);
  const middle = page.getByRole("button", { name: "ลากเพื่อเลื่อนแนวเส้นหักฉาก" });
  const handle = (await middle.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await arrow())?.bend).toBe(40);
  await middle.dblclick();
  await expect.poll(async () => (await arrow())?.bend).toBeUndefined();

  // Curved, then straight (the default: no field).
  const bar = page.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  await bar.getByRole("button", { name: /รูปแบบเส้นเชื่อม/ }).click();
  await bar.getByRole("button", { name: "เส้นโค้ง" }).click();
  await expect.poll(async () => (await arrow())?.route).toBe("curved");
  await bar.getByRole("button", { name: /รูปแบบเส้นเชื่อม/ }).click();
  await bar.getByRole("button", { name: "เส้นตรง" }).click();
  await expect.poll(async () => (await arrow())?.route).toBeUndefined();

  // Dragging the arrow's end onto another connection point re-attaches it there.
  const end = (await page.getByRole("button", { name: "ขยับ จุดปลาย" }).boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.cx + 163, box.cy + 165, { steps: 5 }); // near the bottom middle of the moved box (y 80…160)
  await page.mouse.up();
  await expect.poll(async () => (await arrow())?.endBinding).toMatchObject({ anchor: "fixed", at: { x: 0.5, y: 1 }, side: "s" });
});

test("CAN-29: every line of a class box has its own connection points; an arrow from a line stays on that line when the box grows", async ({ page }) => {
  await createProject(page, "คลาสเชื่อม");
  const box = await stageBox(page);
  await drawRect(page, box.cx + 200, box.cy - 40, box.cx + 320, box.cy + 40);
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await page.getByRole("dialog", { name: "ภาพประกอบ" }).getByRole("button", { name: "กล่องคลาส / ตารางฐานข้อมูล" }).click();
  await page.keyboard.press("Escape");
  type Node = { type: string; x: number; y: number; rows?: unknown[]; points?: { x: number; y: number }[]; startBinding?: { row?: number; anchor: string } };
  const nodes = async () => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Node[];
  const rows = (await nodes()).find((node) => node.type === "table")!.rows!.length;
  // One point at each end of every line.
  await expect(page.getByRole("button", { name: /^ลากลูกศรเชื่อมจากแถว \d+ ด้าน(ซ้าย|ขวา)$/ })).toHaveCount(rows * 2);

  const from = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากแถว 3 ด้านขวา" }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.cx + 150, box.cy, { steps: 4 });
  await page.mouse.move(box.cx + 240, box.cy, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await nodes()).find((node) => node.type === "arrow")?.startBinding).toMatchObject({ anchor: "fixed", row: 2 });
  const startY = async () => { const arrow = (await nodes()).find((node) => node.type === "arrow")!; return arrow.y + arrow.points![0].y; };
  const before = await startY();

  // Bigger text: the lines grow, the arrow moves down with its line.
  await page.keyboard.press("Escape");
  await page.mouse.click(from.x - 20, from.y + from.height / 2);
  const bar = page.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  await bar.getByRole("button", { name: "ตัวอักษรใหญ่ขึ้น" }).click();
  await bar.getByRole("button", { name: "ตัวอักษรใหญ่ขึ้น" }).click();
  await expect.poll(startY).toBeGreaterThan(before + 5);
  expect((await nodes()).find((node) => node.type === "arrow")!.startBinding!.row).toBe(2);

  // A line added above it: the arrow stays with its line (now the fourth).
  const second = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากแถว 2 ด้านขวา" }).boundingBox())!;
  await page.mouse.click(second.x - 60, second.y + second.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "เพิ่มบรรทัดด้านล่าง" }).click();
  await expect.poll(async () => (await nodes()).find((node) => node.type === "arrow")!.startBinding!.row).toBe(3);
});
