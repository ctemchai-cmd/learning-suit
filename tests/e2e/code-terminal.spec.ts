import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft, stageBox } from "./helpers";

type Block = { type: string; code: string; language: string; theme: string };
const block = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes as unknown as Block[])[0];
/** [text, fill] of every Text drawn on the board. */
const boardTexts = (page: Page) => page.evaluate(() => {
  const konva = (window as unknown as { Konva: { stages: { find: (selector: string) => { text: () => string; fill: () => string }[] }[] } }).Konva;
  return konva.stages.flatMap((stage) => stage.find("Text").map((node) => [node.text(), node.fill()] as [string, string]));
});
const fillOf = async (page: Page, text: string) => (await boardTexts(page)).find(([value]) => value === text)?.[1];

test("COD-03: Terminal language — picking it swaps the untouched sample, typed commands get prompt/command/flag/string colours and output stays muted", async ({ page }) => {
  await createProject(page, "เทอร์มินัล");
  const box = await stageBox(page);
  await page.getByRole("button", { name: "บล็อกโค้ด", exact: true }).first().click();
  const editor = page.getByRole("textbox", { name: "แก้โค้ด" });
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter"); // keep the Python sample as it is
  await expect(editor).toHaveCount(0);

  const picker = page.getByRole("combobox", { name: "ภาษาของโค้ด" });
  await expect(picker.locator("option", { hasText: "Terminal" })).toHaveCount(1);
  await picker.selectOption("terminal");
  await expect.poll(async () => (await block(page))).toMatchObject({ language: "terminal", theme: "dark", code: expect.stringMatching(/^\$ ssh -T/) });

  // Typed code replaces the sample; switching language afterwards keeps what was typed.
  await page.mouse.dblclick(box.cx, box.cy);
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("$ git commit -m 'first' --amend");
  await page.keyboard.press("Enter");
  await page.keyboard.type("On branch main");
  await page.keyboard.press("Enter");
  await page.keyboard.type("error: failed to push");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await block(page)).code).toBe("$ git commit -m 'first' --amend\nOn branch main\nerror: failed to push");

  await expect.poll(() => fillOf(page, "git")).toBe("#7DD3FC"); // command
  expect(await fillOf(page, "commit")).toBe("#67E8F9"); // subcommand
  expect(await fillOf(page, "-m")).toBe("#FCD34D"); // flag
  expect(await fillOf(page, "'first'")).toBe("#86EFAC"); // string
  expect(await fillOf(page, "On branch main")).toBe("#94A3B8"); // output
  expect(await fillOf(page, "error: failed to push")).toBe("#F87171"); // error
  expect((await boardTexts(page)).some(([value]) => value === "Terminal")).toBe(true); // header label

  await page.getByRole("group", { name: "ธีม" }).getByRole("button", { name: "สว่าง" }).click();
  await expect.poll(() => fillOf(page, "git")).toBe("#1D4ED8");
  await picker.selectOption("plain");
  await expect.poll(async () => (await block(page)).code).toContain("git commit");
});
