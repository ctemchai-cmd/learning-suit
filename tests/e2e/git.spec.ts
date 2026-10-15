import { test, expect, type Page } from "playwright/test";
import { createProject, objectRows, readDraft } from "./helpers";

type GitNode = { id: string; type: string; view?: string; host?: string; state: { nextCommitNumber: number; commits: Record<string, { parentId: string | null; mergeParentId?: string; message: string; snapshot: { name: string; content: string } }>; machines: Record<"A" | "B", { initialized: boolean; mainHead: string | null; originMainHead: string | null; knownCommitIds: string[]; working: { name: string; content: string } | null; index: { content: string } | null; merging?: { theirs: string; label: string } }>; remote: { mainHead: string | null; knownCommitIds: string[]; branches?: Record<string, string>; requests?: { id: number; source: string; status: string; author: string; approvedBy: string[] }[] } } };
const gitNode = async (page: Page, index = 0) => ((await readDraft(page))!.content.document.slides[0].nodes.filter((node) => node.type === "git-simulator")[index]) as unknown as GitNode;

/** The file editor drawn on the board over the widget's file area. */
const boardFile = (page: Page, machine: "A" | "B" = "A") => page.getByRole("textbox", { name: `แก้ไฟล์บนเครื่อง ${machine}` });
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลอง Git" });

async function addAndCommit(page: Page, message: string) {
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await panel(page).getByRole("textbox", { name: "ข้อความ Commit" }).fill(message);
  await panel(page).getByRole("button", { name: "Commit", exact: true }).click();
}

