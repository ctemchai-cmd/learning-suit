import { readFile } from "node:fs/promises";
import { test, expect, type Locator, type Page } from "playwright/test";
import { createProject, drawRect, readDraft, stageBox } from "./helpers";

// Bold for some words and alignment of shape text (plan 03 §text, §shape text): `**…**` markers in the stored text,
// drawn as bold runs without the markers; ⌘B on a selection while editing; the label of a shape aligns left/centre/right.

type Node = { id: string; type: string; text?: string; bold?: boolean; align?: string; width: number; height: number; strokeWidth?: number };
const nodes = async (page: Page) => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Node[];
const textEditor = (page: Page) => page.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" });
const shapeEditor = (page: Page) => page.getByRole("textbox", { name: "แก้ข้อความในรูปทรง" });
/** What the board draws: every Konva Text with its weight and place inside its parent. */
const boardRuns = (page: Page) => page.evaluate(() => {
  const stage = (window as unknown as { Konva?: { stages: { find: (selector: string) => { text: () => string; fontStyle: () => string; align: () => string; x: () => number; width: () => number }[] }[] } }).Konva?.stages[0];
  return stage ? stage.find("Text").map((text) => ({ text: text.text(), style: text.fontStyle(), align: text.align(), x: text.x(), width: text.width() })) : [];
});
const selected = (editor: Locator) => editor.evaluate((element) => { const area = element as HTMLTextAreaElement; return area.value.slice(area.selectionStart, area.selectionEnd); });
const select = (editor: Locator, word: string) => editor.evaluate((element, target) => {
  const area = element as HTMLTextAreaElement;
  const at = area.value.indexOf(target);
  area.focus();
  area.setSelectionRange(at, at + target.length);
}, word);
/** Keyboard selection: caret to the end, back over what follows the word, Shift+Arrow over the word (Latin text: one key per character). */
async function shiftSelect(page: Page, editor: Locator, text: string, word: string) {
  await page.keyboard.press("End");
  const after = text.length - (text.indexOf(word) + word.length);
  for (let k = 0; k < after; k++) await page.keyboard.press("ArrowLeft");
  for (let k = 0; k < word.length; k++) await page.keyboard.press("Shift+ArrowLeft");
  expect(await selected(editor)).toBe(word);
}
/** Inside the first line of the text box made by `newText` (its default place). */
async function textPoint(page: Page): Promise<[number, number]> {
  const box = await stageBox(page);
  return [box.cx - 135, box.cy - 45];
}
async function newText(page: Page, at: { dx: number; dy: number } = { dx: -150, dy: -60 }) {
  const box = await stageBox(page);
  await page.keyboard.press("t");
  await page.mouse.click(box.cx + at.dx, box.cy + at.dy);
  await expect(textEditor(page)).toBeFocused();
  return box;
}

test("RTX-E1: a text box — select a word with Shift+Arrow, ⌘B: only that word is bold on the board, the selection stays, ⌘B again undoes it, one Undo for the edit", async ({ page }) => {
  await createProject(page, "ตัวหนาบางคำ");
  await newText(page);
  const editor = textEditor(page);
  const text = "one two three";
  await editor.pressSequentially(text);
  await shiftSelect(page, editor, text, "two");

  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("one **two** three");
  expect(await selected(editor)).toBe("two");
  await expect(page.getByRole("note")).toContainText("ตัวหนา"); // the markers are explained while they are visible
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue(text);
  expect(await selected(editor)).toBe("two");
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("one **two** three");

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await nodes(page))[0]?.text).toBe("one **two** three");
  expect((await nodes(page))[0].bold).toBeUndefined();
  // On the board: three runs, markers hidden, only "two" bold.
  const runs = await boardRuns(page);
  expect(runs.map((run) => run.text)).toEqual(["one ", "two", " three"]);
  expect(runs.map((run) => run.style)).toEqual(["normal", "bold", "normal"]);

  // Reopening shows the markers again and keeps the text; Escape leaves it as it was.
  await page.mouse.dblclick(...(await textPoint(page)));
  await expect(textEditor(page)).toHaveValue("one **two** three");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await nodes(page)).length).toBe(0);
  expect(await boardRuns(page)).toEqual([]);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect.poll(async () => (await boardRuns(page)).map((run) => run.style)).toEqual(["normal", "bold", "normal"]);
});

