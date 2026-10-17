import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft } from "./helpers";

// Progressive reveal (plan 07 §2): the teacher shows a simulator part by part. Expectations come from the lesson
// (which words belong to which part of the scene), not from the implementation.

type Widget = { type: string; view?: string; reveal?: number; state: { a?: { cmd: string }; pushes?: number } };
const widgetNode = async (page: Page, type: string) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === type)) as unknown as Widget;
const reveal = async (page: Page, type: string) => (await widgetNode(page, type)).reveal;

/** Texts drawn on the Konva board (what a viewer sees: hidden parts are not drawn at all). */
const boardTexts = (page: Page) => page.evaluate(() => {
  const konva = (window as unknown as { Konva: { stages: { find: (selector: string) => { text: () => string }[] }[] } }).Konva;
  return konva.stages.flatMap((stage) => stage.find("Text").map((node) => node.text()));
});
const drawn = async (page: Page, text: string) => (await boardTexts(page)).includes(text);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("REVEAL-01: SSH — toggle on hides the scene, parts appear one by one, an action reveals what it needs, Undo and a step change", async ({ page }) => {
  const panel = page.getByRole("region", { name: "ตัวจำลอง SSH" });
  const toggle = panel.getByRole("switch", { name: "ค่อยๆ แสดงทีละส่วน" });
  const nextButton = (label: string) => panel.getByRole("button", { name: `แสดงส่วนถัดไป: ${label}`, exact: false });
  await createProject(page, "Reveal SSH");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง SSH" }).first().click();
  await expect(panel).toBeVisible();

  // Off by default: everything is drawn, no extra controls.
  await expect(toggle).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "แสดงทั้งหมด" })).toHaveCount(0);
  await expect.poll(() => drawn(page, "~/.ssh")).toBe(true);
  expect((await widgetNode(page, "ssh-simulator")).reveal).toBeUndefined();

  // Part texts by scene piece: A / folder / host + repo / gate / keys list.
  const marks = { a: "เครื่อง A (ของเรา)", ssh: "~/.ssh", host: "repo: coffee-shop", gate: "ด่านสแกนนิ้ว", keys: "Settings → SSH keys" };
  const shown = async () => { const texts = await boardTexts(page); return Object.entries(marks).filter(([, text]) => texts.includes(text)).map(([id]) => id); };

  // On: a blank board — the frame, the title and the caption bar stay.
  await toggle.check();
  await expect(toggle).toBeChecked();
  expect(await reveal(page, "ssh-simulator")).toBe(0);
  await expect.poll(shown).toEqual([]);
  const blank = await boardTexts(page);
  expect(blank).toContain("SSH: เชื่อม GitHub ด้วย SSH");
  expect(blank.some((text) => text.startsWith("GitHub ต้องรู้ว่าเป็นเราจริง"))).toBe(true);
  expect(blank.length).toBeLessThanOrEqual(3);

  // One part per press, with the next part's name on the button.
  const labels = ["เครื่อง A (ของเรา)", "โฟลเดอร์ ~/.ssh", "GitHub และ repo", "ด่านสแกนนิ้ว", "รายการ SSH Keys"];
  const expected = [["a"], ["a", "ssh"], ["a", "ssh", "host"], ["a", "ssh", "host", "gate"], ["a", "ssh", "host", "gate", "keys"]];
  for (const [index, label] of labels.entries()) {
    await expect(nextButton(label)).toHaveText(`แสดงส่วนถัดไป: ${label} (${index + 1}/5)`);
    await nextButton(label).click();
    await expect.poll(shown).toEqual(expected[index]);
    expect(await reveal(page, "ssh-simulator")).toBe(index + 1);
  }
  await expect(panel.getByRole("button", { name: "แสดงครบทุกส่วนแล้ว (5/5)" })).toBeDisabled();

  // Hide again, show all in one press.
  await panel.getByRole("button", { name: "ซ่อนใหม่" }).click();
  await expect.poll(shown).toEqual([]);
  expect(await reveal(page, "ssh-simulator")).toBe(0);
  await panel.getByRole("button", { name: "แสดงทั้งหมด" }).click();
  await expect.poll(shown).toEqual(["a", "ssh", "host", "gate", "keys"]);
  expect(await reveal(page, "ssh-simulator")).toBe(5);
  await panel.getByRole("button", { name: "ซ่อนใหม่" }).click();

  // An action reveals what its animation needs (the machine, the door, GitHub) in the same step — not the keys list.
  await panel.getByRole("button", { name: "ลอง git push" }).click();
  await expect(panel).toContainText("เข้าไม่ได้: เครื่องเรายังไม่มีกุญแจ");
  expect(await reveal(page, "ssh-simulator")).toBe(4);
  await expect.poll(shown).toEqual(["a", "ssh", "host", "gate"]);
  expect((await widgetNode(page, "ssh-simulator")).state.a?.cmd).toBe("git push");

  // One Undo takes back the push and its reveal together.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "ssh-simulator")).toBe(0);
  expect((await widgetNode(page, "ssh-simulator")).state.a?.cmd).toBe("");
  await expect.poll(shown).toEqual([]);
  // Undo again undoes "ซ่อนใหม่" (back to all five); redo is also one step.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "ssh-simulator")).toBe(5);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  expect(await reveal(page, "ssh-simulator")).toBe(0);

  // Changing the lesson step starts hidden again; switching GitHub ↔ GitLab does not.
  await nextButton("เครื่อง A (ของเรา)").click();
  await nextButton("โฟลเดอร์ ~/.ssh").click();
  await panel.getByRole("group", { name: "เว็บที่เก็บโค้ด" }).getByRole("button", { name: "GitLab" }).click();
  expect(await reveal(page, "ssh-simulator")).toBe(2);
  await expect(nextButton("GitLab และ repo")).toBeVisible();
  await panel.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("others");
  expect(await reveal(page, "ssh-simulator")).toBe(0);
  await expect(nextButton("เครื่อง A")).toHaveText("แสดงส่วนถัดไป: เครื่อง A (1/5)");
  await expect.poll(() => drawn(page, "ด่านสแกนนิ้ว")).toBe(false);

  // Turning the mode off draws everything again.
  await toggle.uncheck();
  expect(await reveal(page, "ssh-simulator")).toBeUndefined();
  await expect.poll(() => drawn(page, "ด่านสแกนนิ้ว")).toBe(true);
});

