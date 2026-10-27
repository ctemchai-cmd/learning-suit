import { test, expect, type Page } from "playwright/test";
import { createProject, drawRect, readDraft, stageBox } from "./helpers";

// Connection points (plan 03 §connectors): seven per side of a box, 24 round an ellipse; the dots of a selected
// object leave out the extra ones where they would crowd (< 16 px), the drop targets of an arrow end never do.

const dots = (page: Page) => page.getByRole("button", { name: /^ลากลูกศรเชื่อมจาก/ });
async function drawEllipse(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole("button", { name: "วงกลม", exact: true }).click();
  await page.mouse.click(x1, y1);
  await page.mouse.move(x2, y2, { steps: 3 });
  await page.mouse.click(x2, y2);
}
/** Screen position of the n-th rectangle's top-left corner (read from the board itself). */
const rectCorner = (page: Page, index: number) => page.evaluate((at) => {
  const stage = (window as unknown as { Konva: { stages: { find: (selector: string) => { getAbsolutePosition: () => { x: number; y: number }; attrs: { stroke?: string } }[]; container: () => HTMLElement }[] } }).Konva.stages[0];
  const rects = stage.find("Rect").filter((rect) => rect.attrs.stroke === "#1F2937");
  const box = stage.container().getBoundingClientRect();
  const position = rects[at].getAbsolutePosition();
  return { x: box.left + position.x, y: box.top + position.y };
}, index);

test("CAN-31: twice as many connection points — 28 dots on a roomy box, fewer where they would crowd, never over a resize handle", async ({ page }) => {
  await createProject(page, "จุดเชื่อมสองเท่า");
  const box = await stageBox(page);
  // 240 × 160: every eighth is at least 20 px from the next.
  await drawRect(page, box.cx - 300, box.cy - 200, box.cx - 60, box.cy - 40);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 300, box.cy - 120);
  await expect(dots(page)).toHaveCount(28);
  // The names stay numbered for what is shown, and the middles keep their side names.
  for (const name of ["ด้านบน", "ด้านขวา", "ด้านล่าง", "ด้านซ้าย"]) await expect(page.getByRole("button", { name: `ลากลูกศรเชื่อมจาก${name}` })).toHaveCount(1);
  // No dot overlaps a resize / rotate handle or another dot.
  const rects = async (locator: ReturnType<Page["locator"]>) => (await locator.evaluateAll((elements) => elements.map((element) => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }))) as number[][];
  const dotBoxes = await rects(dots(page));
  const handleBoxes = await rects(page.getByRole("button", { name: /^(ปรับขนาด|หมุนวัตถุ)/ }));
  expect(handleBoxes.length).toBeGreaterThanOrEqual(9);
  const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  for (const dot of dotBoxes) for (const handle of handleBoxes) expect(overlap(dot, handle)).toBe(false);
  for (let i = 0; i < dotBoxes.length; i++) for (let j = i + 1; j < dotBoxes.length; j++) expect(overlap(dotBoxes[i], dotBoxes[j])).toBe(false);

  // 240 × 100: the top and bottom keep their eighths (30 px apart), the sides (12.5 px) only the quarters and the middle.
  await page.keyboard.press("Escape");
  await drawRect(page, box.cx + 60, box.cy - 200, box.cx + 300, box.cy - 100);
  await expect(dots(page)).toHaveCount(7 * 2 + 3 * 2);
  // 80 × 50: only the main ones — 12.
  await page.keyboard.press("Escape");
  await drawRect(page, box.cx - 300, box.cy + 80, box.cx - 220, box.cy + 130);
  await expect(dots(page)).toHaveCount(12);

  // Ellipses: 24 on a big one, the 12 main ones on a small one.
  await page.keyboard.press("Escape");
  await drawEllipse(page, box.cx + 60, box.cy + 20, box.cx + 260, box.cy + 220);
  await expect(dots(page)).toHaveCount(24);
  await page.keyboard.press("Escape");
  await drawEllipse(page, box.cx - 140, box.cy + 80, box.cx - 80, box.cy + 140);
  await expect(dots(page)).toHaveCount(12);
});

test("CAN-32: an arrow end dropped on a small box sees all 28 points (even those with no dot) and snaps to an eighth", async ({ page }) => {
  await createProject(page, "ปล่อยลูกศรที่จุดเชื่อม");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 300, box.cy - 80, box.cx - 100, box.cy + 80); // the source
  await drawRect(page, box.cx + 100, box.cy - 25, box.cx + 180, box.cy + 25); // 80 × 50: eighths 10 px / 6 px apart
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 300, box.cy);
  const from = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากด้านขวา" }).boundingBox())!;
  const target = await rectCorner(page, 1);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x - 40, target.y + 25, { steps: 5 });
  // On the top side, 3/8 across (30 px), 2 px below the outline: the point lights up and the other 27 are drawn too.
  await page.mouse.move(target.x + 30, target.y + 2, { steps: 5 });
  await expect(page.locator("svg.pointer-events-none circle[r='6']")).toHaveCount(1);
  await expect(page.locator("svg.pointer-events-none circle[r='3.5']")).toHaveCount(27);
  await page.mouse.up();
  type Arrow = { type: string; endBinding?: { anchor: string; at?: { x: number; y: number } } };
  await expect.poll(async () => (((await readDraft(page))!.content.document.slides[0].nodes as unknown as Arrow[]).find((node) => node.type === "arrow"))?.endBinding)
    .toMatchObject({ anchor: "fixed", at: { x: 0.375, y: 0 } });
});

test("CAN-33: a document made with the old quarter points keeps its arrow ends exactly where they were", async ({ page }) => {
  await createProject(page, "จุดเชื่อมเดิม");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 300, box.cy - 80, box.cx - 100, box.cy + 80);
  await drawRect(page, box.cx + 100, box.cy - 80, box.cx + 300, box.cy + 80);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 300, box.cy);
  // From the right side's lower quarter point (the old numbering: the 12 main points are named the same on a small box).
  const from = (await page.getByRole("button", { name: "ลากลูกศรเชื่อมจากด้านขวา" }).boundingBox())!;
  const target = await rectCorner(page, 1);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x - 40, target.y + 40, { steps: 5 });
  await page.mouse.move(target.x + 2, target.y + 40, { steps: 5 }); // the left side's quarter point (y 1/4 of 160)
  await page.mouse.up();
  type Arrow = { x: number; y: number; points: { x: number; y: number }[]; type: string; endBinding?: { at?: { x: number; y: number } } };
  const arrow = async () => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as Arrow[]).find((node) => node.type === "arrow");
  await expect.poll(async () => (await arrow())?.endBinding?.at).toEqual({ x: 0, y: 0.25 });
  const placed = (await arrow())!;
  // Reload: the stored binding resolves to the same place.
  await page.reload();
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  const again = (await arrow())!;
  expect({ x: again.x, y: again.y, points: again.points, at: again.endBinding?.at }).toEqual({ x: placed.x, y: placed.y, points: placed.points, at: { x: 0, y: 0.25 } });
});
