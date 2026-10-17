import type { FlowFrame, Hop, Spot } from "@/domain/data/model";
import { partsOfFrames, type RevealPart } from "@/domain/document/reveal";
import type { DeployState, DeployView } from "@/domain/deploy/model";
import { monitorScreen } from "@/features/flow/monitor";

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
  { id: "overall", label: "ภาพรวมทั้งระบบ", description: "เครื่องเรา → GitHub → Vercel → ฐานข้อมูล → คอมพิวเตอร์เพื่อน" },
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
  /** Pipes drawn between places (always visible); `part` = the reveal part that shows the pipe (the later of its two ends). */
  pipes: { from: Pt; to: Pt; label?: string; part: string }[];
};

/** The friend's desktop computer: monitor bezel `frame` (its neck and base hang `MONITOR_STAND` below it) and the screen inside. */
const computer = (x: number, y: number, w: number, h: number) => ({ frame: { x, y, w, h }, screen: monitorScreen({ x, y, w, h }) });

function localScene(): Scene {
  const laptop = { x: 50, y: 84, w: 660, h: 420 };
  const code = { x: 80, y: 150, w: 190, h: 300 };
  const server = { x: 306, y: 230, w: 150, h: 140 };
  const browser = { x: 490, y: 150, w: 190, h: 300 };
  const friend = computer(840, 195, 240, 270);
  const gate = { x: 772, y: 330 };
  return {
    laptop, code, server, browser, friend, localhostGate: gate,
    pipes: [
      { from: right(code, 300), to: left(server, 300), part: "server" },
      { from: right(server, 300), to: left(browser, 300), part: "browser" },
      { from: left(friend.frame, 330), to: gate, part: "friend" },
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
      { from: right(code, 215), to: left(server, 262), part: "server" },
      { from: right(envfile, 386), to: left(server, 330), part: "envfile" },
      { from: right(server, 250), to: left(browser, 230), part: "browser" },
      { from: right(server, 320), to: left(supabase, 380), part: "db" },
    ],
  };
}

function vercelScene(): Scene {
  const laptop = { x: 24, y: 110, w: 250, h: 240 };
  const code = { x: 44, y: 150, w: 210, h: 170 };
  const github = { x: 320, y: 140, w: 190, h: 140 };
  const vercel = { x: 556, y: 70, w: 310, h: 530 };
  const url = { x: 900, y: 96, w: 196, h: 116 };
  const friend = computer(900, 256, 196, 250);
  return {
    laptop, code, github, vercel, url, friend,
    build: { x: 711, y: 150 },
    deployments: { x: 576, y: 214, w: 270, h: 360 },
    pipes: [
      { from: right(laptop, 210), to: left(github, 210), label: "ส่งโค้ด", part: "github" },
      { from: right(github, 210), to: left(vercel, 210), part: "vercel" },
      { from: right(vercel, 154), to: left(url, 154), part: "url" },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y }, part: "friend" },
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
  const friend = computer(900, 256, 196, 250);
  const supabase = { x: 330, y: 400, w: 200, h: 200 };
  const deployments = { x: 588, y: 196, w: 260, h: 250 };
  const vercelEnv = { x: 588, y: 470, w: 260, h: 110 };
  return {
    laptop, code, envfile, server, browser, github, vercel, url, friend, supabase, deployments, vercelEnv,
    build: { x: 718, y: 140 },
    gitignore: { x: 333, y: 170 },
    pipes: [
      { from: right(laptop, 170), to: { x: 333, y: 170 }, part: "github" },
      { from: { x: 333, y: 170 }, to: left(github, 170), part: "github" },
      { from: right(github, 170), to: left(vercel, 170), part: "vercel" },
      { from: right(vercel, 154), to: left(url, 154), part: "web" },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y }, part: "web" },
      { from: { x: server.x + server.w / 2, y: laptop.y + laptop.h }, to: { x: supabase.x + 40, y: supabase.y + 20 }, part: "db" },
      // Vercel reads the database with its own key: the pipe comes with the Environment Variables box it starts from.
      { from: left(vercel, 500), to: right(supabase, 500), part: "vercelEnv" },
    ],
  };
}