test("REVEAL-02: Git — parts per step, Push reveals GitHub, Undo, step change; teaching mode PageDown / next button reveal before changing slide", async ({ page }) => {
  const panel = page.getByRole("region", { name: "ตัวจำลอง Git" });
  const toggle = panel.getByRole("switch", { name: "ค่อยๆ แสดงทีละส่วน" });
  const nextButton = (label: string) => panel.getByRole("button", { name: `แสดงส่วนถัดไป: ${label}`, exact: false });
  await createProject(page, "Reveal Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await expect(panel).toBeVisible();
  // A commit first (the mode is still off), then the two-machine step.
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await panel.getByRole("textbox", { name: "ข้อความ Commit" }).fill("hello");
  await panel.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(panel).toContainText("สร้าง C1 บนเครื่อง A แล้ว");
  await panel.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("full");
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => drawn(page, "เครื่อง B")).toBe(true);

  // Card titles are whole texts on the board: A / A's Git / GitHub / B / B's Git.
  const marks = { a: "เครื่อง A", aGit: "Git ของเครื่อง A", remote: "GitHub", b: "เครื่อง B", bGit: "ยังไม่ได้ Clone" };
  const shown = async () => { const texts = await boardTexts(page); return Object.entries(marks).filter(([, text]) => texts.includes(text)).map(([id]) => id); };

  await toggle.check();
  expect(await reveal(page, "git-simulator")).toBe(0);
  await expect.poll(shown).toEqual([]);
  const blank = await boardTexts(page);
  expect(blank).toContain("Git: เครื่อง A ↔ GitHub ↔ เครื่อง B");
  expect(blank.some((text) => text.startsWith("แบบจำลอง"))).toBe(true); // the footer stays
  await expect(page.getByRole("textbox", { name: "แก้ไฟล์บนเครื่อง A" })).toHaveCount(0); // no hidden editor on the board
  await expect(page.getByRole("button", { name: "ดูโค้ดของ C1 (เครื่อง A)" })).toHaveCount(0);

  await expect(nextButton("เครื่อง A: ไฟล์")).toHaveText("แสดงส่วนถัดไป: เครื่อง A: ไฟล์ (1/5)");
  await nextButton("เครื่อง A: ไฟล์").click();
  await expect.poll(shown).toEqual(["a"]);
  await expect(page.getByRole("textbox", { name: "แก้ไฟล์บนเครื่อง A" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ดูโค้ดของ C1 (เครื่อง A)" })).toHaveCount(0); // A's Git is still hidden
  await nextButton("Git ของเครื่อง A").click();
  await expect.poll(shown).toEqual(["a", "aGit"]);
  await expect(page.getByRole("button", { name: "ดูโค้ดของ C1 (เครื่อง A)" })).toBeVisible();
  await expect(nextButton("GitHub และลูกศรส่ง/รับ")).toHaveText("แสดงส่วนถัดไป: GitHub และลูกศรส่ง/รับ (3/5)");
  await panel.getByRole("button", { name: "ซ่อนใหม่" }).click();
  await expect.poll(shown).toEqual([]);

  // Push needs A's Git and GitHub: both appear with the action, B stays hidden.
  await panel.getByRole("button", { name: "Push", exact: true }).click();
  await expect(panel).toContainText("ส่ง C1 ขึ้น GitHub แล้ว");
  expect(await reveal(page, "git-simulator")).toBe(3);
  await expect.poll(shown).toEqual(["a", "aGit", "remote"]);
  expect((await widgetNode(page, "git-simulator") as unknown as { state: { remote: { mainHead: string } } }).state.remote.mainHead).toBe("C1");
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "git-simulator")).toBe(0);
  await expect.poll(shown).toEqual([]);

  // Changing the step starts hidden again.
  await panel.getByRole("button", { name: "แสดงทั้งหมด" }).click();
  expect(await reveal(page, "git-simulator")).toBe(5);
  await panel.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("remote");
  expect(await reveal(page, "git-simulator")).toBe(0);
  await expect(nextButton("เครื่อง A: ไฟล์ที่แก้อยู่")).toHaveText("แสดงส่วนถัดไป: เครื่อง A: ไฟล์ที่แก้อยู่ (1/3)");
  await panel.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("full");
  expect(await reveal(page, "git-simulator")).toBe(0);

  // Teaching mode: a second slide exists, PageDown reveals the five parts before it moves on.
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.keyboard.press("PageUp");
  await page.getByRole("button", { name: "โหมดสอน" }).click();
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  await page.keyboard.press("PageDown");
  expect(await reveal(page, "git-simulator")).toBe(1);
  await page.keyboard.press("PageDown");
  expect(await reveal(page, "git-simulator")).toBe(2);
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  // The next-slide button does the same while parts are left.
  await page.getByRole("button", { name: "สไลด์ถัดไป" }).click();
  expect(await reveal(page, "git-simulator")).toBe(3);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  expect(await reveal(page, "git-simulator")).toBe(5);
  await expect.poll(shown).toEqual(["a", "aGit", "remote", "b", "bGit"]);
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  // Nothing left: now it changes slide; PageUp goes back without touching the reveal.
  await page.keyboard.press("PageDown");
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await page.keyboard.press("PageUp");
  await expect(page.getByText("1/2", { exact: true })).toBeVisible();
  expect(await reveal(page, "git-simulator")).toBe(5);
});

test("REVEAL-03: Deploy, Data and AI — toggle, parts one by one, an action reveals what it needs, Undo, step change", async ({ page }) => {
  await createProject(page, "Reveal flows");
  const drawnAll = async (texts: string[]) => { const board = await boardTexts(page); return texts.filter((text) => board.includes(text)); };

  // ---- Deploy, step “ขึ้น Vercel”: code → GitHub → Vercel + Build → Deployments → URL → friend's computer.
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Deploy" }).first().click();
  const deploy = page.getByRole("region", { name: "ตัวจำลอง Deploy" });
  await deploy.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("vercel");
  const deployMarks = ["เครื่องเรา", "GitHub", "▲ Vercel", "Deployments", "เว็บจริง", "คอมเพื่อน"];
  await deploy.getByRole("switch", { name: "ค่อยๆ แสดงทีละส่วน" }).check();
  expect(await reveal(page, "deploy-simulator")).toBe(0);
  await expect.poll(() => drawnAll(deployMarks)).toEqual([]);
  expect(await boardTexts(page)).toContain("การ Deploy: ขึ้น Vercel");
  await expect(deploy.getByRole("button", { name: /^แสดงส่วนถัดไป/ })).toHaveText("แสดงส่วนถัดไป: เครื่องเรา: โค้ด (1/6)");
  await deploy.getByRole("button", { name: /^แสดงส่วนถัดไป/ }).click();
  await deploy.getByRole("button", { name: /^แสดงส่วนถัดไป/ }).click();
  await expect.poll(() => drawnAll(deployMarks)).toEqual(["เครื่องเรา", "GitHub"]);
  await expect(deploy.getByRole("button", { name: /^แสดงส่วนถัดไป/ })).toHaveText("แสดงส่วนถัดไป: Vercel และ Build (3/6)");
  // Pushing needs Vercel, its list and the site: they appear with the action; the friend's computer stays hidden.
  await deploy.getByRole("button", { name: "ส่งโค้ดขึ้น (Deploy)" }).click();
  await expect(deploy).toContainText("Deploy");
  expect(await reveal(page, "deploy-simulator")).toBe(5);
  await expect.poll(() => drawnAll(deployMarks)).toEqual(["เครื่องเรา", "GitHub", "▲ Vercel", "Deployments", "เว็บจริง"]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "deploy-simulator")).toBe(2);
  await expect.poll(() => drawnAll(deployMarks)).toEqual(["เครื่องเรา", "GitHub"]);
  await deploy.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("overall");
  expect(await reveal(page, "deploy-simulator")).toBe(0);

  // ---- Data, step “ตาราง”: computer → check gate → database → the categories table.
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  const data = page.getByRole("region", { name: "ตัวจำลองข้อมูล" });
  await data.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("table");
  const dataMarks = ["คอม A · แอปรายรับรายจ่าย", "ตรวจชนิดข้อมูล", "ฐานข้อมูล · ตาราง “หมวด”", "ใช้อยู่"];
  await data.getByRole("switch", { name: "ค่อยๆ แสดงทีละส่วน" }).check();
  await expect.poll(() => drawnAll(dataMarks)).toEqual([]);
  await expect(data.getByRole("button", { name: /^แสดงส่วนถัดไป/ })).toHaveText("แสดงส่วนถัดไป: แอปบนคอมพิวเตอร์ A (1/4)");
  await data.getByRole("button", { name: /^แสดงส่วนถัดไป/ }).click();
  await expect.poll(() => drawnAll(dataMarks)).toEqual(["คอม A · แอปรายรับรายจ่าย"]);
  await data.getByRole("group", { name: "สิ่งที่จะทำ" }).getByRole("button", { name: "ดู", exact: true }).click();
  await data.getByRole("button", { name: "ดูหมวดทั้งหมด" }).click();
  expect(await reveal(page, "data-simulator")).toBe(4);
  await expect.poll(() => drawnAll(dataMarks)).toEqual(dataMarks);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "data-simulator")).toBe(1);
  await data.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("access");
  expect(await reveal(page, "data-simulator")).toBe(0);

  // ---- AI, step “ทำไม AI จำแชทได้”: chat app → the model → what it received this turn.
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง AI" }).first().click();
  const ai = page.getByRole("region", { name: "ตัวจำลอง AI" });
  const aiMarks = ["แอปแชท", "โมเดล AI", "ได้รับรอบนี้"];
  await ai.getByRole("switch", { name: "ค่อยๆ แสดงทีละส่วน" }).check();
  await expect.poll(() => drawnAll(aiMarks)).toEqual([]);
  await ai.getByRole("button", { name: /^แสดงส่วนถัดไป/ }).click();
  await ai.getByRole("button", { name: /^แสดงส่วนถัดไป/ }).click();
  await expect.poll(() => drawnAll(aiMarks)).toEqual(["แอปแชท", "โมเดล AI"]);
  await ai.getByRole("button", { name: "สวัสดี ผมชื่อต้น" }).click();
  expect(await reveal(page, "ai-simulator")).toBe(3);
  await expect.poll(() => drawnAll(aiMarks)).toEqual(aiMarks);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect(await reveal(page, "ai-simulator")).toBe(2);
  await ai.getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("thinking");
  expect(await reveal(page, "ai-simulator")).toBe(0);

  // Teaching mode picks them up: PageDown reveals the selected widget's next part (AI is selected).
  await page.getByRole("button", { name: "โหมดสอน" }).click();
  await page.keyboard.press("PageDown");
  expect(await reveal(page, "ai-simulator")).toBe(1);
});
