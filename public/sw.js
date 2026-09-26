// Service worker of Learning Suit (PWA). It only helps the app open when the network drops:
// - /_next/static/* (content-hashed, never changes): cache first.
// - Page loads: network first (always the newest build when online); the last good copy of that exact URL
//   is used when offline or when the network takes longer than NETWORK_WAIT_MS. Sign-in pages are never kept.
// - Icons/manifest: served from cache, refreshed in the background.
// Everything else (Supabase, RSC data, POST, other origins) goes straight to the network untouched.
// Pages hold no user data (they are shells that load work on the client), so nothing private is cached here.

const VERSION = "v1";
const STATIC = `ls-static-${VERSION}`;
const PAGES = `ls-pages-${VERSION}`;
const ASSETS = `ls-assets-${VERSION}`;
const KEEP = [STATIC, PAGES, ASSETS];
const NETWORK_WAIT_MS = 4000;
const MAX_STATIC = 400;
const MAX_PAGES = 60;
const NEVER_CACHE_PAGE = /^\/(login|change-password|auth)(\/|$)/;
const ASSET = /\.(png|svg|ico|webmanifest)$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("ls-") && !KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

/** Drops the oldest entries (Cache Storage keeps insertion order) so old builds do not pile up. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

const cacheable = (response) => response && response.ok && response.type === "basic" && !response.redirected;

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) { await cache.put(request, response.clone()); void trim(STATIC, MAX_STATIC); }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (cacheable(response)) await cache.put(event.request, response.clone());
    return response;
  });
  if (hit) { event.waitUntil(refresh.catch(() => undefined)); return hit; }
  return refresh;
}

function offlinePage() {
  const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ออฟไลน์ · Learning Suit</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#F8FAFC;color:#0F172A;font-family:system-ui,sans-serif">
<main style="max-width:420px;padding:24px;text-align:center">
<h1 style="font-size:20px;margin:0 0 8px">ยังไม่ได้เชื่อมต่ออินเทอร์เน็ต</h1>
<p style="color:#64748B;line-height:1.6;margin:0 0 20px">หน้านี้ยังไม่เคยเปิดตอนออนไลน์ในเครื่องนี้ จึงยังเปิดแบบออฟไลน์ไม่ได้ ลองเปิดหน้ารายการโปรเจกต์ หรือเชื่อมต่อแล้วลองใหม่</p>
<a href="/projects" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0F172A;color:#fff;text-decoration:none">ไปที่โปรเจกต์</a>
</main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function networkFirstPage(event) {
  const { request } = event;
  const cache = await caches.open(PAGES);
  const keep = !NEVER_CACHE_PAGE.test(new URL(request.url).pathname);
  const network = fetch(request).then(async (response) => {
    if (keep && cacheable(response)) { await cache.put(request, response.clone()); void trim(PAGES, MAX_PAGES); }
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  // Pages are stored only from plain navigations/fetches (never RSC data), so Vary can be ignored.
  const cached = keep ? await cache.match(request, { ignoreVary: true }) : undefined;
  if (!cached) return network.catch(() => offlinePage());
  // A slow network must not hold the class up: after NETWORK_WAIT_MS the last good copy is shown.
  const late = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT_MS));
  return Promise.race([network.catch(() => cached), late]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") { event.respondWith(networkFirstPage(event)); return; }
  if (url.pathname.startsWith("/_next/static/")) { event.respondWith(cacheFirst(request)); return; }
  if (ASSET.test(url.pathname)) event.respondWith(staleWhileRevalidate(event));
});

// The page lists what it loaded before this worker took control, so the first visit also works offline.
self.addEventListener("message", (event) => {
  if (event.origin && event.origin !== self.location.origin) return;
  const data = event.data;
  if (!data || data.type !== "warm") return;
  const sameOrigin = (raw) => {
    try { const url = new URL(raw, self.location.origin); return url.origin === self.location.origin ? url : null; } catch { return null; }
  };
  event.waitUntil((async () => {
    const statics = await caches.open(STATIC);
    for (const url of (Array.isArray(data.urls) ? data.urls : []).slice(0, 300).map(sameOrigin)) {
      if (!url || !url.pathname.startsWith("/_next/static/") || (await statics.match(url.href))) continue;
      try { const response = await fetch(url.href); if (cacheable(response)) await statics.put(url.href, response); } catch { /* offline: try next time */ }
    }
    void trim(STATIC, MAX_STATIC);
    const page = typeof data.page === "string" ? sameOrigin(data.page) : null;
    const pages = await caches.open(PAGES);
    if (page && !NEVER_CACHE_PAGE.test(page.pathname) && !(await pages.match(page.href, { ignoreVary: true }))) {
      try {
        const response = await fetch(page.href, { credentials: "same-origin" });
        if (cacheable(response)) { await pages.put(page.href, response); void trim(PAGES, MAX_PAGES); }
      } catch { /* offline: the next online visit caches it */ }
    }
  })());
});
