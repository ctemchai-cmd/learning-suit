import { test, expect, type Page } from "playwright/test";
import { createProject, readDraft } from "./helpers";

type Machine = { priv: boolean; pub: boolean; cmd: string; out: string[] };
type SshNode = { type: string; view: string; state: { a: Machine; b: Machine; registered: string[]; pushes: number; thief: string } };
const sshNode = async (page: Page) => ((await readDraft(page))!.content.document.slides[0].nodes.find((node) => node.type === "ssh-simulator")) as unknown as SshNode;
const panel = (page: Page) => page.getByRole("region", { name: "ตัวจำลอง SSH" });
const step = (page: Page, value: string) => panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" }).selectOption(value);
const button = (page: Page, name: string) => panel(page).getByRole("button", { name, exact: true });
const skip = (page: Page) => panel(page).getByRole("button", { name: "ข้ามไปจบ" }).click();

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const next = (page: Page) => panel(page).getByRole("listitem").filter({ hasText: "ทำต่อ" });

test("SSH-E2E-01/02: one guided step — the demo is blocked, then create the key pair, register; the “ทำต่อ” card follows the state", async ({ page }) => {
  await createProject(page, "SSH 1");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง SSH" }).first().click();
  await expect(panel(page)).toBeVisible();
  const select = panel(page).getByRole("combobox", { name: "ขั้นของบทเรียน" });
  await expect(select).toHaveValue("setup");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(panel(page).getByRole("list", { name: "ขั้นตอนเชื่อม GitHub ด้วย SSH" }).getByRole("listitem")).toHaveCount(4);
  await expect(next(page)).toHaveCount(1);
  await expect(next(page)).toContainText("ลอง push ก่อน");

  await button(page, "ลอง git push").click();
  await expect(panel(page)).toContainText("เข้าไม่ได้: เครื่องเรายังไม่มีกุญแจ");
  await expect(panel(page)).toContainText("จังหวะ 2/2");
  let node = await sshNode(page);
  expect(node.state.a).toMatchObject({ priv: false, pub: false, cmd: "git push" });
  expect(node.state.pushes).toBe(0);
  await expect(next(page)).toContainText("สร้างคู่กุญแจ");

  await button(page, "ใส่ .pub ใน GitHub").click();
  await expect(panel(page)).toContainText("ยังไม่มีกุญแจให้ลงทะเบียน");
  expect((await sshNode(page)).state.registered).toEqual([]);

  await expect(panel(page).getByLabel("คำสั่งสร้างกุญแจ")).toHaveText('$ ssh-keygen -t ed25519 -C "you@example.com"');
  await button(page, "สร้างกุญแจ").click();
  await expect(panel(page)).toContainText("สร้างคู่กุญแจแล้ว");
  await expect(panel(page)).toContainText("จังหวะ 1/4");
  await skip(page);
  await expect(panel(page)).toContainText("จังหวะ 4/4");
  node = await sshNode(page);
  expect(node.view).toBe("setup");
  expect(node.state.a).toMatchObject({ priv: true, pub: true });
  await expect(next(page)).toContainText("ลงทะเบียน .pub");

  await button(page, "ใส่ .pub ใน GitHub").click();
  await expect(panel(page)).toContainText("ลงทะเบียนกุญแจสาธารณะของเครื่อง A กับ GitHub แล้ว");
  expect((await sshNode(page)).state.registered).toEqual(["a"]);
  await expect(next(page)).toContainText("เชื่อมต่อ");
  await button(page, "ใส่ .pub ใน GitHub").click();
  await expect(panel(page)).toContainText("ไม่ต้องลงทะเบียนซ้ำ");
});

test("SSH-E2E-03: connect — the door asks for a touch, the scan result goes back, no host-key step; playback steps the frames", async ({ page }) => {
  await createProject(page, "SSH 2");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง SSH" }).first().click();
  await button(page, "สร้างกุญแจ").click();
  await button(page, "ใส่ .pub ใน GitHub").click();

  await button(page, "ทีละจังหวะ").click();
  await button(page, "ssh -T git@github.com").click();
  await expect(panel(page)).toContainText("ทดสอบผ่าน: GitHub ทักว่า Hi you!");
  await expect(panel(page)).toContainText("จังหวะ 1/6");
  await panel(page).getByRole("button", { name: "ถัดไป" }).click();
  await expect(panel(page)).toContainText("จังหวะ 2/6");
  await skip(page);
  await expect(panel(page)).toContainText("จังหวะ 6/6");
  let node = await sshNode(page);
  expect(node.state.a.out.join(" ")).toContain("Hi you!");
  expect(JSON.stringify(node.state)).not.toContain("known");

  await button(page, "git push").click();
  await expect(panel(page)).toContainText("git push สำเร็จ");
  await expect(panel(page)).toContainText("จังหวะ 1/6");
  await skip(page);
  node = await sshNode(page);
  expect(node.state.pushes).toBe(1);
  await page.getByRole("button", { name: "เลิกทำ" }).click();
  expect((await sshNode(page)).state.pushes).toBe(0);
});

test("SSH-E2E-04/05: other machines — B is rejected, a copied .pub is rejected, a revoked key locks A out, B can get its own key", async ({ page }) => {
  await createProject(page, "SSH 3");
  await page.getByRole("button", { name: "เพิ่มตัวจำลอง SSH" }).first().click();
  await button(page, "สร้างกุญแจ").click();
  await button(page, "ใส่ .pub ใน GitHub").click();
  await step(page, "others");

  await button(page, "เครื่อง A ส่งโค้ด").click();
  await expect(panel(page)).toContainText("git push สำเร็จ");
  await button(page, "เครื่อง B ส่งโค้ด").click();
  await expect(panel(page)).toContainText("เครื่อง B เข้าไม่ได้: ไม่มีนิ้ว");
  await button(page, "คนคัดลอก .pub ลองเข้า").click();
  await expect(panel(page)).toContainText("คนที่คัดลอก .pub ไปเข้าไม่ได้");
  await skip(page);
  let node = await sshNode(page);
  expect(node.state).toMatchObject({ thief: "denied", pushes: 1, registered: ["a"] });

  await button(page, "A หาย → ลบกุญแจ A").click();
  await expect(panel(page)).toContainText("ลบกุญแจของเครื่อง A ออกจาก GitHub แล้ว");
  expect((await sshNode(page)).state.registered).toEqual([]);
  await button(page, "เครื่อง A ส่งโค้ด").click();
  await expect(panel(page)).toContainText("ถูกลบไปแล้ว");
  expect((await sshNode(page)).state.pushes).toBe(1);

  await button(page, "B ลงกุญแจของตัวเอง").click();
  await expect(panel(page)).toContainText("เครื่อง B สร้างกุญแจของตัวเองและลงทะเบียนแล้ว");
  await button(page, "เครื่อง B ส่งโค้ด").click();
  await expect(panel(page)).toContainText("git push สำเร็จ");
  await skip(page);
  node = await sshNode(page);
  expect(node.state).toMatchObject({ registered: ["b"], pushes: 2 });
  expect(node.state.b).toMatchObject({ priv: true, pub: true });

  await panel(page).getByRole("button", { name: "เริ่มใหม่" }).click();
  node = await sshNode(page);
  expect(node.state).toMatchObject({ registered: [], pushes: 0, thief: "idle", a: { priv: false }, b: { priv: false } });
  expect(node.view).toBe("others");
});