test("GIT-01/07: edit on the board, Add/Commit, then A → GitHub → B → GitHub → A; Undo per action; reload keeps state", async ({ page }) => {
  await createProject(page, "สอน Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await expect(page.getByRole("tab", { name: "ตัวจำลอง", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toBeVisible();

  // Step 1 (default): Python hello world on machine A, only Add/Commit in the panel.
  await expect(boardFile(page)).toHaveValue("print(\"Hello World\")\n");
  await expect(page.getByRole("textbox", { name: "ชื่อไฟล์บนเครื่อง A" })).toHaveValue("main.py");
  await expect(panel(page).getByRole("button", { name: "Push" })).toHaveCount(0);
  await expect(panel(page).getByRole("textbox", { name: /เนื้อหาไฟล์/ })).toHaveCount(0);
  await addAndCommit(page, "hello");
  await expect(panel(page)).toContainText("สร้าง C1 บนเครื่อง A แล้ว");

  // Typing on the board: Add becomes available from the draft; blur applies it as one Edit step.
  await boardFile(page).fill("print(\"สวัสดี\")\n");
  await addAndCommit(page, "thai greeting");
  await expect(panel(page)).toContainText("สร้าง C2 บนเครื่อง A แล้ว");
  let node = await gitNode(page);
  expect(node.state.commits.C1.snapshot).toEqual({ name: "main.py", content: "print(\"Hello World\")\n" });
  expect(node.state.commits.C2.snapshot.content).toBe("print(\"สวัสดี\")\n");

  // Clicking a commit previews its code (session only); clicking it again returns to the file being edited.
  await page.getByRole("button", { name: "ดูโค้ดของ C1 (เครื่อง A)" }).click();
  await expect(page.getByRole("button", { name: "เลิกดูโค้ดของ C1 (เครื่อง A)" })).toHaveAttribute("aria-pressed", "true");
  await expect(boardFile(page)).toHaveCount(0);
  await page.getByRole("button", { name: "ดูโค้ดของ C2 (เครื่อง A)" }).click();
  await expect(page.getByRole("button", { name: "เลิกดูโค้ดของ C2 (เครื่อง A)" })).toBeVisible();
  await page.getByRole("button", { name: "เลิกดูโค้ดของ C2 (เครื่อง A)" }).click();
  await expect(boardFile(page)).toHaveValue("print(\"สวัสดี\")\n");
  expect((await gitNode(page)).state.machines.A.working?.content).toBe("print(\"สวัสดี\")\n");

  // Step 2: A → Git → GitHub.
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("remote");
  await panel(page).getByRole("button", { name: "Push" }).click();
  await expect(panel(page)).toContainText("ส่ง C1, C2 ขึ้น GitHub แล้ว");
  // GitHub's file (read-only, scrollable while selected) is the whole pushed file of main, and of a clicked commit.
  await expect(page.getByRole("textbox", { name: "โค้ดบน GitHub (C2) อ่านอย่างเดียว" })).toHaveValue("print(\"สวัสดี\")\n");
  await page.getByRole("button", { name: "ดูโค้ดของ C1 (GitHub)" }).click();
  await expect(page.getByRole("textbox", { name: "โค้ดบน GitHub (C1) อ่านอย่างเดียว" })).toHaveValue("print(\"Hello World\")\n");
  await page.getByRole("button", { name: "เลิกดูโค้ดของ C1 (GitHub)" }).click();

  // Step 3: two machines.
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("full");
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Clone" }).click();
  await boardFile(page, "B").fill("print(\"from B\")\n");
  await addAndCommit(page, "update on B");
  await panel(page).getByRole("button", { name: "Push" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await panel(page).getByRole("button", { name: "Pull" }).click();
  // Clicking into a machine's file on the board makes the panel act on that machine.
  await boardFile(page, "B").click();
  await expect(panel(page).getByRole("button", { name: "เครื่อง B" })).toHaveAttribute("aria-pressed", "true");
  await boardFile(page, "A").click();
  await expect(panel(page).getByRole("button", { name: "เครื่อง A" })).toHaveAttribute("aria-pressed", "true");

  node = await gitNode(page);
  expect(node.state.machines.A).toMatchObject({ mainHead: "C3", originMainHead: "C3", knownCommitIds: ["C1", "C2", "C3"], working: { content: "print(\"from B\")\n" } });
  expect(node.state.remote).toMatchObject({ mainHead: "C3", knownCommitIds: ["C1", "C2", "C3"] });
  expect(node.state.nextCommitNumber).toBe(4);
  expect(node.view).toBe("full");

  // One Undo reverts the Pull only.
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  node = await gitNode(page);
  expect(node.state.machines.A).toMatchObject({ mainHead: "C2", originMainHead: "C2" });
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();

  await page.reload();
  await (await objectRows(page)).first().click();
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  node = await gitNode(page);
  expect(node.state.machines.A.mainHead).toBe("C3");
  await expect(panel(page)).toBeVisible();
});

/** Texts drawn on the Konva board (the widget's commit list and file preview live there, not in the DOM). */
const boardTexts = (page: Page) => page.evaluate(() => {
  const konva = (window as unknown as { Konva: { stages: { find: (selector: string) => { text: () => string }[] }[] } }).Konva;
  return konva.stages.flatMap((stage) => stage.find("Text").map((node) => node.text()));
});

test("GIT-08: a diverged Pull stops on a conflict; fixing the file and Commit joins the history, then Push works; a commit preview shows what changed", async ({ page }) => {
  await createProject(page, "Merge Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await addAndCommit(page, "hello"); // C1
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("full");
  await panel(page).getByRole("button", { name: "Push" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Clone" }).click();
  await boardFile(page, "B").fill("print(\"from B\")\n");
  await addAndCommit(page, "B change"); // C2
  await panel(page).getByRole("button", { name: "Push" }).click();

  // A committed too: GitHub refuses the Push; Pull fetches and the same line differs on both sides.
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await boardFile(page, "A").fill("print(\"from A\")\nprint(\"more\")\n");
  await addAndCommit(page, "A change"); // C3
  await expect(panel(page).getByRole("heading", { name: /กำลัง merge/ })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Push" }).click();
  await expect(panel(page)).toContainText("GitHub ปฏิเสธ Push");
  await panel(page).getByRole("button", { name: "Pull" }).click();
  await expect(panel(page).getByRole("heading", { name: "กำลัง merge: ไฟล์ชนกัน" })).toBeVisible();
  await expect(panel(page)).toContainText("แก้ในไฟล์ให้เหลือแบบที่ต้องการ");
  expect((await gitNode(page)).state.machines.A.merging).toEqual({ theirs: "C2", label: "origin/main" });
  expect(Object.keys((await gitNode(page)).state.commits)).toEqual(["C1", "C2", "C3"]); // nothing committed by itself

  // The commit preview shows the change against its parent.
  await page.getByRole("button", { name: "ดูโค้ดของ C3 (เครื่อง A)" }).click();
  await expect.poll(async () => (await boardTexts(page)).some((text) => /(^|· )\+2 −1$/.test(text))).toBe(true);
  await page.getByRole("button", { name: "เลิกดูโค้ดของ C3 (เครื่อง A)" }).click();

  // Resolve with the quick button, Add, Commit (the message box already says "Merge origin/main").
  await panel(page).getByRole("button", { name: "ใช้ของเรา" }).click();
  await expect(boardFile(page, "A")).toHaveValue("print(\"from A\")\nprint(\"more\")\n");
  await expect(panel(page).getByRole("textbox", { name: "ข้อความ Commit" })).toHaveValue("Merge origin/main");
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await panel(page).getByRole("button", { name: "Commit", exact: true }).click();
  await expect(panel(page)).toContainText("สร้าง C4 จบการ merge แล้ว");
  await expect(panel(page).getByRole("heading", { name: /กำลัง merge/ })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Push" }).click();
  await expect(panel(page)).toContainText("ส่ง C3, C4 ขึ้น GitHub แล้ว");

  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Pull" }).click();
  const node = await gitNode(page);
  expect(node.state.commits.C4).toMatchObject({ parentId: "C3", mergeParentId: "C2", message: "Merge origin/main", snapshot: { content: "print(\"from A\")\nprint(\"more\")\n" } });
  expect(node.state.remote).toMatchObject({ mainHead: "C4", knownCommitIds: ["C1", "C2", "C3", "C4"] });
  expect(node.state.machines.B).toMatchObject({ mainHead: "C4", working: { content: "print(\"from A\")\nprint(\"more\")\n" } });

  // Undo B's Pull, A's Push, Commit, Add and the quick button; then take GitHub's version instead.
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "เลิกทำ" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await expect(panel(page).getByRole("heading", { name: /กำลัง merge/ })).toBeVisible();
  await panel(page).getByRole("button", { name: "ทิ้งงานของเรา ใช้เวอร์ชัน GitHub" }).click();
  await expect(panel(page)).toContainText("ใช้เวอร์ชันของ GitHub (main = C2)");
  await expect(boardFile(page, "A")).toHaveValue("print(\"from B\")\n");
  expect((await gitNode(page)).state.machines.A).toMatchObject({ mainHead: "C2", knownCommitIds: ["C1", "C2"] });
  expect((await gitNode(page)).state.machines.A.merging).toBeUndefined();
});

test("GIT-11: two machines edit different lines → Pull merges by itself; the same line → markers, fix by hand, Add + Commit, Push", async ({ page }) => {
  await createProject(page, "Conflict Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("full");
  await boardFile(page, "A").fill("line1\nline2\nline3\nline4\nline5\n");
  await addAndCommit(page, "five lines"); // C1
  await panel(page).getByRole("button", { name: "Push" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Clone" }).click();

  // B edits line 1 and pushes; A edits line 5 (a different line) and commits.
  await boardFile(page, "B").fill("LINE1 from B\nline2\nline3\nline4\nline5\n");
  await addAndCommit(page, "B edits line 1"); // C2
  await panel(page).getByRole("button", { name: "Push" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await boardFile(page, "A").fill("line1\nline2\nline3\nline4\nLINE5 from A\n");
  await addAndCommit(page, "A edits line 5"); // C3
  await panel(page).getByRole("button", { name: "Pull" }).click();
  await expect(panel(page)).toContainText("Git รวมให้เอง: แก้คนละบรรทัด");
  await expect(panel(page).getByRole("heading", { name: /กำลัง merge/ })).toHaveCount(0);
  await expect(boardFile(page, "A")).toHaveValue("LINE1 from B\nline2\nline3\nline4\nLINE5 from A\n");
  let node = await gitNode(page);
  expect(node.state.commits.C4).toMatchObject({ parentId: "C3", mergeParentId: "C2", message: "Merge origin/main" });
  expect(node.state.machines.A.merging).toBeUndefined();
  await panel(page).getByRole("button", { name: "Push" }).click();
  await expect(panel(page)).toContainText("ส่ง C3, C4 ขึ้น GitHub แล้ว");

  // Now the SAME line: B and A both change line 3.
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Pull" }).click();
  await boardFile(page, "B").fill("LINE1 from B\nline2\nline3 by B\nline4\nLINE5 from A\n");
  await addAndCommit(page, "B edits line 3"); // C5
  await panel(page).getByRole("button", { name: "Push" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await boardFile(page, "A").fill("LINE1 from B\nline2\nline3 by A\nline4\nLINE5 from A\n");
  await addAndCommit(page, "A edits line 3"); // C6
  await panel(page).getByRole("button", { name: "Pull" }).click();

  // Markers are in the file, highlighted, and the panel explains what to do.
  const marked = "LINE1 from B\nline2\n<<<<<<< HEAD (ของเรา)\nline3 by A\n=======\nline3 by B\n>>>>>>> origin/main\nline4\nLINE5 from A\n";
  await expect(boardFile(page, "A")).toHaveValue(marked);
  await expect(panel(page).getByRole("heading", { name: "กำลัง merge: ไฟล์ชนกัน" })).toBeVisible();
  await expect(panel(page)).toContainText("ลบเครื่องหมาย <<<<<<< ======= >>>>>>> แล้ว Add + Commit");
  const stripes = page.getByTestId("git-conflict-stripes-A").locator("[data-role]");
  await expect(stripes.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-role")))).resolves.toEqual(["text", "text", "marker", "ours", "marker", "theirs", "marker", "text", "text", "text"]);
  expect((await gitNode(page)).state.machines.A).toMatchObject({ mainHead: "C6", merging: { theirs: "C5", label: "origin/main" } });

  // Commit cannot finish while marker lines are left, and push / pull are blocked.
  const commitButton = panel(page).getByRole("button", { name: "Commit", exact: true });
  await expect(commitButton).toHaveAttribute("aria-disabled", "true");
  await expect(panel(page)).toContainText("ยังมีเครื่องหมาย conflict เหลืออยู่");
  await expect(panel(page).getByRole("button", { name: "Push" })).toHaveAttribute("aria-disabled", "true");
  await expect(panel(page).getByRole("button", { name: "Pull" })).toHaveAttribute("aria-disabled", "true");

  // Abort puts the file back; Pull starts the same merge again.
  await panel(page).getByRole("button", { name: "ยกเลิก merge" }).click();
  await expect(boardFile(page, "A")).toHaveValue("LINE1 from B\nline2\nline3 by A\nline4\nLINE5 from A\n");
  await expect(panel(page).getByRole("heading", { name: /กำลัง merge/ })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Pull" }).click();
  await expect(boardFile(page, "A")).toHaveValue(marked);

  // Fix by hand: keep both lines, no markers. Add + Commit makes the merge commit; Push works.
  await boardFile(page, "A").fill("LINE1 from B\nline2\nline3 by A and B\nline4\nLINE5 from A\n");
  await expect(panel(page).getByRole("button", { name: "Add", exact: true })).toHaveAttribute("aria-disabled", "false");
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page).getByRole("textbox", { name: "ข้อความ Commit" })).toHaveValue("Merge origin/main");
  await panel(page).getByRole("button", { name: "Commit", exact: true }).click();
  await expect(panel(page)).toContainText("สร้าง C7 จบการ merge แล้ว");
  await panel(page).getByRole("button", { name: "Push" }).click();
  await expect(panel(page)).toContainText("ส่ง C6, C7 ขึ้น GitHub แล้ว");
  node = await gitNode(page);
  expect(node.state.commits.C7).toMatchObject({ parentId: "C6", mergeParentId: "C5", message: "Merge origin/main", snapshot: { content: "LINE1 from B\nline2\nline3 by A and B\nline4\nLINE5 from A\n" } });
  expect(node.state.remote.mainHead).toBe("C7");
  expect(node.state.machines.A.merging).toBeUndefined();

  // B pulls the fixed file by fast-forward.
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Pull" }).click();
  await expect(boardFile(page, "B")).toHaveValue("LINE1 from B\nline2\nline3 by A and B\nline4\nLINE5 from A\n");
});

test("GIT-12: the GitHub | GitLab switch renames the remote on the board, in the steps and in messages; one Undo; reload keeps it", async ({ page }) => {
  await createProject(page, "GitLab Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  const stepSelect = panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" });
  await stepSelect.selectOption("remote");
  const host = panel(page).getByRole("group", { name: "ที่เก็บโค้ดออนไลน์" });
  await expect(host.getByRole("button", { name: "GitHub" })).toHaveAttribute("aria-pressed", "true");
  await expect(stepSelect.locator("option").nth(1)).toHaveText("2 · A → Git → GitHub");
  expect((await gitNode(page)).host).toBeUndefined(); // documents made before the switch have no host

  await host.getByRole("button", { name: "GitLab" }).click();
  await expect(host.getByRole("button", { name: "GitLab" })).toHaveAttribute("aria-pressed", "true");
  expect((await gitNode(page)).host).toBe("gitlab");
  await expect(stepSelect.locator("option").nth(1)).toHaveText("2 · A → Git → GitLab");
  await expect(stepSelect.locator("option").nth(2)).toHaveText("3 · A+Git → GitLab → B+Git");
  await expect(panel(page).getByRole("heading", { name: "GitLab" })).toBeVisible();
  await expect.poll(async () => { const texts = await boardTexts(page); return texts.includes("GitLab") && texts.some((text) => text.includes("A → GitLab")) && !texts.some((text) => text.includes("GitHub")); }).toBe(true);

  await addAndCommit(page, "hello");
  await panel(page).getByRole("button", { name: "Push" }).click();
  const result = panel(page).locator("[aria-live=polite]");
  await expect(result).toContainText("ส่ง C1 ขึ้น GitLab แล้ว");
  await expect(result).not.toContainText("GitHub");
  await expect(page.getByRole("textbox", { name: "โค้ดบน GitLab (C1) อ่านอย่างเดียว" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ดูโค้ดของ C1 (GitLab)" })).toBeVisible();

  // Switching back is one step, and Undo/Redo move the host with the other actions.
  await host.getByRole("button", { name: "GitHub" }).click();
  expect((await gitNode(page)).host).toBe("github");
  await expect(panel(page).getByRole("heading", { name: "GitHub" })).toBeVisible(); // the step card follows the switch
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await gitNode(page)).host).toBe("gitlab");
  await page.reload();
  await (await objectRows(page)).first().click();
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  expect((await gitNode(page)).host).toBe("gitlab");
  await expect(panel(page).getByRole("group", { name: "ที่เก็บโค้ดออนไลน์" }).getByRole("button", { name: "GitLab" })).toHaveAttribute("aria-pressed", "true");
});

test("GIT-07: a locked widget exposes no Git actions until unlocked in Objects; clones are independent", async ({ page }) => {
  await createProject(page, "ล็อก Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await addAndCommit(page, "first");
  // Duplicate the widget (Cmd+D) and commit only in the copy.
  await page.keyboard.press("Escape");
  const rows = await objectRows(page);
  await rows.first().click();
  await page.keyboard.press("Meta+d");
  await expect(rows).toHaveCount(2);
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  await boardFile(page).fill("print(\"copy\")\n");
  await addAndCommit(page, "copy only");
  const original = await gitNode(page, 0);
  const copy = await gitNode(page, 1);
  expect(Object.keys(original.state.commits)).toEqual(["C1"]);
  expect(Object.keys(copy.state.commits)).toEqual(["C1", "C2"]);

  // Lock the original through Objects: it can no longer be selected, so no Git panel and no board editor.
  await objectRows(page);
  await page.getByRole("button", { name: "ล็อก git-simulator" }).last().click();
  await expect(rows.last()).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByTestId("git-overlay")).toHaveCount(0);
  await objectRows(page);
  await page.getByRole("button", { name: "ปลดล็อก git-simulator" }).click();
  await rows.last().click();
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  await expect(panel(page)).toBeVisible();
});

test("GIT-07: an unflushed board draft survives reload; an invalid file name blocks slide change until fixed", async ({ page }) => {
  await createProject(page, "กู้ไฟล์ Git");
  await page.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").first().click();
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await boardFile(page).fill("print(\"ร่างที่ยังไม่ flush\")\n");
  await expect.poll(async () => (await readDraft(page))?.pendingEdit ?? null, { timeout: 5000 }).not.toBeNull();
  await page.reload();
  await expect(boardFile(page)).toHaveValue("print(\"ร่างที่ยังไม่ flush\")\n");

  // Invalid name: switching slide is refused while the draft is invalid, with the reason on the board.
  const name = page.getByRole("textbox", { name: "ชื่อไฟล์บนเครื่อง A" });
  await name.fill("bad/name.py");
  await page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").nth(1).click();
  await expect(page.locator("footer")).toContainText("สไลด์ 1/2");
  await expect(name).toHaveValue("bad/name.py");
  await expect(page.getByTestId("git-overlay").getByRole("alert")).toBeVisible();
  await name.fill("lesson.py");
  await page.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem").nth(1).click();
  await expect(page.locator("footer")).toContainText("สไลด์ 2/2");
  const node = (await readDraft(page))!.content.document.slides[0].nodes[0] as unknown as GitNode;
  expect(node.state.machines.A.working).toEqual({ name: "lesson.py", content: "print(\"ร่างที่ยังไม่ flush\")\n" });
});

test("GIT-07: board editor keys — Tab/Enter indent Python, Esc keeps the edit (Undo reverts), invalid name can be cancelled; preview is read-only", async ({ page }) => {
  await createProject(page, "คีย์ไฟล์ Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  const file = boardFile(page);
  await file.click();
  await file.press("ControlOrMeta+a");
  await page.keyboard.type("for i in range(3):");
  await page.keyboard.press("Enter"); // one level deeper after ":"
  await page.keyboard.type("print(i)");
  await page.keyboard.press("Enter"); // keeps the indentation
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("x = 1");
  const code = "for i in range(3):\n    print(i)\nx = 1";
  await expect(file).toHaveValue(code);
  // Tab / Shift+Tab on a selection indent and outdent every line, and focus stays in the file.
  await file.press("ControlOrMeta+a");
  await page.keyboard.press("Tab");
  await expect(file).toBeFocused();
  await expect(file).toHaveValue("    for i in range(3):\n        print(i)\n    x = 1");
  await page.keyboard.press("Shift+Tab");
  await expect(file).toHaveValue(code);
  await expect(panel(page).getByRole("button", { name: "Add", exact: true })).toHaveAttribute("aria-disabled", "false");

  // Esc leaves the editor but keeps the code as one Edit step; Undo brings the old file back.
  await page.keyboard.press("Escape");
  await expect(file).not.toBeFocused();
  await expect.poll(async () => (await gitNode(page)).state.machines.A.working?.content).toBe(code);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await expect(file).toHaveValue("print(\"Hello World\")\n");

  // An invalid name keeps the editor open; "ยกเลิกการแก้" abandons the draft.
  const name = page.getByRole("textbox", { name: "ชื่อไฟล์บนเครื่อง A" });
  await name.fill("");
  await name.press("Escape");
  await expect(name).toBeFocused();
  await page.getByTestId("git-overlay").getByRole("button", { name: "ยกเลิกการแก้" }).click();
  await expect(name).toHaveValue("main.py");

  await addAndCommit(page, "hello");
  const before = JSON.stringify(await gitNode(page));
  await page.getByRole("button", { name: "ดูโค้ดของ C1 (เครื่อง A)" }).click();
  await expect(page.getByRole("button", { name: "กลับไปไฟล์ที่แก้อยู่ (เครื่อง A)" })).toBeVisible();
  expect(JSON.stringify(await gitNode(page))).toBe(before);
  await page.getByRole("button", { name: "กลับไปไฟล์ที่แก้อยู่ (เครื่อง A)" }).click();
  await expect(file).toBeVisible();
});

test("GIT-07: with a widget on the slide the Git tab offers it first; a new widget never lands on top of it", async ({ page }) => {
  await createProject(page, "สองตัวจำลอง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await addAndCommit(page, "first");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "เลือกตัวจำลอง Git ที่มีอยู่" }).click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git ใหม่" }).click();
  const nodes = (await readDraft(page))!.content.document.slides[0].nodes as unknown as { type: string; x: number; y: number }[];
  const widgets = nodes.filter((node) => node.type === "git-simulator");
  expect(widgets).toHaveLength(2);
  expect(Math.abs(widgets[0].x - widgets[1].x)).toBeGreaterThanOrEqual(40);
});

test("GIT-10: Branch step — create, commit on a branch, switch (file changes), refused dirty switch, fast-forward and a real merge", async ({ page }) => {
  await createProject(page, "Branch Git");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("branch");
  await expect(panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" })).toHaveValue("branch");
  const branchCard = panel(page).getByRole("heading", { name: "Branch (ทางแยก)" });
  await expect(branchCard).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Push" })).toHaveCount(0);

  // No commit yet: branching is refused with the reason shown.
  await expect(panel(page).getByRole("button", { name: "สร้าง branch", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(panel(page)).toContainText("ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch");

  await addAndCommit(page, "hello"); // C1 on main
  const nameInput = panel(page).getByRole("textbox", { name: "สร้าง branch ใหม่ (และสลับไปอยู่ที่นั่น)" });
  await expect(nameInput).toHaveValue("feature");
  await expect(panel(page)).toContainText("git switch -c feature");
  await panel(page).getByRole("button", { name: "สร้าง branch", exact: true }).click();
  await expect(panel(page)).toContainText("สร้าง branch feature จาก C1");
  await expect(panel(page)).toContainText("HEAD → feature");
  expect((await gitNode(page)).state.machines.A).toMatchObject({ mainHead: "C1", head: "feature", branches: { feature: "C1" } });
  await expect(nameInput).toHaveValue("feature-2");

  // Commit on the branch: main stays at C1.
  await boardFile(page).fill("print(\"feature\")\n");
  await addAndCommit(page, "feature work"); // C2
  await expect(panel(page)).toContainText("สร้าง C2 บน branch feature");
  expect((await gitNode(page)).state.machines.A).toMatchObject({ mainHead: "C1", head: "feature", branches: { feature: "C2" } });

  // Uncommitted work blocks switching; putting the file back makes it possible again.
  await boardFile(page).fill("print(\"scribble\")\n");
  await expect(panel(page).getByRole("button", { name: "สลับไป main" })).toHaveAttribute("aria-disabled", "true");
  await expect(panel(page)).toContainText("Commit งานที่ค้างก่อนสลับ branch");
  await boardFile(page).fill("print(\"feature\")\n");
  await expect(panel(page).getByRole("button", { name: "สลับไป main" })).toHaveAttribute("aria-disabled", "false");

  // Switch to main: the file is main's again. The graph names HEAD and both branches.
  await panel(page).getByRole("button", { name: "สลับไป main" }).click();
  await expect(boardFile(page)).toHaveValue("print(\"Hello World\")\n");
  await expect(panel(page)).toContainText("สลับไป branch main");
  await expect.poll(async () => (await boardTexts(page)).filter((text) => text === "HEAD → main" || text === "feature")).toEqual(expect.arrayContaining(["HEAD → main", "feature"]));

  // Fast-forward: main had no work of its own.
  await panel(page).getByRole("button", { name: "Merge feature เข้า main" }).click();
  await expect(panel(page)).toContainText("Fast-forward");
  await expect(boardFile(page)).toHaveValue("print(\"feature\")\n");
  expect((await gitNode(page)).state.machines.A).toMatchObject({ mainHead: "C2", branches: { feature: "C2" } });
  await expect(panel(page).getByRole("button", { name: "Merge feature เข้า main" })).toHaveAttribute("aria-disabled", "true");

  // A real merge: both branches get a commit and both changed the same line, so Git stops on a conflict.
  await panel(page).getByRole("button", { name: "สร้าง branch", exact: true }).click(); // feature-2 at C2
  await boardFile(page).fill("print(\"second branch\")\n");
  await addAndCommit(page, "second branch work"); // C3
  await panel(page).getByRole("button", { name: "สลับไป main" }).click();
  await boardFile(page).fill("print(\"main moved on\")\n");
  await addAndCommit(page, "main work"); // C4
  await expect(panel(page)).toContainText("Git จะหยุดให้คุณแก้ไฟล์เอง");
  await panel(page).getByRole("button", { name: "Merge feature-2 เข้า main" }).click();
  await expect(panel(page).getByRole("heading", { name: "กำลัง merge: ไฟล์ชนกัน" })).toBeVisible();
  await expect(boardFile(page)).toHaveValue("<<<<<<< HEAD (ของเรา)\nprint(\"main moved on\")\n=======\nprint(\"second branch\")\n>>>>>>> feature-2\n");
  await panel(page).getByRole("button", { name: "ใช้ของอีกฝั่ง" }).click();
  await expect(boardFile(page)).toHaveValue("print(\"second branch\")\n");
  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page).getByRole("textbox", { name: "ข้อความ Commit" })).toHaveValue("Merge branch 'feature-2'");
  await panel(page).getByRole("button", { name: "Commit", exact: true }).click();
  await expect(panel(page)).toContainText("สร้าง C5 จบการ merge แล้ว");
  const node = await gitNode(page);
  expect(node.state.commits.C5).toMatchObject({ parentId: "C4", mergeParentId: "C3", snapshot: { content: "print(\"second branch\")\n" } });
  await expect(boardFile(page)).toHaveValue("print(\"second branch\")\n");

  // A merged branch can be deleted; its commits stay.
  await panel(page).getByRole("button", { name: "ลบ branch feature", exact: true }).click();
  await expect(panel(page)).toContainText("ลบ branch feature แล้ว");
  const after = (await gitNode(page)).state.machines.A as unknown as { branches: Record<string, string>; knownCommitIds: string[] };
  expect(after.branches).toEqual({ "feature-2": "C3" });
  expect(after.knownCommitIds).toEqual(["C1", "C2", "C3", "C4", "C5"]);

  // Reload keeps the branch state; Push is not offered in this step, and other steps ask to return to main first.
  await page.reload();
  await (await objectRows(page)).first().click();
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  await expect(panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" })).toHaveValue("branch");
  await panel(page).getByRole("button", { name: "สลับไป feature-2" }).click();
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("remote");
  await expect(panel(page)).toContainText("อยู่ที่ branch feature-2");
  await expect(panel(page).getByRole("button", { name: "Push" })).toHaveAttribute("aria-disabled", "true");
  await panel(page).getByRole("button", { name: "สลับไป main" }).click();
  await expect(panel(page).getByRole("button", { name: "Push" })).toHaveAttribute("aria-disabled", "false");
});

async function reviewLesson(page: Page, host: "GitHub" | "GitLab") {
  await createProject(page, `Review ${host}`);
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Git" }).first().click();
  if (host === "GitLab") await panel(page).getByRole("group", { name: "ที่เก็บโค้ดออนไลน์" }).getByRole("button", { name: "GitLab" }).click();
  await panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption("review");
}

test("GIT-13: Merge Request loop on GitLab — protected main, branch push, open, review, self-approve refused, approve, merge, both machines pull", async ({ page }) => {
  await reviewLesson(page, "GitLab");
  await expect(panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).locator("option").nth(4)).toHaveText("5 · Merge Request (ทีม)");
  await boardFile(page, "A").fill("line1\nline2\nline3\n");
  await addAndCommit(page, "start"); // C1
  await panel(page).getByRole("button", { name: "Push", exact: true }).click();
  await expect(panel(page)).toContainText("ส่ง C1 ขึ้น GitLab แล้ว"); // the project's first push creates main
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await panel(page).getByRole("button", { name: "Clone" }).click();
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();

  // "Oops, I committed on main": the push is refused because main is protected.
  await boardFile(page, "A").fill("LINE1 by A\nline2\nline3\n");
  await addAndCommit(page, "change line 1"); // C2
  await panel(page).getByRole("button", { name: "Push", exact: true }).click();
  await expect(panel(page)).toContainText("main ถูกป้องกัน: ต้องแตก branch แล้วเปิด Merge Request");
  expect((await gitNode(page)).state.remote.mainHead).toBe("C1");

  // Branch, push the branch (the remote keeps it), open the Merge Request.
  await panel(page).getByRole("button", { name: "สร้าง branch", exact: true }).click();
  await expect(panel(page)).toContainText("git push -u origin feature");
  await panel(page).getByRole("button", { name: "Push", exact: true }).click();
  await expect(panel(page)).toContainText("ส่ง branch feature ขึ้น GitLab แล้ว");
  expect((await gitNode(page)).state.remote).toMatchObject({ mainHead: "C1", knownCommitIds: ["C1", "C2"], branches: { feature: "C2" } });
  await panel(page).getByRole("button", { name: "เปิด Merge Request: feature → main" }).click();
  await expect(panel(page)).toContainText("เปิด Merge Request !1: feature → main แล้ว");
  await expect.poll(async () => { const texts = await boardTexts(page); return texts.includes("!1 feature → main") && texts.includes("เปิดอยู่") && texts.some((text) => text.includes("รอเพื่อนอนุมัติ")); }).toBe(true);

  // The author cannot approve; the reason is shown.
  const request = panel(page).getByRole("group", { name: "Merge Request !1" });
  await expect(request.getByRole("button", { name: "อนุมัติ (Approve)" })).toHaveAttribute("aria-disabled", "true");
  await expect(request).toContainText("อนุมัติ Merge Request ของตัวเองไม่ได้");

  // The teammate (machine B) looks at the changes and approves.
  await panel(page).getByRole("button", { name: "เครื่อง B" }).click();
  await request.getByRole("button", { name: "ดูการเปลี่ยนแปลง" }).click();
  const diff = panel(page).getByRole("region", { name: "การเปลี่ยนแปลงใน Merge Request" });
  await expect(diff).toContainText("+1 −1");
  await expect(diff.locator("[data-diff=add]")).toHaveText("+ LINE1 by A");
  await expect(diff.locator("[data-diff=del]")).toHaveText("− line1");
  await expect(request.getByRole("button", { name: "Merge เข้า main" })).toHaveAttribute("aria-disabled", "true"); // not approved yet
  await request.getByRole("button", { name: "อนุมัติ (Approve)" }).click();
  await expect(panel(page)).toContainText("อนุมัติ !1 แล้ว");
  await expect.poll(async () => (await boardTexts(page)).some((text) => text.includes("Merge ได้ (fast-forward)"))).toBe(true);

  // Merge on the remote: fast-forward, branch deleted there.
  await request.getByRole("button", { name: "Merge เข้า main" }).click();
  await expect(panel(page)).toContainText("fast-forward");
  await expect(panel(page)).toContainText("ลบ branch feature บน GitLab");
  let node = await gitNode(page);
  expect(node.state.remote).toMatchObject({ mainHead: "C2", knownCommitIds: ["C1", "C2"] });
  expect(node.state.remote.branches).toBeUndefined();
  expect(node.state.remote.requests).toMatchObject([{ id: 1, source: "feature", status: "merged", author: "A", approvedBy: ["B"] }]);
  await expect.poll(async () => (await boardTexts(page)).includes("รวมแล้ว")).toBe(true);

  // Both machines: git switch main + git pull.
  await panel(page).getByRole("button", { name: "Pull", exact: true }).click();
  await expect(boardFile(page, "B")).toHaveValue("LINE1 by A\nline2\nline3\n");
  await panel(page).getByRole("button", { name: "เครื่อง A" }).click();
  await panel(page).getByRole("button", { name: "สลับไป main" }).click();
  await panel(page).getByRole("button", { name: "Pull", exact: true }).click();
  node = await gitNode(page);
  expect(node.state.machines.A).toMatchObject({ mainHead: "C2", originMainHead: "C2" });
  expect(node.state.machines.B).toMatchObject({ mainHead: "C2", working: { content: "LINE1 by A\nline2\nline3\n" } });
  await page.reload();
  await (await objectRows(page)).first().click();
  await page.getByRole("tab", { name: "ตัวจำลอง", exact: true }).click();
  expect((await gitNode(page)).state.remote.requests?.[0].status).toBe("merged");
});

test("GIT-13: on GitHub the lesson says Pull Request / PR, never Merge Request", async ({ page }) => {
  await reviewLesson(page, "GitHub");
  await expect(panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).locator("option").nth(4)).toHaveText("5 · Pull Request (ทีม)");
  await expect(panel(page).getByRole("button", { name: /เปิด Pull Request/ })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Pull Request" })).toBeVisible();
  await addAndCommit(page, "start");
  await panel(page).getByRole("button", { name: "Push", exact: true }).click();
  await boardFile(page, "A").fill("print(\"changed\")\n");
  await addAndCommit(page, "direct");
  await panel(page).getByRole("button", { name: "Push", exact: true }).click();
  await expect(panel(page)).toContainText("main ถูกป้องกัน: ต้องแตก branch แล้วเปิด Pull Request");
  await expect.poll(async () => {
    const texts = await boardTexts(page);
    return texts.includes("Pull Request") && texts.some((text) => text.includes("ยังไม่มี Pull Request")) && texts.some((text) => text.includes("(ทีม)") && text.includes("Pull Request")) && !texts.some((text) => text.includes("Merge Request") || text.includes("GitLab"));
  }).toBe(true);
  await expect(page.getByTestId("git-overlay")).toBeVisible();
  await expect(panel(page)).not.toContainText("Merge Request");
});
