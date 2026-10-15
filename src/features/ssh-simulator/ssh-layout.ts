import type { FlowFrame, Hop, Spot } from "@/domain/data/model";
import { partsOfFrames, type RevealPart } from "@/domain/document/reveal";
import { hostOf, type HostId } from "@/domain/hosting";
import { normalizeSshView, type Machine, type SshView } from "@/domain/ssh/model";

// Pure geometry of the SSH widget (plan 07 §4c), widget base coordinates 1120×680.
// The setup step is one wide layout (laptop A ↔ the door ↔ GitHub); the last step shrinks laptop A, adds laptop B and the copier.

export type Box = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export const SSH_W = 1120;
export const SSH_H = 680;
export const CAPTION_BOX: Box = { x: 24, y: 620, w: 1072, h: 46 };

/** Lesson steps; the first one names the site (GitHub when `host` is missing). */
export const sshViews = (host?: HostId): { id: SshView; label: string; description: string }[] => [
  { id: "setup", label: `เชื่อม ${hostOf(host).name} ด้วย SSH`, description: "ลองส่งโค้ด → สร้างคู่กุญแจ → ลงทะเบียน .pub → เชื่อมต่อ" },
  { id: "others", label: "เครื่องอื่น / กุญแจหาย", description: "เครื่องอื่นเข้าไม่ได้, คนคัดลอก .pub ก็เข้าไม่ได้, โน้ตบุ๊กหายให้ลบกุญแจออก" },
];

export type MachineBox = {
  box: Box;
  folder: Box;
  rows: { priv: Box; pub: Box };
  /** The gap between the two key files, where the one-way link “pub is made from priv” is drawn. */
  link: Box;
  /** Terminal strip: a full card in the wide layout, one line in the compact one. */
  term: Box;
  /** Where packets leave / enter the laptop (on the pipe, just outside it). */
  edge: Pt;
};
export type Scene = {
  compact: boolean;
  machines: { a: MachineBox; b?: MachineBox };
  scanner: Pt;
  github: Box;
  /** Where the pipe meets GitHub's edge. */
  gEdge: Pt;
  repo: Box;
  keys: Box;
  thief?: Box;
  pipes: { from: Pt; to: Pt }[];
};

const center = (box: Box): Pt => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

function machineBox(box: Box, compact: boolean, edgeY: number): MachineBox {
  const folder = compact ? { x: box.x + 20, y: box.y + 36, w: box.w - 40, h: 124 } : { x: box.x + 20, y: box.y + 42, w: box.w - 40, h: 236 };
  const rowH = compact ? 26 : 52, gap = compact ? 22 : 44, first = compact ? 32 : 40;
  const row = (index: number): Box => ({ x: folder.x + 16, y: folder.y + first + index * (rowH + gap), w: folder.w - 32, h: rowH });
  const priv = row(0), pub = row(1);
  return {
    box, folder,
    rows: { priv, pub },
    link: { x: priv.x, y: priv.y + rowH, w: priv.w, h: gap },
    term: compact ? { x: box.x + 20, y: box.y + 166, w: box.w - 40, h: 20 } : { x: box.x + 20, y: box.y + 292, w: box.w - 40, h: box.h - 306 },
    edge: { x: box.x + box.w + 4, y: edgeY },
  };
}

function wideScene(): Scene {
  const a = machineBox({ x: 24, y: 84, w: 520, h: 490 }, false, 329);
  const github = { x: 760, y: 84, w: 336, h: 516 };
  const scanner = { x: 652, y: 329 };
  const gEdge = { x: github.x, y: 329 };
  return {
    compact: false, machines: { a }, scanner, github, gEdge,
    repo: { x: 776, y: 126, w: 304, h: 72 },
    keys: { x: 776, y: 212, w: 304, h: 374 },
    pipes: [{ from: a.edge, to: scanner }, { from: scanner, to: gEdge }],
  };
}

function othersScene(): Scene {
  const a = machineBox({ x: 24, y: 84, w: 400, h: 196 }, true, 182);
  const b = machineBox({ x: 24, y: 326, w: 400, h: 196 }, true, 424);
  const github = { x: 700, y: 84, w: 396, h: 516 };
  const scanner = { x: 566, y: 303 };
  const gEdge = { x: github.x, y: 303 };
  const thief = { x: 450, y: 524, w: 232, h: 80 };
  return {
    compact: true, machines: { a, b }, scanner, github, gEdge, thief,
    repo: { x: 716, y: 126, w: 364, h: 72 },
    keys: { x: 716, y: 212, w: 364, h: 374 },
    pipes: [{ from: a.edge, to: scanner }, { from: b.edge, to: scanner }, { from: { x: 566, y: 524 }, to: scanner }, { from: scanner, to: gEdge }],
  };
}

const WIDE = wideScene();
const OTHERS = othersScene();
/** `view` may be a legacy step id from an older document: it draws the setup scene. */
export const sceneOf = (view: string): Scene => (normalizeSshView(view) === "others" ? OTHERS : WIDE);

/** Row of GitHub's SSH keys list where a laptop's key is shown (fixed slot per laptop, so a removed key can fade out in place). */
export function keySlot(scene: Scene, machine: Machine): Box {
  return { x: scene.keys.x + 12, y: scene.keys.y + 38 + (machine === "a" ? 0 : 64), w: scene.keys.w - 24, h: 56 };
}

