import { test, expect, type Page } from "playwright/test";
import { createProject, drawRect, readDraft, stageBox } from "./helpers";

// Drawing room in the local mode: two tabs of one browser talk through a BroadcastChannel (same protocol as Supabase Realtime).

const boardRects = (page: Page) => page.evaluate(() => {
  const stage = (window as unknown as { Konva: { stages: { find: (selector: string) => { attrs: { stroke?: string; fill?: string } }[] }[] } }).Konva.stages[0];
  return stage.find("Rect").filter((rect) => rect.attrs.stroke === "#1F2937").length;
});

test("LIVE-04: a student joins by link with a name, draws with the teacher in real time, undoes only their own step, follows the teacher's slide, and sees the room close", async ({ page: host, context }) => {
  await createProject(host, "ห้องวาดร่วม");
  const hostBox = await stageBox(host);
  await drawRect(host, hostBox.cx - 200, hostBox.cy - 100, hostBox.cx - 100, hostBox.cy - 40);
  await host.keyboard.press("Escape");

  await host.getByRole("button", { name: /วาดร่วม/ }).click();
  await host.getByRole("button", { name: "เปิดห้องและสร้างลิงก์" }).click();
  const link = await host.getByRole("textbox", { name: "ลิงก์ห้องวาดร่วม" }).inputValue();
  expect(link).toMatch(/\/live\/[0-9a-f]{32}$/);
  await host.keyboard.press("Escape");

  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("textbox", { name: "ชื่อของคุณ" }).fill("ต้น");
  await guest.getByRole("button", { name: "เข้าห้อง" }).click();
  await expect(guest.getByTestId("save-status")).toHaveText("ห้องวาดร่วม · แก้พร้อมกันได้", { timeout: 30_000 });
  await expect.poll(() => boardRects(guest)).toBe(1);
  await expect(host.getByRole("button", { name: /วาดร่วม · 2/ })).toBeVisible();
  // Students cannot manage slides.
  await expect(guest.getByRole("button", { name: "เพิ่มสไลด์" })).toBeDisabled();

  // The student draws: the teacher's lesson (saved) gets it.
  const guestBox = await stageBox(guest);
  await drawRect(guest, guestBox.cx + 50, guestBox.cy + 50, guestBox.cx + 150, guestBox.cy + 120);
  await expect.poll(async () => (await readDraft(host))!.content.document.slides[0].nodes.length).toBe(2);
  // The teacher draws: the student sees it.
  await drawRect(host, hostBox.cx + 200, hostBox.cy - 100, hostBox.cx + 260, hostBox.cy - 40);
  await expect.poll(() => boardRects(guest)).toBe(3);

  // The student's Undo removes only the student's rectangle (not the teacher's newer one).
  await guest.keyboard.press("Escape");
  await guest.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await readDraft(host))!.content.document.slides[0].nodes.length).toBe(2);
  await expect.poll(() => boardRects(guest)).toBe(2);
  await guest.getByRole("button", { name: "ทำซ้ำ" }).click();
  await expect.poll(() => boardRects(host)).toBe(3);

  // Following the teacher's slide.
  await host.getByRole("button", { name: "เพิ่มสไลด์" }).click();
  await expect(guest.getByRole("list", { name: "รายการสไลด์" }).getByRole("listitem")).toHaveCount(2);
  await expect(guest.locator("footer")).toContainText("สไลด์ 2/2");

  // Closing the room.
  await host.getByRole("button", { name: /วาดร่วม · / }).click();
  await host.getByRole("button", { name: "ปิดห้อง (ลิงก์ใช้ไม่ได้อีก)" }).click();
  await expect(guest.getByRole("alertdialog", { name: "ห้องปิดแล้ว" })).toBeVisible();
});

