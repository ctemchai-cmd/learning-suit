import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft } from "./helpers";

type DataNode = { type: string; view: string; state: {
  storage: { mode: string; cloud: string[]; screen: Record<"A" | "B", string[]> };
  menu: { id: number; name: string; price: number }[]; customers: { id: number; name: string }[];
  orders: { id: number; customerId: number; copiedName: string }[]; rulesOn: boolean; phones: Record<"A" | "B", { lines: string[] }>;
} };
const dataNode = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === "data-simulator")) as unknown as DataNode;
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลองข้อมูล" });
const step = (page: Page, value: string) => panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption(value);
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });

test.beforeEach(async ({ page }) => {
  // Packets land at once; frames still advance one by one.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("DATA-01: where data lives — the flow plays frame by frame and only the database is shared by both phones", async ({ page }) => {
  await createProject(page, "เก็บข้อมูล");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("tab", { name: "ตัวจำลอง", exact: true })).toHaveAttribute("aria-selected", "true");

  // In the app: the order is gone after a refresh.
  await panel(page).getByRole("button", { name: /^A สั่ง/ }).click();
  await expect(panel(page)).toContainText("A สั่งลาเต้แล้ว (เก็บในแอป)");
  await button(page, "A รีเฟรชหน้า").click();
  await expect(panel(page)).toContainText("ออเดอร์ที่อยู่แค่ในแอป 1 รายการหายไป");

  // In the database, frame by frame: “ถัดไป” advances, both phones end with the same order.
  await button(page, "ฐานข้อมูล").click();
  await panel(page).getByRole("button", { name: "ทีละจังหวะ" }).click();
  await panel(page).getByRole("button", { name: /^A สั่ง/ }).click();
  await expect(panel(page)).toContainText("จังหวะ 1/2");
  await panel(page).getByRole("button", { name: "ถัดไป ▶" }).click();
  await expect(panel(page)).toContainText("จังหวะ 2/2");
  await expect(panel(page).getByRole("button", { name: "ถัดไป ▶" })).toBeDisabled();
  await button(page, "B เปิดแอปดูออเดอร์").click();
  await panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();
  const node = await dataNode(page);
  expect(node.state.storage).toMatchObject({ mode: "cloud", cloud: ["ลาเต้"], screen: { A: ["ลาเต้"], B: ["ลาเต้"] } });
});

test("DATA-02: a table — a wrong type stops at the gate, Create adds a row, Undo and reload behave", async ({ page }) => {
  await createProject(page, "ตาราง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "table");
  await panel(page).getByRole("textbox", { name: "ราคา (ตัวเลข)" }).fill("ห้าสิบ");
  await button(page, "เพิ่มเมนู").click();
  await expect(panel(page)).toContainText("ราคาต้องเป็นตัวเลข แต่ได้รับ “ห้าสิบ”");
  expect((await dataNode(page)).state.menu).toHaveLength(4);

  await panel(page).getByRole("textbox", { name: "ราคา (ตัวเลข)" }).fill("65");
  await button(page, "เพิ่มเมนู").click();
  await expect(panel(page)).toContainText("เพิ่ม “มอคค่า” เป็นแถว ID 5 แล้ว");
  expect((await dataNode(page)).state.menu.at(-1)).toMatchObject({ id: 5, name: "มอคค่า", price: 65 });

  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await dataNode(page)).state.menu).toHaveLength(4);
  await page.getByRole("button", { name: "ทำซ้ำ" }).click();
  await page.reload();
  expect((await dataNode(page)).state.menu).toHaveLength(5);
  expect((await dataNode(page)).view).toBe("table");
});

test("DATA-03: linking tables — renaming leaves copies stale, a customer with orders cannot be deleted", async ({ page }) => {
  await createProject(page, "เชื่อมตาราง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "relation");
  await panel(page).getByRole("textbox", { name: "ชื่อใหม่" }).fill("สมชาย ใจดี");
  await button(page, "เปลี่ยนชื่อ").click();
  await expect(panel(page)).toContainText("แบบก๊อปชื่อยังมี 2 ออเดอร์ที่ชื่อเก่า");
  let node = await dataNode(page);
  expect(node.state.orders.filter((order) => order.customerId === 1).map((order) => order.copiedName)).toEqual(["สมชาย", "สมชาย"]);
  await panel(page).getByRole("button", { name: /^ตามแก้ชื่อที่ก๊อปไว้/ }).click();
  await expect(panel(page)).toContainText("แก้ชื่อในออเดอร์แบบก๊อป 2 แถวแล้ว");

  await button(page, "ลบ").click();
  await button(page, "ลบลูกค้าคนนี้").click();
  await expect(panel(page)).toContainText("ลบไม่ได้: ยังมีออเดอร์ 2 รายการ");
  await panel(page).getByRole("button", { name: /^ลบออเดอร์ของเขาก่อน/ }).click();
  await button(page, "ลบลูกค้าคนนี้").click();
  node = await dataNode(page);
  expect(node.state.customers.map((customer) => customer.id)).toEqual([2, 3]);
});

test("DATA-04: who can see what — with the rule off phone B receives other customers' orders; export includes the widget", async ({ page }) => {
  await createProject(page, "สิทธิ์");
  await page.getByRole("button", { name: "เพิ่มตัวจำลองข้อมูล" }).first().click();
  await step(page, "access");
  await panel(page).getByRole("button", { name: "ดูออเดอร์" }).nth(1).click();
  await panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();
  expect((await dataNode(page)).state.phones.B.lines).toEqual(["#2 สมหญิง · ชาเขียว ×2", "#5 สมหญิง · อเมริกาโน่ ×1"]);

  await button(page, "ปิด").click();
  await panel(page).getByRole("button", { name: "ดูออเดอร์" }).nth(1).click();
  await expect(panel(page)).toContainText("สมหญิง เห็นออเดอร์ของคนอื่น 3 รายการ");
  const leaked = (await dataNode(page)).state.phones.B.lines.filter((line) => line.startsWith("⚠"));
  expect(leaked).toHaveLength(3);

  await page.getByRole("button", { name: "Export" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("สิทธิ์-สไลด์ 1.png");
});