test("RTX-E2: Thai — the selected Thai word becomes bold and the line still breaks between words; markers cut across clusters are widened", async ({ page }) => {
  await createProject(page, "ตัวหนาไทย");
  await newText(page);
  const editor = textEditor(page);
  await editor.fill("เขาไปโรงเรียนที่นี่ทุกวัน");
  await select(editor, "โรงเรียน");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("เขาไป**โรงเรียน**ที่นี่ทุกวัน");
  expect(await selected(editor)).toBe("โรงเรียน");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await nodes(page))[0]?.text).toBe("เขาไป**โรงเรียน**ที่นี่ทุกวัน");
  const runs = await boardRuns(page);
  expect(runs.map((run) => run.text).join("")).toBe("เขาไปโรงเรียนที่นี่ทุกวัน");
  expect(runs.filter((run) => run.style === "bold").map((run) => run.text)).toEqual(["โรงเรียน"]);
});

test("RTX-E3: with nothing selected ⌘B still makes the whole box bold; a literal ** that is not a pair is left alone", async ({ page }) => {
  await createProject(page, "ตัวหนาทั้งกล่อง");
  await newText(page);
  const editor = textEditor(page);
  await editor.fill("5 ** 2 ** 3");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await nodes(page))[0]?.text).toBe("5 ** 2 ** 3");
  // not a bold pair: one plain Konva Text, the stars drawn as typed
  expect(await boardRuns(page)).toMatchObject([{ text: "5 ** 2 ** 3", style: "normal" }]);
  await page.keyboard.press("ControlOrMeta+b"); // the text box is selected after committing
  await expect.poll(async () => (await nodes(page))[0].bold).toBe(true);
  expect(await boardRuns(page)).toMatchObject([{ text: "5 ** 2 ** 3", style: "bold" }]);

  // a text with a bold word and then the whole box bold: everything bold, markers hidden
  await page.mouse.dblclick(...(await textPoint(page)));
  await textEditor(page).fill("one **two** three");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await boardRuns(page)).map((run) => run.text).join("")).toBe("one two three");
  expect((await boardRuns(page)).every((run) => run.style === "bold")).toBe(true);
});

test("RTX-E4: a shape label — a bold word with Shift+Arrow, then left / right / centre from the quick bar and the Properties panel", async ({ page }) => {
  await createProject(page, "ป้ายในรูปทรง");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 150, box.cy - 70, box.cx + 150, box.cy + 70);
  await page.keyboard.press("Enter");
  const editor = shapeEditor(page);
  await expect(editor).toBeFocused();
  const text = "one two three";
  await editor.pressSequentially(text);
  await shiftSelect(page, editor, text, "two");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor).toHaveValue("one **two** three");
  expect(await selected(editor)).toBe("two");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await nodes(page))[0].text).toBe("one **two** three");
  expect((await nodes(page))[0].bold).toBeUndefined();
  expect((await boardRuns(page)).map((run) => [run.text, run.style])).toEqual([["one ", "normal"], ["two", "bold"], [" three", "normal"]]);

  const innerWidth = (await nodes(page))[0].width - 2 * (8 + 2 / 2);
  const bar = page.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  const pick = async (current: string, next: string) => {
    await bar.getByRole("button", { name: `จัดแนวข้อความ: ${current}` }).click();
    await bar.getByRole("button", { name: next, exact: true }).click();
  };
  await page.mouse.click(box.cx - 150, box.cy - 20); // select the shape by its outline
  await pick("กึ่งกลาง", "ชิดซ้าย");
  await expect.poll(async () => (await nodes(page))[0].align).toBe("left");
  let runs = await boardRuns(page);
  expect(runs[0].x).toBeCloseTo(0, 0);
  await pick("ชิดซ้าย", "ชิดขวา");
  await expect.poll(async () => (await nodes(page))[0].align).toBe("right");
  runs = await boardRuns(page);
  expect(runs[2].x + runs[2].width).toBeCloseTo(innerWidth, 0);
  // the Properties panel has the same control and reflects it
  const panel = page.getByRole("complementary", { name: "แผงคุณสมบัติ" });
  await expect(panel.getByRole("button", { name: "ชิดขวา" })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "กึ่งกลาง" }).click();
  await expect.poll(async () => (await nodes(page))[0].align).toBe("center");
  runs = await boardRuns(page);
  expect(runs[0].x).toBeCloseTo(innerWidth - (runs[2].x + runs[2].width), 0);
  expect(runs[0].x).toBeGreaterThan(5);

  // the editor shows the same alignment
  await page.mouse.dblclick(box.cx, box.cy + 50);
  await expect(shapeEditor(page)).toHaveCSS("text-align", "center");
  await page.keyboard.press("Escape");
  await panel.getByRole("button", { name: "ชิดซ้าย" }).click();
  await page.mouse.dblclick(box.cx, box.cy + 50);
  await expect(shapeEditor(page)).toHaveCSS("text-align", "left");
  await page.keyboard.press("Escape");
});

