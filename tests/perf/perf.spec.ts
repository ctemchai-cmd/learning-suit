import { execSync } from "node:child_process";
import os from "node:os";
import { test, expect } from "playwright/test";
import { createProject } from "../e2e/helpers";

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

test("PERF-01..03: 2,000 nodes / 100,000 points; pan + draw frame times and local write latency", async ({ page, browserName }) => {
  await createProject(page, "PERF fixture");
  const projectId = page.url().split("/").pop()!;
  // PERF-01 fixture written straight into the local draft (20 slides; slide 1 = 2,000 nodes incl. 100,000 path points).
  await page.evaluate(async (id) => {
    const uuid = () => crypto.randomUUID();
    const base = { rotation: 0, opacity: 1, locked: false };
    const active: Record<string, unknown>[] = [];
    for (let i = 0; i < 1000; i++) {
      const points = Array.from({ length: 100 }, (_, k) => ({ x: k * 3, y: Math.sin((k + i) / 6) * 20 }));
      active.push({ ...base, id: uuid(), type: "pen", x: (i % 40) * 140 - 2800, y: Math.floor(i / 40) * 90 - 1100, stroke: "#1F2937", strokeWidth: 3, strokeStyle: "solid", points });
    }
    for (let i = 0; i < 1000; i++) {
      active.push({ ...base, id: uuid(), type: "rectangle", x: (i % 40) * 140 - 2790, y: Math.floor(i / 40) * 90 - 1080, width: 60, height: 30, stroke: "#2563EB", strokeWidth: 2, strokeStyle: "solid", fill: "transparent" });
    }
    const slides = [{ id: uuid(), name: "สไลด์ 1", background: "#FFFFFF", nodes: active }];
    for (let s = 2; s <= 20; s++) {
      slides.push({ id: uuid(), name: `สไลด์ ${s}`, background: "#FFFFFF", nodes: Array.from({ length: 10 }, (_, i) => ({ ...base, id: uuid(), type: "rectangle", x: i * 80, y: 0, width: 50, height: 50, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent" })) });
    }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("learning-suit");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("drafts", "readwrite");
        const store = tx.objectStore("drafts");
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const value = c.value as { projectId: string; content: { title: string; document: { slides: unknown[] } }; localSequence: number };
          if (value.projectId === id) { value.content.document.slides = slides; value.localSequence += 1; c.update(value); }
          c.continue();
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, projectId);
  const loadStart = Date.now();
  await page.reload();
  await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว", { timeout: 60_000 });
  await page.locator(".konvajs-content").waitFor();
  const openMs = Date.now() - loadStart;

  // Warm up, then 5 s of continuous wheel panning while sampling rAF intervals and long tasks.
  const box = (await page.locator(".konvajs-content").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __sampling: boolean };
    w.__frames = []; w.__long = []; w.__sampling = true;
    let last = performance.now();
    const loop = (now: number) => { if (!w.__sampling) return; w.__frames.push(now - last); last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) w.__long.push(entry.duration); }).observe({ type: "longtask", buffered: false });
  });
  let requests = 0;
  page.on("request", (request) => { if (!request.url().includes("_next") && !request.url().includes("webpack") && request.method() !== "GET") requests++; });
  const started = Date.now();
  let direction = 1;
  while (Date.now() - started < 5000) {
    await page.mouse.wheel(40 * direction, 25 * direction);
    if (Date.now() - started > 2500) direction = -1;
  }
  const pan = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __long: number[]; __sampling: boolean };
    w.__sampling = false;
    return { frames: w.__frames.slice(10), long: w.__long };
  });

  // Freehand drawing for ~2 s on top of the heavy slide.
  await page.getByRole("button", { name: "ปากกา", exact: true }).click();
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __sampling: boolean };
    w.__frames = []; w.__sampling = true;
    let last = performance.now();
    const loop = (now: number) => { if (!w.__sampling) return; w.__frames.push(now - last); last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.mouse.move(box.x + 200, box.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 120; i++) await page.mouse.move(box.x + 200 + i * 6, box.y + 300 + Math.sin(i / 8) * 80);
  await page.mouse.up();
  const draw = await page.evaluate(() => { const w = window as unknown as { __frames: number[]; __sampling: boolean }; w.__sampling = false; return w.__frames.slice(5); });

  // PERF-03: local draft write latency (IndexedDB transaction of the full 2,000-node document),
  // measured with User Timing inside the app, for typical single-object edits and a select-all stress case.
  await page.getByRole("button", { name: "เลือก", exact: true }).click();
  const measure = async (label: string, selectAll: boolean, count: number) => {
    if (selectAll) await page.keyboard.press("Meta+a");
    else { await page.keyboard.press("Escape"); await page.getByRole("tab", { name: "Objects" }).click(); await page.getByRole("button", { name: /^เลือกวัตถุ rectangle/ }).first().click(); }
    // Keyboard focus back on the page (a focused button keeps arrow keys for itself).
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); performance.clearMeasures(); });
    for (let i = 0; i < count; i++) {
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("save-status")).toHaveText("เก็บในเครื่องแล้ว");
    }
    const entries = await page.evaluate(() => ({
      write: performance.getEntriesByName("learning-suit:local-write").map((entry) => entry.duration),
      transaction: performance.getEntriesByName("learning-suit:transaction").map((entry) => entry.duration),
    }));
    return { label, writeP50: percentile(entries.write, 0.5), writeP95: percentile(entries.write, 0.95), transactionP95: percentile(entries.transaction, 0.95), samples: entries.write.length };
  };
  const single = await measure("single object nudge", false, 12);
  const stress = await measure("select-all (2,000 nodes) nudge", true, 5);
  const writes = { single, stress };

  const cpu = (() => { try { return execSync("sysctl -n machdep.cpu.brand_string").toString().trim(); } catch { return os.cpus()[0]?.model ?? "unknown"; } })();
  const report = {
    machine: { cpu, ramGiB: Math.round(os.totalmem() / 2 ** 30), browser: `${browserName} ${page.context().browser()?.version()}`, dpr: 2, headless: true },
    fixture: { slides: 20, activeNodes: 2000, activePathPoints: 100_000 },
    openMs,
    pan: { frames: pan.frames.length, p50: percentile(pan.frames, 0.5), p95: percentile(pan.frames, 0.95), max: Math.max(...pan.frames), longTasksOver200ms: pan.long.filter((d) => d > 200).length, maxLongTask: Math.max(0, ...pan.long) },
    draw: { frames: draw.length, p95: percentile(draw, 0.95), max: Math.max(...draw) },
    localWriteMs: writes,
    nonGetRequestsDuringPan: requests,
  };
  console.log(`PERF_REPORT ${JSON.stringify(report)}`);
  expect(requests).toBe(0);
});
