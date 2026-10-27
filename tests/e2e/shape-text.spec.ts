import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "playwright/test";
import { createProject, drawRect, readDraft, stageBox } from "./helpers";

// Text inside rectangles and ellipses (plan 03 §shape text): double-click (or Enter on the selected shape) to type.

type Shape = { id: string; type: string; text?: string; fontSize?: number; color?: string; bold?: boolean; groupId?: string; width: number; height: number };
const shapes = async (page: Page) => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Shape[];
const editor = (page: Page) => page.getByRole("textbox", { name: "แก้ข้อความในรูปทรง" });
/** The strings the board draws (Konva Text nodes). */
const boardTexts = (page: Page) => page.evaluate(() => {
  // (right after a reload the board is not there yet: nothing drawn)
  const stage = (window as unknown as { Konva?: { stages: { find: (selector: string) => { text: () => string }[] }[] } }).Konva?.stages[0];
  return stage ? stage.find("Text").map((text) => text.text()) : [];
});
async function drawEllipse(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.mouse.click(x1, y1);
  await page.mouse.move(x2, y2, { steps: 3 });
  await page.mouse.click(x2, y2);
}

test("SHP-E1: double-click a rectangle, type Thai text, ⌘Enter — saved, drawn, one Undo/Redo, and still there after a reload", async ({ page }) => {
  await createProject(page, "ข้อความในกล่อง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 120, box.cy - 70, box.cx + 120, box.cy + 70);
  await page.keyboard.press("Escape");
  expect(await boardTexts(page)).toEqual([]);

  // The rectangle has no fill: a double-click inside it (not on the outline) still types in it.
  await page.mouse.dblclick(box.cx, box.cy);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("สวัสดีครับ");
  await page.keyboard.press("Enter");
  await editor(page).pressSequentially("กล่องข้อความไทย");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(async () => (await shapes(page))[0].text).toBe("สวัสดีครับ\nกล่องข้อความไทย");
  expect((await shapes(page)).length).toBe(1);
  expect(await boardTexts(page)).toEqual(["สวัสดีครับ\nกล่องข้อความไทย"]);

  // One Undo removes the whole edit; Redo brings it back.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await shapes(page))[0].text).toBeUndefined();
  expect(await boardTexts(page)).toEqual([]);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect.poll(async () => (await shapes(page))[0].text).toBe("สวัสดีครับ\nกล่องข้อความไทย");

  await page.reload();
  await expect.poll(() => boardTexts(page)).toEqual(["สวัสดีครับ\nกล่องข้อความไทย"]);
  expect((await shapes(page))[0].text).toBe("สวัสดีครับ\nกล่องข้อความไทย");
});

test("SHP-E2: an ellipse — Enter on the just-drawn shape starts typing, Esc cancels, a click outside commits, an emptied text removes the label", async ({ page }) => {
  await createProject(page, "ข้อความในวงกลม");
  const box = await stageBox(page);
  await drawEllipse(page, box.cx - 100, box.cy - 80, box.cx + 100, box.cy + 80);
  // Right after drawing the ellipse is selected: Enter types in it.
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("ยกเลิกนี้");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  expect((await shapes(page))[0].text).toBeUndefined();

  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("วงกลมของฉัน");
  await page.mouse.click(box.cx + 330, box.cy + 200); // click outside, on the empty board
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(async () => (await shapes(page))[0].text).toBe("วงกลมของฉัน");
  expect((await shapes(page))[0].type).toBe("ellipse");
  expect(await boardTexts(page)).toEqual(["วงกลมของฉัน"]);

  // Opening it again shows the text; emptying it removes the label (and one Undo brings it back).
  await page.mouse.dblclick(box.cx, box.cy);
  await expect(editor(page)).toHaveValue("วงกลมของฉัน");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => "text" in (await shapes(page))[0]).toBe(false);
  expect(await boardTexts(page)).toEqual([]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await shapes(page))[0].text).toBe("วงกลมของฉัน");
});

