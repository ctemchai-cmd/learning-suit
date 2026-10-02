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
