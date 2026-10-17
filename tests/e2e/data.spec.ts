import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft } from "./helpers";

type DataNode = { type: string; view: string; state: {
  storage: { mode: string; cloud: string[]; screen: Record<"A" | "B", string[]> };
  categories: { id: number; name: string; kind: string; active: boolean }[]; users: { id: number; name: string }[];
  transactions: { id: number; userId: number; categoryId: number; amount: number; copiedName: string }[]; rulesOn: boolean;
  screens: Record<"A" | "B", { lines: string[] }>; version: number;
} };
const dataNode = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === "data-simulator")) as unknown as DataNode;
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลองข้อมูล" });
const step = (page: Page, value: string) => panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption(value);
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  // Packets land at once; frames still advance one by one.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("DATA-01: where data lives — the flow plays frame by frame and only the database is shared by both computers", async ({ page }) => {
  await createProject(page, "เก็บข้อมูล");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "ตัวจำลอง", exact: true })).toHaveAttribute("aria-selected", "true");
  expect((await dataNode(page)).state.version).toBe(2);

  // In the app: the transaction is gone after a refresh.
  await panel(page).getByRole("button", { name: /^A บันทึก/ }).click();
  await expect(panel(page)).toContainText("คอม A บันทึก “ค่ากาแฟ 60 บาท” แล้ว (เก็บในแอป)");
  await button(page, "A รีเฟรชหน้า").click();
  await expect(panel(page)).toContainText("รายการที่อยู่แค่ในแอป 1 รายการหายไป");

  // In the database, frame by frame: “ถัดไป” advances, both computers end with the same transaction.
  await button(page, "ฐานข้อมูล").click();
  await panel(page).getByRole("button", { name: "ทีละจังหวะ" }).click();
  await panel(page).getByRole("button", { name: /^A บันทึก/ }).click();
  await expect(panel(page)).toContainText("จังหวะ 1/2");
  await panel(page).getByRole("button", { name: "ถัดไป" }).click();
  await expect(panel(page)).toContainText("จังหวะ 2/2");
  await expect(panel(page).getByRole("button", { name: "ถัดไป" })).toBeDisabled();
  await button(page, "B เปิดแอปดูรายการ").click();
  await panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();
  const node = await dataNode(page);
  expect(node.state.storage).toMatchObject({ mode: "cloud", cloud: ["ค่ากาแฟ 60 บาท"], screen: { A: ["ค่ากาแฟ 60 บาท"], B: ["ค่ากาแฟ 60 บาท"] } });
});

test("DATA-02: a table of categories — a wrong type stops at the gate, Create adds a row, Undo and reload behave", async ({ page }) => {
  await createProject(page, "ตาราง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "table");
  await panel(page).getByRole("textbox", { name: "ประเภท (รายรับ / รายจ่าย)" }).fill("ออม");
  await button(page, "เพิ่มหมวด").click();
  await expect(panel(page)).toContainText("ประเภทต้องเป็น “รายรับ” หรือ “รายจ่าย” แต่ได้รับ “ออม”");
  expect((await dataNode(page)).state.categories).toHaveLength(4);

  await panel(page).getByRole("textbox", { name: "ประเภท (รายรับ / รายจ่าย)" }).fill("รายจ่าย");
  await button(page, "เพิ่มหมวด").click();
  await expect(panel(page)).toContainText("เพิ่ม “ของขวัญ” เป็นแถว ID 5 แล้ว");
  expect((await dataNode(page)).state.categories.at(-1)).toMatchObject({ id: 5, name: "ของขวัญ", kind: "expense", active: true });

  // Read from the computer: the screen lists the categories.
  await panel(page).getByRole("group", { name: "สิ่งที่จะทำ" }).getByRole("button", { name: "ดู", exact: true }).click();
  await button(page, "ดูหมวดทั้งหมด").click();
  await panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();
  expect((await dataNode(page)).state.screens.A.lines).toContain("เงินเดือน (รายรับ)");

  await page.getByRole("button", { name: "เลิกทำ" }).click();
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await dataNode(page)).state.categories).toHaveLength(4);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await page.reload();
  expect((await dataNode(page)).state.categories).toHaveLength(5);
  expect((await dataNode(page)).view).toBe("table");
});

test("DATA-03: linking tables — renaming a category leaves copies stale, a category with transactions cannot be deleted", async ({ page }) => {
  await createProject(page, "เชื่อมตาราง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "relation");
  // The category “อาหาร” (two transactions) is the one the panel starts on.
  await panel(page).getByRole("textbox", { name: "ชื่อใหม่" }).fill("อาหารและเครื่องดื่ม");
  await button(page, "เปลี่ยนชื่อ").click();
  await expect(panel(page)).toContainText("แบบก๊อปชื่อยังมี 2 รายการที่ชื่อหมวดเก่า");
  let node = await dataNode(page);
  expect(node.state.transactions.filter((row) => row.categoryId === 2).map((row) => row.copiedName)).toEqual(["อาหาร", "อาหาร"]);
  await panel(page).getByRole("button", { name: /^ตามแก้ชื่อหมวดที่ก๊อปไว้/ }).click();
  await expect(panel(page)).toContainText("แก้ชื่อหมวดในรายการแบบก๊อป 2 แถวแล้ว");

  await button(page, "ลบ").click();
  await button(page, "ลบหมวดนี้").click();
  await expect(panel(page)).toContainText("ลบไม่ได้: ยังมีรายการ 2 รายการของหมวด “อาหารและเครื่องดื่ม”");
  await panel(page).getByRole("button", { name: /^ลบรายการของหมวดนี้ก่อน/ }).click();
  await button(page, "ลบหมวดนี้").click();
  node = await dataNode(page);
  expect(node.state.categories.map((category) => category.id)).toEqual([1, 3, 4]);

  // A new transaction follows the category ID.
  await button(page, "บันทึกใหม่").click();
  await panel(page).getByRole("combobox", { name: "หมวด" }).selectOption("3");
  await panel(page).getByRole("textbox", { name: "จำนวนเงิน (บาท)" }).fill("1200");
  await panel(page).getByRole("button", { name: "สมชาย บันทึกเดินทาง", exact: true }).click();
  await expect(panel(page)).toContainText("บันทึกรายการ #7 (เดินทาง 1,200 บาท) แล้ว");
  expect((await dataNode(page)).state.transactions.at(-1)).toMatchObject({ id: 7, userId: 1, categoryId: 3, amount: 1200 });
});

test("DATA-04: who can see what — with the rule off computer B receives the other user's income and expenses; export includes the widget", async ({ page }) => {
  await createProject(page, "สิทธิ์");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "access");
  await panel(page).getByRole("button", { name: "ดูรายการ" }).nth(1).click();
  await panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();
  expect((await dataNode(page)).state.screens.B.lines).toEqual(["#2 อาหาร -120 บาท", "#5 เงินเดือน +30,000 บาท", "#6 ช้อปปิ้ง -890 บาท"]);

  await button(page, "ปิด").click();
  await panel(page).getByRole("button", { name: "ดูรายการ" }).nth(1).click();
  await expect(panel(page)).toContainText("สมหญิง เห็นรายรับรายจ่ายของคนอื่น 3 รายการ");
  const leaked = (await dataNode(page)).state.screens.B.lines.filter((line) => line.startsWith("⚠"));
  expect(leaked).toHaveLength(3);
  expect(leaked[0]).toBe("⚠ #1 สมชาย · เงินเดือน +25,000 บาท");

  await page.getByRole("button", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("สิทธิ์-สไลด์ 1.png");
});