test("SHP-E3: text size (A−/A+), colour and bold of a shape with text; ⌘B inside the editor; the Properties panel offers them too", async ({ page }) => {
  await createProject(page, "จัดรูปแบบข้อความในกล่อง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 120, box.cy - 70, box.cx + 120, box.cy + 70);
  // A shape without text offers no text settings.
  const bar = page.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  await expect(bar.getByRole("button", { name: "สีเส้น" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "ตัวอักษรใหญ่ขึ้น" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("ขนาดตัวอักษร");
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await shapes(page))[0]).toMatchObject({ text: "ขนาดตัวอักษร", bold: true });

  await page.mouse.click(box.cx - 120, box.cy - 20); // select it (its outline)
  await bar.getByRole("button", { name: "ตัวอักษรใหญ่ขึ้น" }).click();
  await expect.poll(async () => (await shapes(page))[0].fontSize).toBe(23); // 20 × 1.15
  await bar.getByRole("button", { name: "ตัวอักษรเล็กลง" }).click();
  await expect.poll(async () => (await shapes(page))[0].fontSize).toBe(20);
  await bar.getByRole("button", { name: "สีตัวอักษร" }).click();
  await page.getByRole("button", { name: "สี #DC2626" }).click();
  await expect.poll(async () => (await shapes(page))[0].color).toBe("#DC2626");
  await bar.getByRole("button", { name: "ตัวหนา (⌘B)" }).click();
  await expect.poll(async () => (await shapes(page))[0].bold).toBe(false);
  // The stroke and fill controls are still there, and the Properties panel has the text settings.
  await expect(bar.getByRole("button", { name: "สีพื้น" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "ขนาดตัวอักษร" })).toHaveValue("20");
  await expect(page.getByRole("button", { name: "ตัวหนา", exact: true })).toBeVisible();
});

test("SHP-E4: an arrow attached to a shape stays attached (same place) when text is typed in the shape", async ({ page }) => {
  await createProject(page, "ลูกศรกับข้อความ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 240, box.cy - 60, box.cx - 60, box.cy + 60);
  await page.mouse.click(box.cx - 240, box.cy); // select it
  const dot = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากด้านขวา" }).boundingBox())!;
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.cx + 100, box.cy + 20, { steps: 6 });
  await page.mouse.up();
  type Arrow = { type: string; x: number; y: number; points: { x: number; y: number }[]; startBinding?: { nodeId: string } };
  const arrow = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as Arrow[]).find((node) => node.type === "arrow")!;
  await expect.poll(async () => (await arrow())?.startBinding?.nodeId).toBeTruthy();
  const before = await arrow();
  const id = (await shapes(page))[0].id;
  expect(before.startBinding!.nodeId).toBe(id);

  await page.keyboard.press("Escape");
  await page.mouse.dblclick(box.cx - 150, box.cy);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("ต้นทาง");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await shapes(page))[0].text).toBe("ต้นทาง");
  const after = await arrow();
  expect(after.startBinding!.nodeId).toBe(id);
  expect({ x: after.x, y: after.y, points: after.points }).toEqual({ x: before.x, y: before.y, points: before.points });
});

test("SHP-E5: in a group the first double-click picks the piece, the next one types in it", async ({ page }) => {
  await createProject(page, "กลุ่มกับข้อความ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 200, box.cy - 50, box.cx - 100, box.cy + 50);
  await drawRect(page, box.cx + 100, box.cy - 50, box.cx + 200, box.cy + 50);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect.poll(async () => (await shapes(page)).every((node) => Boolean(node.groupId))).toBe(true);
  await page.keyboard.press("Escape");

  await page.mouse.dblclick(box.cx + 150, box.cy);
  await expect(page.getByText("เลือก 1 วัตถุ")).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await page.mouse.dblclick(box.cx + 150, box.cy);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("ชิ้นในกลุ่ม");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await shapes(page)).map((node) => node.text)).toEqual([undefined, "ชิ้นในกลุ่ม"]);
  expect((await shapes(page)).every((node) => Boolean(node.groupId))).toBe(true);
});