type Side = Machine | "g" | "scanner" | "thief";
const FILES = ["priv", "pub", "ssh"] as const;
type File = (typeof FILES)[number];
const fileOf = (spot: Spot): { file: File; machine: Machine } | null => {
  const [name, suffix] = spot.split(":");
  return (FILES as readonly string[]).includes(name) && (suffix === undefined || suffix === "b") ? { file: name as File, machine: suffix === "b" ? "b" : "a" } : null;
};
function sideOf(spot: Spot): Side | null {
  if (spot === "a" || spot === "b" || spot === "scanner" || spot === "thief") return spot;
  if (spot === "github" || spot === "repo" || spot === "keys" || spot === "key:a" || spot === "key:b") return "g";
  return fileOf(spot)?.machine ?? null;
}

/** Where a named place is drawn in a step (null = not drawn in this step). */
export function spotPoint(view: string, spot: Spot): Pt | null {
  const scene = sceneOf(view);
  switch (spot) {
    case "a": return scene.machines.a.edge;
    case "b": return scene.machines.b?.edge ?? null;
    case "scanner": return scene.scanner;
    case "github": return scene.gEdge;
    case "repo": return center(scene.repo);
    case "keys": return center(scene.keys);
    case "key:a": return center(keySlot(scene, "a"));
    case "key:b": return center(keySlot(scene, "b"));
    case "thief": return scene.thief ? { x: scene.thief.x + scene.thief.w / 2, y: scene.thief.y } : null;
  }
  const file = fileOf(spot);
  const laptop = file && scene.machines[file.machine];
  if (!file || !laptop) return null;
  return center(file.file === "ssh" ? laptop.folder : laptop.rows[file.file]);
}

/**
 * Polyline of a hop: everything between a laptop and GitHub passes the laptop's edge, the door (scanner) and GitHub's edge;
 * the copier's packets go straight; moves inside one laptop are straight too.
 */
export function hopPath(view: string, move: Hop): Pt[] | null {
  const start = spotPoint(view, move.from), end = spotPoint(view, move.to);
  if (!start || !end) return null;
  const scene = sceneOf(view);
  const from = sideOf(move.from), to = sideOf(move.to);
  if (!from || !to || from === to || from === "thief" || to === "thief") return [start, end];
  const toward = (point: Pt, side: Side): Pt[] => {
    if (side === "a" || side === "b") return [point, scene.machines[side]!.edge];
    return side === "g" ? [point, scene.gEdge] : [point];
  };
  const middle = from === "scanner" || to === "scanner" ? [] : [scene.scanner];
  const path = [...toward(start, from), ...middle, ...toward(end, to).reverse()];
  return path.filter((point, index) => index === 0 || Math.hypot(point.x - path[index - 1].x, point.y - path[index - 1].y) > 0.5);
}

// ---------------------------------------------------------------------------
// Progressive reveal (plan 07 §2): the ordered parts of each step. The board draws a part only when it is shown;
// positions never change. Part ids: a / b = laptop, ssh = ~/.ssh folder (setup step), host = GitHub/GitLab card and repo
// (the keys list too in the last step), gate = the scanner and every pipe, keys = SSH keys list (setup step), thief = the copier.
// ---------------------------------------------------------------------------

export const sshParts = (view: string, host?: HostId): RevealPart[] => {
  const name = hostOf(host).name;
  return normalizeSshView(view) === "others"
    ? [{ id: "a", label: "เครื่อง A" }, { id: "b", label: "เครื่อง B" }, { id: "host", label: name }, { id: "gate", label: "ด่านสแกนนิ้ว" }, { id: "thief", label: "กล่องคนแอบคัดลอก .pub" }]
    : [{ id: "a", label: "เครื่อง A (ของเรา)" }, { id: "ssh", label: "โฟลเดอร์ ~/.ssh" }, { id: "host", label: `${name} และ repo` }, { id: "gate", label: "ด่านสแกนนิ้ว" }, { id: "keys", label: "รายการ SSH Keys" }];
};

/** The part that draws a named place in a step (null = the step does not draw it). */
export function sshPartOfSpot(view: string, spot: Spot): string | null {
  const others = normalizeSshView(view) === "others";
  if (spot === "scanner") return "gate";
  if (spot === "github" || spot === "repo") return "host";
  if (spot === "keys" || spot === "key:a" || spot === "key:b") return others ? "host" : "keys";
  if (spot === "thief") return others ? "thief" : null;
  if (spot === "a") return "a";
  if (spot === "b") return others ? "b" : null;
  const file = fileOf(spot);
  if (!file) return null;
  if (file.machine === "b") return others ? "b" : null;
  return others ? "a" : "ssh";
}

/** Parts an action needs: those of the places its frames name, plus the gate when a packet passes the scanner. */
export function sshPartsOfFrames(view: string, frames: readonly FlowFrame<unknown>[]): string[] {
  const scanner = sceneOf(view).scanner;
  return partsOfFrames(frames, (spot) => sshPartOfSpot(view, spot), (move) =>
    hopPath(view, move)?.some((point) => point.x === scanner.x && point.y === scanner.y) ? ["gate"] : []);
}
