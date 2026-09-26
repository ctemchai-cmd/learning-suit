import { test, expect } from "playwright/test";

// The service worker itself only runs in production builds (checked against `next start`: offline reload of
// a visited project, the project list, and the offline page for an unvisited URL). Here: what makes it installable.
test("PWA-01: installable — manifest, icons, iOS tags and a never-cached service worker script", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Learning Suit", start_url: "/projects", scope: "/", display: "standalone", lang: "th" });
  const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(icon.src);
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }

  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-cache");
  expect(worker.headers()["content-type"]).toContain("application/javascript");

  await page.goto("/projects");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Learning Suit");
  // Development never registers a worker (hot reload must not come from a cache).
  expect(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0)).toBe(0);
});
