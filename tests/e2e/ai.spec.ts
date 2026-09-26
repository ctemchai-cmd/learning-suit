import { test, expect, type Page } from "playwright/test";
import { createProject, objectRows, readDraft } from "./helpers";

// AI simulator (plan 07 §5): every answer is scripted — the page never calls an AI. The test also checks that
// no request leaves for an AI provider while the lesson runs.

type AiNode = { type: string; view: string; state: {
  history: { messages: { role: string; text: string; out?: boolean }[]; shown: number };
  thinking: { on: boolean; answer: string | null; correct: boolean | null; thoughts: string[] };
  memory: { on: boolean; items: { key: string; value: string }[]; chat: number };
  agent: { code: string; tests: string; log: string[] };
  cc: { session: number; memories: string[]; summarized: boolean };
} };
const aiNode = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === "ai-simulator")) as unknown as AiNode;
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลอง AI" });
const step = (page: Page, value: string) => panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption(value);
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("AI-01: chat history is resent every time and falls out of the window; chain of thought; memory lives in the app", async ({ page }) => {
  const aiCalls: string[] = [];
  page.on("request", (request) => { if (/anthropic|openai|claude\.ai\/api/i.test(request.url())) aiCalls.push(request.url()); });
  await createProject(page, "AI");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง AI" }).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(await objectRows(page)).toHaveText(["ai-simulator"]);
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();

  // Step 1: introduce, chat on, then ask — the introduction has fallen out of the context window.
  for (const text of ["สวัสดี ผมชื่อต้น", "ผมชอบลาเต้", "เล่าเรื่องแมวหน่อย"]) await button(page, text).click();
  await button(page, "ผมชื่ออะไรนะ?").click();
  await expect(panel(page)).toContainText("AI ลืมชื่อแล้ว");
  let node = await aiNode(page);
  expect(node.state.history.messages[0]).toMatchObject({ text: "สวัสดี ผมชื่อต้น", out: true });
  expect(node.state.history.shown).toBe(8);
  // Typing one's own message works too.
  await panel(page).getByRole("textbox", { name: "พิมพ์ข้อความเอง" }).fill("ผมชื่อบี");
  await panel(page).getByRole("button", { name: "ส่งข้อความที่พิมพ์" }).click();
  await expect(panel(page)).toContainText("ยินดีที่ได้รู้จักครับ คุณบี!");

  // Step 2: quick answer is wrong; with chain of thought it is right.
  await step(page, "thinking");
  await button(page, "ปากกากับยางลบ").click();
  await expect(panel(page)).toContainText("ตอบเร็วแต่ผิด (10 บาท)");
  await button(page, "💭 เปิด").click();
  await button(page, "ปากกากับยางลบ").click();
  await expect(panel(page)).toContainText("ตอบถูก (5 บาท)");
  node = await aiNode(page);
  expect(node.state.thinking).toMatchObject({ on: true, answer: "5 บาท", correct: true });

  // Step 3: the app remembers across chats; with memory off the new chat knows nothing.
  await step(page, "memory");
  await button(page, "ผมชื่อต้น เป็นครูสอนเขียนโปรแกรม").click();
  await button(page, "เปิดแชทใหม่").click();
  await button(page, "ผมชื่ออะไรนะ?").click();
  await expect(panel(page)).toContainText("AI ตอบ: คุณชื่อต้นครับ");
  await panel(page).getByRole("button", { name: "ปิด", exact: true }).click();
  await button(page, "ผมทำงานอะไร?").click();
  await expect(panel(page)).toContainText("Memory ปิดอยู่");
  node = await aiNode(page);
  expect(node.state.memory).toMatchObject({ on: false, chat: 2, items: [{ key: "name", value: "ต้น" }, { key: "job", value: "ครูสอนเขียนโปรแกรม" }] });
  expect(aiCalls).toEqual([]);
});

test("AI-02: Claude Code loops through tools on our machine; its memory files survive a new session", async ({ page }) => {
  await createProject(page, "Claude Code");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง AI" }).first().click();
  await step(page, "agent");
  await button(page, "ถาม AI บนเว็บ").click();
  await expect(panel(page)).toContainText("ไฟล์ในเครื่องยังไม่เปลี่ยน");
  await button(page, "สั่ง Claude Code แก้บั๊ก").click();
  await expect(panel(page)).toContainText("จนเทสต์ผ่าน");
  let node = await aiNode(page);
  expect(node.state.agent).toMatchObject({ code: "fixed", tests: "pass" });
  expect(node.state.agent.log).toContain("● Edit main.py");
  await expect(button(page, "สั่ง Claude Code แก้บั๊ก")).toBeDisabled();

  await step(page, "ccMemory");
  await expect(button(page, "บอก: ตอบเป็นภาษาไทยเสมอนะ")).toBeDisabled();
  await button(page, "เปิด session ใหม่").click();
  await button(page, "บอก: ตอบเป็นภาษาไทยเสมอนะ").click();
  await button(page, "สั่งงานใหญ่ (ใช้ context เยอะ)").click();
  await button(page, "สั่งงานใหญ่ (ใช้ context เยอะ)").click();
  await expect(panel(page)).toContainText("context เต็มจึงสรุปย่อบทสนทนาแล้ว");
  await button(page, "ปิดแล้วเปิด session ใหม่").click();
  await button(page, "ถาม: ต้องตอบเป็นภาษาอะไร?").click();
  await expect(panel(page)).toContainText("Claude ตอบได้ (จากไฟล์ความจำ)");
  node = await aiNode(page);
  expect(node.state.cc).toMatchObject({ session: 2, memories: ["ตอบเป็นภาษาไทยเสมอ"], summarized: false });

  // Undo goes back one action; the lesson reloads intact.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await page.reload();
  node = await aiNode(page);
  expect(node.state.cc.session).toBe(2);
  expect(node.view).toBe("ccMemory");
});
