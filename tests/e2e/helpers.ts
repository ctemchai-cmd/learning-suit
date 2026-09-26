import { expect, type Page } from "playwright/test";

/** Creates a lesson from the dashboard (instant local draft) and renames it through the editor. */
export async function createProject(page: Page, title: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "สร้างโปรเจกต์" }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "บทเรียนใหม่" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
  await page.getByRole("button", { name: "เปลี่ยนชื่อบทเรียน" }).click();
  await page.getByRole("textbox", { name: "ชื่อบทเรียน" }).fill(title);
  await page.getByRole("button", { name: "บันทึกชื่อ" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
}

export async function stageBox(page: Page) {
  const box = await page.locator(".konvajs-content").boundingBox();
  if (!box) throw new Error("canvas not visible");
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

export async function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.getByRole("button", { name: "สี่เหลี่ยม", exact: true }).click();
  await page.mouse.click(x1, y1);
  await page.mouse.move(x2, y2, { steps: 3 });
  await page.mouse.click(x2, y2);
}

export async function objectRows(page: Page) {
  await page.getByRole("tab", { name: "Objects" }).click();
  return page.getByRole("button", { name: /^เลือกวัตถุ / });
}

/** Reads the persisted draft of the open project straight from IndexedDB (black-box check of Drawing info). */
export async function readDraft(page: Page) {
  // Local writes are async: wait until no IndexedDB write is pending before reading.
  await expect(page.getByTestId("save-status")).not.toHaveText("กำลังเก็บในเครื่อง…");
  const projectId = page.url().split("/").pop();
  return page.evaluate(async (id) => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open("learning-suit");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("drafts").objectStore("drafts").getAll();
      request.onsuccess = () => { db.close(); resolve((request.result as { projectId: string }[]).find((draft) => draft.projectId === id) ?? null); };
      request.onerror = () => reject(request.error);
    };
  }), projectId) as Promise<{ content: { title: string; document: { slides: { id: string; name: string; nodes: Record<string, unknown>[] }[]; assets: Record<string, unknown> } }; pendingEdit: unknown; localSequence: number } | null>;
}

/** Creates a project through in-app navigation (keeps the in-memory session, e.g. the object clipboard). */
export async function createProjectInApp(page: Page, title: string) {
  await page.getByRole("link", { name: "กลับไปโปรเจกต์" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole("button", { name: "สร้างโปรเจกต์" }).first().click();
  await expect(page.getByRole("heading", { name: "บทเรียนใหม่" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "เปลี่ยนชื่อบทเรียน" }).click();
  await page.getByRole("textbox", { name: "ชื่อบทเรียน" }).fill(title);
  await page.getByRole("button", { name: "บันทึกชื่อ" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}