test("LIVE-05: Undo reverts only the fields I changed (the student's move stays), and a teacher's reload reconnects the room", async ({ page: host, context }) => {
  await createProject(host, "ห้องสอง");
  const hostBox = await stageBox(host);
  await drawRect(host, hostBox.cx - 60, hostBox.cy - 40, hostBox.cx + 60, hostBox.cy + 40);
  const rect = async () => (await readDraft(host))!.content.document.slides[0].nodes[0] as unknown as { x: number; stroke: string };
  const start = await rect();
  await host.getByRole("button", { name: /วาดร่วม/ }).click();
  await host.getByRole("button", { name: "เปิดห้องและสร้างลิงก์" }).click();
  const link = await host.getByRole("textbox", { name: "ลิงก์ห้องวาดร่วม" }).inputValue();
  await host.keyboard.press("Escape");

  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("textbox", { name: "ชื่อของคุณ" }).fill("ฝน");
  await guest.getByRole("button", { name: "เข้าห้อง" }).click();
  await expect(guest.getByTestId("save-status")).toHaveText("ห้องวาดร่วม · แก้พร้อมกันได้", { timeout: 30_000 });

  // Teacher recolours it.
  await host.mouse.click(hostBox.cx - 60, hostBox.cy);
  const bar = host.getByRole("toolbar", { name: "ปรับค่าด่วน" });
  await bar.getByRole("button", { name: "สีเส้น" }).click();
  await bar.getByRole("button", { name: "สี #DC2626" }).click();
  await expect.poll(async () => (await rect()).stroke).toBe("#DC2626");
  await host.keyboard.press("Escape");

  // Student moves it (⌘ held: no snapping).
  const guestBox = await stageBox(guest);
  await guest.mouse.move(guestBox.cx - 60, guestBox.cy);
  await guest.mouse.down();
  await guest.keyboard.down("ControlOrMeta");
  await guest.mouse.move(guestBox.cx + 40, guestBox.cy, { steps: 6 });
  await guest.mouse.up();
  await guest.keyboard.up("ControlOrMeta");
  await expect.poll(async () => (await rect()).x - start.x).toBeCloseTo(100, 0);

  // Teacher's Undo: colour back, the student's move stays.
  await host.getByRole("button", { name: "เลิกทำ" }).click();
  await expect.poll(async () => (await rect()).stroke).toBe(start.stroke);
  expect((await rect()).x - start.x).toBeCloseTo(100, 0);

  // Teacher reloads: the room comes back with the same link, the student can draw again.
  await host.reload();
  await expect(host.getByRole("button", { name: /วาดร่วม · 2/ })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId("save-status")).toHaveText("ห้องวาดร่วม · แก้พร้อมกันได้", { timeout: 30_000 });
  await drawRect(guest, guestBox.cx - 250, guestBox.cy + 80, guestBox.cx - 150, guestBox.cy + 140);
  await expect.poll(async () => (await readDraft(host))!.content.document.slides[0].nodes.length).toBe(2);
});

/** World point at the middle of the board on this screen. */
const viewCentre = (page: Page) => page.evaluate(() => {
  const stage = (window as unknown as { Konva: { stages: { width: () => number; height: () => number; getLayers: () => { x: () => number; y: () => number; scaleX: () => number }[] }[] } }).Konva.stages[0];
  const layer = stage.getLayers()[1];
  return { x: (stage.width() / 2 - layer.x()) / layer.scaleX(), y: (stage.height() / 2 - layer.y()) / layer.scaleX() };
});

