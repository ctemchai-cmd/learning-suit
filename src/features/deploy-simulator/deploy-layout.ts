import type { Hop, Spot } from "@/domain/data/model";
import type { DeployState, DeployView } from "@/domain/deploy/model";

// Pure geometry of the deploy widget (plan 07 §4), widget base coordinates 1120×680.

export type Box = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export const DEPLOY_W = 1120;
export const DEPLOY_H = 680;
export const CAPTION_BOX: Box = { x: 24, y: 620, w: 1072, h: 46 };

export const DEPLOY_VIEWS: { id: DeployView; label: string; description: string }[] = [
  { id: "local", label: "เปิดเว็บในเครื่อง", description: "localhost เห็นได้แค่เครื่องเรา" },
  { id: "localEnv", label: "กุญแจในเครื่อง (.env.local)", description: "เซิร์ฟเวอร์ในเครื่องอ่านกุญแจจาก .env.local เพื่อต่อฐานข้อมูล" },
  { id: "vercel", label: "ขึ้น Vercel", description: "ส่งโค้ด → GitHub → Vercel Build → เว็บจริงที่ทุกคนเปิดได้" },
  { id: "env", label: "กุญแจบน Vercel", description: "กุญแจไม่ขึ้น GitHub ต้องใส่บน Vercel เอง" },
  { id: "overall", label: "ภาพรวมทั้งระบบ", description: "เครื่องเรา → GitHub → Vercel → ฐานข้อมูล → มือถือเพื่อน" },
];

const center = (box: Box): Pt => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const right = (box: Box, y = box.y + box.h / 2): Pt => ({ x: box.x + box.w, y });
const left = (box: Box, y = box.y + box.h / 2): Pt => ({ x: box.x, y });

export type Scene = {
  laptop: Box;
  code: Box;
  server?: Box;
  browser?: Box;
  envfile?: Box;
  github?: Box;
  vercel?: Box;
  build?: Pt;
  deployments?: Box;
  vercelEnv?: Box;
  url?: Box;
  friend?: { frame: Box; screen: Box };
  localhostGate?: Pt;
  gitignore?: Pt;
  supabase?: Box;
  rls?: Pt;
  orders?: Box;
  /** Pipes drawn between places (always visible). */
  pipes: { from: Pt; to: Pt; label?: string }[];
};

const phone = (x: number, y: number, w: number, h: number) => ({ frame: { x, y, w, h }, screen: { x: x + 12, y: y + 36, w: w - 24, h: h - 52 } });

function localScene(): Scene {
  const laptop = { x: 50, y: 84, w: 660, h: 420 };
  const code = { x: 80, y: 150, w: 190, h: 300 };
  const server = { x: 306, y: 230, w: 150, h: 140 };
  const browser = { x: 490, y: 150, w: 190, h: 300 };
  const friend = phone(860, 110, 210, 440);
  const gate = { x: 772, y: 330 };
  return {
    laptop, code, server, browser, friend, localhostGate: gate,
    pipes: [
      { from: right(code, 300), to: left(server, 300) },
      { from: right(server, 300), to: left(browser, 300) },
      { from: left(friend.frame, 330), to: gate },
    ],
  };
}

function localEnvScene(): Scene {
  const laptop = { x: 50, y: 84, w: 700, h: 430 };
  const code = { x: 80, y: 140, w: 170, h: 150 };
  const envfile = { x: 80, y: 306, w: 170, h: 160 };
  const server = { x: 300, y: 220, w: 170, h: 140 };
  const browser = { x: 510, y: 120, w: 210, h: 200 };
  const supabase = { x: 840, y: 230, w: 230, h: 300 };
  return {
    laptop, code, envfile, server, browser, supabase,
    pipes: [
      { from: right(code, 215), to: left(server, 262) },
      { from: right(envfile, 386), to: left(server, 330) },
      { from: right(server, 250), to: left(browser, 230) },
      { from: right(server, 320), to: left(supabase, 380) },
    ],
  };
}

function vercelScene(): Scene {
  const laptop = { x: 24, y: 110, w: 250, h: 240 };
  const code = { x: 44, y: 150, w: 210, h: 170 };
  const github = { x: 320, y: 140, w: 190, h: 140 };
  const vercel = { x: 556, y: 70, w: 310, h: 530 };
  const url = { x: 900, y: 96, w: 196, h: 116 };
  const friend = phone(912, 256, 172, 344);
  return {
    laptop, code, github, vercel, url, friend,
    build: { x: 711, y: 150 },
    deployments: { x: 576, y: 214, w: 270, h: 360 },
    pipes: [
      { from: right(laptop, 210), to: left(github, 210), label: "ส่งโค้ด" },
      { from: right(github, 210), to: left(vercel, 210) },
      { from: right(vercel, 154), to: left(url, 154) },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y } },
    ],
  };
}

