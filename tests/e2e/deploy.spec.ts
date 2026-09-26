import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft } from "./helpers";

type DeployNode = { type: string; view: string; state: {
  code: { rev: number; broken: boolean }; local: { running: boolean; showing: number | null }; github: { rev: number | null };
  deployments: { id: number; ok: boolean; hasKey: boolean }[]; production: number | null; keys: { vercel: boolean };
  friend: { title: string; tone: string }; orders: string[];
} };
const deployNode = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === "deploy-simulator")) as unknown as DeployNode;
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลอง Deploy" });
const step = (page: Page, value: string) => panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption(value);
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });
const skip = (page: Page) => panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("DEPLOY-01/02: localhost is only on the laptop; push deploys, a failed build keeps the live site, rollback works", async ({ page }) => {
  await createProject(page, "Deploy");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Deploy" }).first().click();
  await expect(panel(page)).toBeVisible();
  await button(page, "เปิดเว็บในเครื่อง").click();
  await button(page, "เพื่อนเปิด localhost").click();
  await expect(panel(page)).toContainText("มือถือเพื่อนเปิด localhost ของเราไม่ได้");
  let node = await deployNode(page);
  expect(node.state.local).toEqual({ running: true, showing: 1 });
  expect(node.state.friend.tone).toBe("error");

  await step(page, "vercel");
  await button(page, "ส่งโค้ดขึ้น (Deploy)").click();
  await expect(panel(page)).toContainText("Deploy สำเร็จ: D1 ออนไลน์แล้ว");
  await button(page, "แก้โค้ด").click();
  await button(page, "ส่งโค้ดขึ้น (Deploy)").click();
  await button(page, "แก้โค้ดแบบพิมพ์ผิด").click();
  await button(page, "ส่งโค้ดขึ้น (Deploy)").click();
  await expect(panel(page)).toContainText("Build ล้ม: เว็บจริงยังเป็นรุ่นเดิม");
  node = await deployNode(page);
  expect(node.state.deployments.map((item) => item.ok)).toEqual([true, true, false]);
  expect(node.state.production).toBe(2);
  await button(page, "ย้อนไปรุ่นก่อน").click();
  await button(page, "เพื่อนเปิดเว็บจริง").click();
  await skip(page);
  node = await deployNode(page);
  expect(node.state.production).toBe(1);
  expect(node.state.friend.tone).toBe("ok");
});

test("DEPLOY-03/04: the key stays off GitHub; the live site needs it on Vercel; the overview prepares and orders end to end", async ({ page }) => {
  await createProject(page, "กุญแจ");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Deploy" }).first().click();
  await step(page, "env");
  await button(page, "ส่งโค้ดขึ้น (Deploy)").click();
  await expect(panel(page)).toContainText("Deploy สำเร็จ: D1");
  await panel(page).getByRole("button", { name: /^เพื่อนสั่ง/ }).click();
  await expect(panel(page)).toContainText("เว็บจริงต่อฐานข้อมูลไม่ได้");
  expect((await deployNode(page)).state.orders).toEqual([]);
  await button(page, "ใส่แล้ว").click();
  await button(page, "Deploy ใหม่").click();
  await expect(panel(page)).toContainText("Deploy ใหม่สำเร็จ: D2 มีกุญแจแล้ว");
  await panel(page).getByRole("button", { name: /^เพื่อนสั่ง/ }).click();
  await expect(panel(page)).toContainText("บันทึกออเดอร์ “ลาเต้” ผ่านเว็บจริงแล้ว");

  await step(page, "overall");
  // Already deployed with the key: the “prepare” shortcut is not offered.
  await expect(button(page, "เตรียมเว็บให้พร้อม")).toHaveCount(0);
  await panel(page).getByRole("button", { name: /^เพื่อนสั่ง/ }).click();
  await skip(page);
  expect((await deployNode(page)).state.orders).toEqual(["ลาเต้", "อเมริกาโน่"]);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await deployNode(page)).state.orders).toEqual(["ลาเต้"]);
});

test("DEPLOY-05: the key in .env.local — the local server reads it to reach the database; without it the order fails", async ({ page }) => {
  await createProject(page, "env ในเครื่อง");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง Deploy" }).first().click();
  await step(page, "localEnv");
  await button(page, "เปิดเว็บในเครื่อง").click();
  await panel(page).getByRole("button", { name: /บนเว็บในเครื่อง$/ }).click();
  await expect(panel(page)).toContainText("ในเครื่องบันทึก “ลาเต้” ได้ (มีกุญแจใน .env.local)");
  await button(page, "ไม่มี").click();
  await panel(page).getByRole("button", { name: /บนเว็บในเครื่อง$/ }).click();
  await expect(panel(page)).toContainText("ไม่มีกุญแจใน .env.local");
  await skip(page);
  const node = await deployNode(page);
  expect(node.state.orders).toEqual(["ลาเต้"]);
  expect(node.view).toBe("localEnv");
});