test("SHP-E6: reloading while typing restores the shape's editor with the draft; Esc discards it", async ({ page }) => {
  await createProject(page, "กู้ข้อความในกล่อง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 120, box.cy - 70, box.cx + 120, box.cy + 70);
  await page.keyboard.press("Enter");
  await editor(page).pressSequentially("ร่างที่ยังไม่เสร็จ");
  await expect.poll(async () => (await readDraft(page))!.pendingEdit).toMatchObject({ kind: "shape", draft: { text: "ร่างที่ยังไม่เสร็จ" } });
  await page.reload();
  await expect(editor(page)).toHaveValue("ร่างที่ยังไม่เสร็จ");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  expect((await shapes(page))[0].text).toBeUndefined();
  expect(await boardTexts(page)).toEqual([]);
});

test("SHP-E7: PNG export draws the text inside the shape", async ({ page }) => {
  await createProject(page, "ส่งออกข้อความในกล่อง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 120, box.cy - 70, box.cx + 120, box.cy + 70); // 240 × 140 world units
  const exportInk = async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await page.getByRole("combobox", { name: "ความละเอียด" }).selectOption("1");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
    const bytes = await readFile((await (await pending).path())!);
    await page.keyboard.press("Escape");
    // Dark pixels well inside the outline (the outline and the padding are left out).
    return page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const margin = 48 + 14;
      const data = context.getImageData(margin, margin, bitmap.width - 2 * margin, bitmap.height - 2 * margin).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 120) ink++;
      return ink;
    }, bytes.toString("base64"));
  };
  expect(await exportInk()).toBe(0);
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(box.cx, box.cy);
  await editor(page).pressSequentially("ข้อความที่ส่งออกได้");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await shapes(page))[0].text).toBe("ข้อความที่ส่งออกได้");
  expect(await exportInk()).toBeGreaterThan(80);
});

test("SHP-E8: in the drawing room a student can type in a shape and the teacher sees it", async ({ page: host, context }) => {
  await createProject(host, "ห้องวาดร่วมข้อความในกล่อง");
  const hostBox = await stageBox(host);
  await drawRect(host, hostBox.cx - 100, hostBox.cy - 60, hostBox.cx + 100, hostBox.cy + 60);
  await host.keyboard.press("Escape");
  await host.getByRole("button", { name: /วาดร่วม/ }).click();
  await host.getByRole("button", { name: "เปิดห้องและสร้างลิงก์" }).click();
  const link = await host.getByRole("textbox", { name: "ลิงก์ห้องวาดร่วม" }).inputValue();
  await host.keyboard.press("Escape");

  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("textbox", { name: "ชื่อของคุณ" }).fill("ต้น");
  await guest.getByRole("button", { name: "เข้าห้อง" }).click();
  await expect(guest.getByTestId("save-status")).toHaveText("ห้องวาดร่วม · แก้พร้อมกันได้", { timeout: 30_000 });
  await expect.poll(async () => (await boardTexts(guest)).length).toBe(0);
  const guestBox = await stageBox(guest);
  await guest.mouse.dblclick(guestBox.cx, guestBox.cy);
  await expect(editor(guest)).toBeFocused();
  await editor(guest).pressSequentially("นักเรียนพิมพ์");
  await guest.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await shapes(host))[0].text).toBe("นักเรียนพิมพ์");
  await expect.poll(() => boardTexts(host)).toEqual(["นักเรียนพิมพ์"]);

  // The teacher edits it too and the student sees that.
  await host.mouse.dblclick(hostBox.cx, hostBox.cy);
  await expect(editor(host)).toHaveValue("นักเรียนพิมพ์");
  await host.keyboard.press("ControlOrMeta+a");
  await editor(host).pressSequentially("ครูแก้");
  await host.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => boardTexts(guest)).toEqual(["ครูแก้"]);
});