function envScene(): Scene {
  const laptop = { x: 24, y: 80, w: 270, h: 300 };
  const code = { x: 40, y: 112, w: 118, h: 112 };
  const envfile = { x: 40, y: 236, w: 118, h: 66 };
  const server = { x: 170, y: 112, w: 108, h: 76 };
  const browser = { x: 170, y: 200, w: 108, h: 120 };
  const github = { x: 372, y: 110, w: 160, h: 120 };
  const vercel = { x: 568, y: 70, w: 300, h: 530 };
  const url = { x: 900, y: 96, w: 196, h: 116 };
  const friend = phone(912, 256, 172, 344);
  const supabase = { x: 330, y: 400, w: 200, h: 200 };
  const deployments = { x: 588, y: 196, w: 260, h: 250 };
  const vercelEnv = { x: 588, y: 470, w: 260, h: 110 };
  return {
    laptop, code, envfile, server, browser, github, vercel, url, friend, supabase, deployments, vercelEnv,
    build: { x: 718, y: 140 },
    gitignore: { x: 333, y: 170 },
    pipes: [
      { from: right(laptop, 170), to: { x: 333, y: 170 } },
      { from: { x: 333, y: 170 }, to: left(github, 170) },
      { from: right(github, 170), to: left(vercel, 170) },
      { from: right(vercel, 154), to: left(url, 154) },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y } },
      { from: { x: server.x + server.w / 2, y: laptop.y + laptop.h }, to: { x: supabase.x + 40, y: supabase.y + 20 } },
      { from: left(vercel, 500), to: right(supabase, 500) },
    ],
  };
}

function overallScene(): Scene {
  const laptop = { x: 24, y: 84, w: 220, h: 170 };
  const code = { x: 40, y: 116, w: 188, h: 110 };
  const github = { x: 296, y: 104, w: 170, h: 120 };
  const vercel = { x: 520, y: 70, w: 290, h: 270 };
  const url = { x: 860, y: 86, w: 236, h: 116 };
  const friend = phone(890, 250, 190, 350);
  const supabase = { x: 290, y: 380, w: 520, h: 222 };
  return {
    laptop, code, github, vercel, url, friend, supabase,
    build: { x: 665, y: 140 },
    deployments: { x: 540, y: 196, w: 250, h: 130 },
    rls: { x: 370, y: 490 },
    orders: { x: 440, y: 430, w: 350, h: 160 },
    pipes: [
      { from: right(laptop, 164), to: left(github, 164), label: "ส่งโค้ด" },
      { from: right(github, 164), to: left(vercel, 164) },
      { from: right(vercel, 144), to: left(url, 144) },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y } },
      { from: { x: vercel.x + 40, y: vercel.y + vercel.h }, to: { x: 370, y: 490 } },
      { from: { x: 370, y: 490 }, to: left({ x: 440, y: 430, w: 350, h: 160 }, 490) },
    ],
  };
}

const SCENES: Record<DeployView, Scene> = { local: localScene(), localEnv: localEnvScene(), vercel: vercelScene(), env: envScene(), overall: overallScene() };
export const sceneOf = (view: DeployView): Scene => SCENES[view];

/** Rows of the deployments list (newest first), limited to what fits. */
export function deploymentRows(view: DeployView, state: DeployState): { id: number; box: Box }[] {
  const list = sceneOf(view).deployments;
  if (!list) return [];
  const rowH = view === "overall" ? 30 : 38;
  const max = Math.max(1, Math.floor((list.h - 30) / rowH));
  return [...state.deployments].reverse().slice(0, max).map((item, index) => ({ id: item.id, box: { x: list.x, y: list.y + 30 + index * rowH, w: list.w, h: rowH - 4 } }));
}

/** Where a named place is drawn in a step (null = not drawn in this step). */
export function spotPoint(view: DeployView, state: DeployState, spot: Spot): Pt | null {
  const scene = sceneOf(view);
  const at = (box: Box | undefined) => (box ? center(box) : null);
  switch (spot) {
    case "code": return at(scene.code);
    case "server": return at(scene.server);
    case "browser": return at(scene.browser);
    case "envfile": return at(scene.envfile);
    case "github": return at(scene.github);
    case "vercel": return scene.vercel ? { x: scene.vercel.x + 30, y: (scene.build?.y ?? scene.vercel.y + 80) } : null;
    case "build": return scene.build ?? null;
    case "vercelEnv": return at(scene.vercelEnv);
    case "url": return at(scene.url);
    case "friend": return scene.friend ? center(scene.friend.screen) : null;
    case "localhostGate": return scene.localhostGate ?? null;
    case "gitignore": return scene.gitignore ?? null;
    case "supabase": return at(scene.supabase);
    case "rls": return scene.rls ?? null;
    case "orders": return at(scene.orders);
  }
  if (spot.startsWith("deploy:")) {
    const row = deploymentRows(view, state).find((item) => item.id === Number(spot.slice(7)));
    return row ? { x: row.box.x + 30, y: row.box.y + row.box.h / 2 } : null;
  }
  return null;
}

/** Polyline for a hop: straight, except packets to/from the friend's phone pass the URL box's bottom edge. */
export function hopPath(view: DeployView, before: DeployState, after: DeployState, move: Hop): Pt[] | null {
  const start = spotPoint(view, before, move.from) ?? spotPoint(view, after, move.from);
  const end = spotPoint(view, after, move.to) ?? spotPoint(view, before, move.to);
  if (!start || !end) return null;
  const scene = sceneOf(view);
  const via: Pt[] = [];
  const urlBottom = scene.url ? { x: scene.url.x + scene.url.w / 2, y: scene.url.y + scene.url.h } : null;
  if (urlBottom && ((move.from === "friend" && move.to !== "url") || (move.to === "friend" && move.from !== "url"))) {
    const url = center(scene.url!);
    if (move.from === "friend") via.push(urlBottom, url); else via.push(url, urlBottom);
  }
  return [start, ...via, end];
}