test("LIVE-06: students see where the teacher is looking (until they move the board themselves), find people by name, and typing keeps nothing locally", async ({ page: host, context }) => {
  await createProject(host, "ห้องสาม");
  await host.getByRole("button", { name: /วาดร่วม/ }).click();
  await host.getByRole("button", { name: "เปิดห้องและสร้างลิงก์" }).click();
  const link = await host.getByRole("textbox", { name: "ลิงก์ห้องวาดร่วม" }).inputValue();
  await host.keyboard.press("Escape");
  const hostBox = await stageBox(host);
  // The teacher scrolls far away before the student arrives.
  await host.mouse.move(hostBox.cx, hostBox.cy);
  await host.mouse.wheel(900, 700);

  const guest = await context.newPage();
  await guest.goto(link);
  await guest.getByRole("textbox", { name: "ชื่อของคุณ" }).fill("ฟ้า");
  await guest.getByRole("button", { name: "เข้าห้อง" }).click();
  await expect(guest.getByTestId("save-status")).toHaveText("ห้องวาดร่วม · แก้พร้อมกันได้", { timeout: 30_000 });
  const near = async () => { const a = await viewCentre(host), b = await viewCentre(guest); return Math.hypot(a.x - b.x, a.y - b.y) < 2; };
  await expect.poll(near).toBe(true);
  // …and keeps following while the teacher moves.
  await host.mouse.wheel(-400, 300);
  await expect.poll(near).toBe(true);

  // Moving the board myself stops following; ticking “ตามครู” goes back.
  const guestBox = await stageBox(guest);
  await guest.mouse.move(guestBox.cx, guestBox.cy);
  await guest.mouse.wheel(0, 600);
  await expect(guest.getByRole("checkbox", { name: "ตามครู" })).not.toBeChecked();
  await host.mouse.wheel(200, 0);
  await guest.waitForTimeout(600);
  expect(await near()).toBe(false);
  await guest.getByRole("checkbox", { name: "ตามครู" }).check();
  await expect.poll(near).toBe(true);

  // The student types a text: no “could not store locally” warning (a student keeps nothing on their machine).
  await guest.mouse.click(guestBox.cx + 200, guestBox.cy + 150); // focus back on the board
  await guest.keyboard.press("t");
  await guest.mouse.click(guestBox.cx, guestBox.cy);
  await guest.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" }).pressSequentially("สวัสดี");
  await guest.waitForTimeout(1500); // the unfinished text would be stored locally after a pause
  await guest.mouse.click(guestBox.cx + 200, guestBox.cy + 150);
  await expect.poll(async () => (await readDraft(host))!.content.document.slides[0].nodes.length).toBe(1);
  await expect(guest.getByText(/เก็บในเครื่องไม่สำเร็จ/)).toHaveCount(0);

  // The teacher finds the student by name: the board centres on the student's pointer.
  await guest.getByRole("checkbox", { name: "ตามครู" }).uncheck();
  await guest.mouse.wheel(0, -1500);
  await guest.waitForTimeout(300);
  await guest.mouse.move(guestBox.cx + 30, guestBox.cy + 20, { steps: 3 });
  await guest.waitForTimeout(400); // the last pointer position reaches the teacher
  await host.getByRole("button", { name: /วาดร่วม · 2/ }).click();
  await host.getByRole("button", { name: "ฟ้า" }).click();
  // The pointer sits (30, 20) px from the middle of the student's screen (zoom 1).
  await expect.poll(async () => { const a = await viewCentre(host), b = await viewCentre(guest); return [Math.round(a.x - b.x), Math.round(a.y - b.y)]; }).toEqual([30, 20]);
});

test("LIVE-07: everyone sees what the others have selected (outlined in their colour with their name) and when they are typing", async ({ page: host, context }) => {
  await createProject(host, "ห้องสี่");
  const hostBox = await stageBox(host);
  await drawRect(host, hostBox.cx - 60, hostBox.cy - 40, hostBox.cx + 60, hostBox.cy + 40);
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
  const guestBox = await stageBox(guest);

  // The student selects the rectangle: the teacher sees it outlined with the student's name.
  await guest.mouse.click(guestBox.cx - 60, guestBox.cy);
  const seenByHost = host.getByTestId("remote-selection");
  await expect(seenByHost).toHaveAttribute("data-person", "ต้น");
  await expect(seenByHost).toContainText("ต้น");
  // …and nothing once the student lets go.
  await guest.keyboard.press("Escape");
  await expect(seenByHost).toHaveCount(0);

  // The teacher selects it: the student sees “ครู”.
  await host.mouse.click(hostBox.cx - 60, hostBox.cy);
  await expect(guest.getByTestId("remote-selection")).toHaveAttribute("data-person", "ครู");
  await host.keyboard.press("Escape");
  await expect(guest.getByTestId("remote-selection")).toHaveCount(0);

  // The student types in a text box: the teacher sees “กำลังพิมพ์…”.
  await guest.keyboard.press("t");
  await guest.mouse.click(guestBox.cx + 150, guestBox.cy + 120);
  await guest.getByRole("textbox", { name: "แก้ข้อความบนกระดาน" }).pressSequentially("ส");
  await guest.keyboard.press("ControlOrMeta+Enter");
  await guest.mouse.dblclick(guestBox.cx + 155, guestBox.cy + 128);
  await expect(host.getByTestId("remote-selection")).toContainText("กำลังพิมพ์");
});
