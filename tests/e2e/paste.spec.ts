import { test, expect, type Page } from "playwright/test";
import { createProject, drawRect, readDraft, stageBox } from "./helpers";

// Pasting pictures from the system clipboard (⌘V and right-click → วาง). Paste events are dispatched with real
// DataTransfer objects so both engines are covered; the right-click path reads navigator.clipboard (Chromium).

type Node = { type: string };
const nodes = async (page: Page) => (await readDraft(page))!.content.document.slides[0].nodes as unknown as Node[];
const imageCount = async (page: Page) => (await nodes(page)).filter((node) => node.type === "image").length;
const assetTypes = async (page: Page) => Object.values((await readDraft(page))!.content.document.assets as Record<string, { mimeType: string }>).map((asset) => asset.mimeType);

/** Dispatches a paste whose clipboard holds the given parts (built in the page). */
async function paste(page: Page, parts: { png?: boolean; svg?: boolean; html?: string; text?: string }) {
  await page.evaluate(async ({ png, svg, html, text }) => {
    const data = new DataTransfer();
    if (png) {
      const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
      const context = canvas.getContext("2d")!; context.fillStyle = "#DC2626"; context.fillRect(0, 0, 120, 80);
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
      data.items.add(new File([blob], "screenshot.png", { type: "image/png" }));
    }
    if (svg) data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="90" height="60"><rect width="90" height="60" fill="#2563EB"/></svg>'], "shape.svg", { type: "image/svg+xml" }));
    if (html) data.setData("text/html", html);
    if (text) data.setData("text/plain", text);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, parts);
}

const pngDataUrl = (page: Page) => page.evaluate(() => {
  const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 40;
  canvas.getContext("2d")!.fillRect(0, 0, 40, 40);
  return canvas.toDataURL("image/png");
});

test("PASTE-01: ⌘V puts a copied picture on the board — screenshots, other formats (converted to PNG), a picture copied as a link; a link the site won't share explains what to do", async ({ page }) => {
  await createProject(page, "วางรูป");
  const box = await stageBox(page);
  await page.mouse.click(box.cx, box.cy);

  await paste(page, { png: true });
  await expect.poll(() => imageCount(page)).toBe(1);

  await paste(page, { svg: true });
  await expect.poll(() => imageCount(page)).toBe(2);
  expect(await assetTypes(page)).toEqual(["image/png", "image/png"]);

  const dataUrl = await pngDataUrl(page);
  await paste(page, { html: `<p>รูป</p><img src="${dataUrl}">` });
  await expect.poll(() => imageCount(page)).toBe(3);

  await paste(page, { html: '<img src="https://127.0.0.1:9/blocked.png">' });
  await expect(page.getByText(/วางรูปไม่ได้: สิ่งที่คัดลอกมาเป็นลิงก์ของรูป/)).toBeVisible();
  expect(await imageCount(page)).toBe(3);
});

test("PASTE-02: the newest copy wins — objects copied in the app after a picture paste as objects", async ({ page }) => {
  await createProject(page, "วางวัตถุ");
  const box = await stageBox(page);
  await drawRect(page, box.cx - 60, box.cy - 40, box.cx + 60, box.cy + 40);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.cx - 60, box.cy);
  await page.keyboard.press("ControlOrMeta+c");
  // The in-app copy marked the system clipboard: a paste carrying that marker pastes the objects, not a picture.
  await paste(page, { text: "[Learning Suit] 1 วัตถุ" });
  await expect.poll(async () => (await nodes(page)).filter((node) => node.type === "rectangle").length).toBe(2);
  expect(await imageCount(page)).toBe(0);
});

test("PASTE-03: right-click → วาง reads a picture from the system clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "navigator.clipboard permissions are only grantable in Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createProject(page, "คลิกขวาวาง");
  const box = await stageBox(page);
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 60; canvas.height = 60;
    canvas.getContext("2d")!.fillRect(0, 0, 60, 60);
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await page.mouse.click(box.cx + 100, box.cy + 50, { button: "right" });
  await page.getByRole("menuitem", { name: "วาง" }).click();
  await expect.poll(() => imageCount(page)).toBe(1);
});