function overallScene(): Scene {
  const laptop = { x: 24, y: 84, w: 220, h: 170 };
  const code = { x: 40, y: 116, w: 188, h: 110 };
  const github = { x: 296, y: 104, w: 170, h: 120 };
  const vercel = { x: 520, y: 70, w: 290, h: 270 };
  const url = { x: 860, y: 86, w: 236, h: 116 };
  const friend = computer(860, 250, 236, 260);
  const supabase = { x: 290, y: 380, w: 520, h: 222 };
  return {
    laptop, code, github, vercel, url, friend, supabase,
    build: { x: 665, y: 140 },
    deployments: { x: 540, y: 196, w: 250, h: 130 },
    rls: { x: 370, y: 490 },
    orders: { x: 440, y: 430, w: 350, h: 160 },
    pipes: [
      { from: right(laptop, 164), to: left(github, 164), label: "ส่งโค้ด", part: "github" },
      { from: right(github, 164), to: left(vercel, 164), part: "vercel" },
      { from: right(vercel, 144), to: left(url, 144), part: "url" },
      { from: { x: url.x + url.w / 2, y: url.y + url.h }, to: { x: url.x + url.w / 2, y: friend.frame.y }, part: "friend" },
      { from: { x: vercel.x + 40, y: vercel.y + vercel.h }, to: { x: 370, y: 490 }, part: "db" },
      { from: { x: 370, y: 490 }, to: left({ x: 440, y: 430, w: 350, h: 160 }, 490), part: "db" },
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

/** Polyline for a hop: straight, except packets to/from the friend's computer pass the URL box's bottom edge. */
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

// ---------------------------------------------------------------------------
// Progressive reveal (plan 07 §2): the ordered parts of each step. The board draws a piece only when its part is shown;
// positions never change. `PIECES` maps every drawn piece (the spot names plus `laptop`) to its part in each step; a pipe
// comes with the later of its two ends (`Scene.pipes[].part`).
// ---------------------------------------------------------------------------

const part = (id: string, label: string): RevealPart => ({ id, label });
const PARTS: Record<DeployView, RevealPart[]> = {
  local: [part("code", "เครื่องเรา: โค้ด"), part("server", "เซิร์ฟเวอร์ในเครื่อง"), part("browser", "เบราว์เซอร์ (localhost)"), part("friend", "คอมพิวเตอร์เพื่อน และด่าน “นอกเครื่องเรา”")],
  localEnv: [part("code", "เครื่องเรา: โค้ด"), part("server", "เซิร์ฟเวอร์ในเครื่อง"), part("envfile", "ไฟล์ .env.local (กุญแจ)"), part("db", "ฐานข้อมูล (Supabase)"), part("browser", "เบราว์เซอร์")],
  vercel: [part("code", "เครื่องเรา: โค้ด"), part("github", "GitHub"), part("vercel", "Vercel และ Build"), part("deployments", "รายการ Deployments"), part("url", "เว็บจริง (URL)"), part("friend", "คอมพิวเตอร์เพื่อน")],
  env: [part("laptop", "เครื่องเรา (โค้ด + .env.local)"), part("db", "ฐานข้อมูล (Supabase)"), part("github", "GitHub และ .gitignore"), part("vercel", "Vercel: Build + Deployments"), part("vercelEnv", "Environment Variables บน Vercel"), part("web", "เว็บจริงและคอมพิวเตอร์เพื่อน")],
  overall: [part("code", "เครื่องเรา: โค้ด"), part("github", "GitHub"), part("vercel", "Vercel: Build + Deployments"), part("db", "ฐานข้อมูล และกฎสิทธิ์"), part("url", "เว็บจริง (URL)"), part("friend", "คอมพิวเตอร์เพื่อน")],
};
export const deployParts = (view: DeployView): RevealPart[] => PARTS[view];

const PIECES: Record<DeployView, Record<string, string>> = {
  local: { laptop: "code", code: "code", server: "server", browser: "browser", friend: "friend", localhostGate: "friend" },
  localEnv: { laptop: "code", code: "code", server: "server", envfile: "envfile", supabase: "db", browser: "browser" },
  vercel: { laptop: "code", code: "code", github: "github", vercel: "vercel", build: "vercel", deployments: "deployments", url: "url", friend: "friend" },
  env: { laptop: "laptop", code: "laptop", server: "laptop", browser: "laptop", envfile: "laptop", supabase: "db", gitignore: "github", github: "github", vercel: "vercel", build: "vercel", deployments: "vercel", vercelEnv: "vercelEnv", url: "web", friend: "web" },
  overall: { laptop: "code", code: "code", github: "github", vercel: "vercel", build: "vercel", deployments: "vercel", supabase: "db", orders: "db", rls: "db", url: "url", friend: "friend" },
};
/** The part that draws a piece of a step (null = the step does not draw it). `piece` is a spot name or `laptop`. */
export function deployPartOfPiece(view: DeployView, piece: string): string | null {
  return PIECES[view][piece] ?? null;
}
/** The part that draws a named place; `deploy:N` rows live in the deployments list. */
export const deployPartOfSpot = (view: DeployView, spot: Spot): string | null => deployPartOfPiece(view, spot.startsWith("deploy:") ? "deployments" : spot);

/** Parts an action needs: those of the places its frames name, plus the URL box when a packet to/from the computer passes it. */
export function deployPartsOfFrames(view: DeployView, frames: readonly FlowFrame<unknown>[]): string[] {
  return partsOfFrames(frames, (spot) => deployPartOfSpot(view, spot), (move) => {
    const viaUrl = (move.from === "friend" && move.to !== "url") || (move.to === "friend" && move.from !== "url");
    const url = viaUrl ? deployPartOfPiece(view, "url") : null;
    return url ? [url] : [];
  });
}