test("RTX-E5: aligned plain shape text (no bold word) and a text box keep their one-Text rendering; ellipse labels align too", async ({ page }) => {
  await createProject(page, "จัดแนวในวงกลม");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.mouse.click(box.cx - 100, box.cy - 80);
  await page.mouse.move(box.cx + 100, box.cy + 80, { steps: 3 });
  await page.mouse.click(box.cx + 100, box.cy + 80);
  await page.keyboard.press("Enter");
  await shapeEditor(page).pressSequentially("ชิดขวา");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await nodes(page))[0].text).toBe("ชิดขวา");
  expect((await nodes(page))[0].align).toBeUndefined(); // never set: centred
  expect(await boardRuns(page)).toMatchObject([{ text: "ชิดขวา", align: "center" }]);
  await page.mouse.click(box.cx, box.cy - 80); // select by the outline
  await page.getByRole("toolbar", { name: "ปรับค่าด่วน" }).getByRole("button", { name: "จัดแนวข้อความ: กึ่งกลาง" }).click();
  await page.getByRole("toolbar", { name: "ปรับค่าด่วน" }).getByRole("button", { name: "ชิดขวา", exact: true }).click();
  await expect.poll(async () => (await nodes(page))[0].align).toBe("right");
  expect(await boardRuns(page)).toMatchObject([{ text: "ชิดขวา", align: "right" }]);
});

test("RTX-E6: PNG export draws the bold word (more ink than plain, less than a fully bold box), without the markers", async ({ page }) => {
  await createProject(page, "ส่งออกตัวหนา");
  await newText(page);
  await textEditor(page).fill("สวัสดี **ครับ** ผมชื่อ Somchai");
  await page.keyboard.press("ControlOrMeta+Enter");
  const exportInk = async () => {
    await page.getByRole("button", { name: "Export" }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
    const bytes = await readFile((await (await pending).path())!);
    await page.keyboard.press("Escape");
    return page.evaluate(async (data) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let k = 0; k < pixels.length; k += 4) ink += 255 - (pixels[k] + pixels[k + 1] + pixels[k + 2]) / 3;
      return { ink, width: bitmap.width, height: bitmap.height };
    }, [...bytes]);
  };
  await expect.poll(async () => (await nodes(page))[0]?.text).toBe("สวัสดี **ครับ** ผมชื่อ Somchai");
  const wordBold = await exportInk();

  await page.keyboard.press("ControlOrMeta+b"); // whole box bold (the text box is still selected)
  await expect.poll(async () => (await nodes(page))[0].bold).toBe(true);
  const allBold = await exportInk();

  await page.keyboard.press("ControlOrMeta+b"); // normal again, then the same words without markers
  await expect.poll(async () => (await nodes(page))[0].bold).toBe(false);
  await page.mouse.dblclick(...(await textPoint(page)));
  await textEditor(page).fill("สวัสดี ครับ ผมชื่อ Somchai");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await nodes(page))[0].text).toBe("สวัสดี ครับ ผมชื่อ Somchai");
  const plain = await exportInk();

  expect(plain.ink).toBeGreaterThan(0);
  expect(wordBold.ink).toBeGreaterThan(plain.ink);
  expect(allBold.ink).toBeGreaterThan(wordBold.ink);
  expect(wordBold.width).toBeGreaterThan(0);
});
