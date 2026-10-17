import type { DataState, DataView, FlowFrame, Hop, Spot } from "@/domain/data/model";
import { partsOfFrames, type RevealPart } from "@/domain/document/reveal";
import { DATA_BASE_SIZE } from "@/domain/document/model";
import { MONITOR_STAND, monitorScreen } from "@/features/flow/monitor";

// Pure geometry of the data-storage widget (plan 07 §3), in widget base coordinates (1120×680).
// The drawing, the packet paths and the tests all read these boxes.

export type Box = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };
export type Column = { key: string; label: string; type?: string; x: number; w: number };
export type TableBox = { box: Box; titleH: number; headerH: number; rowH: number; columns: Column[]; maxRows: number };

export const DATA_W = DATA_BASE_SIZE.width;
export const DATA_H = DATA_BASE_SIZE.height;
export const CAPTION_BOX: Box = { x: 24, y: 620, w: 1072, h: 46 };

export const DATA_VIEWS: { id: DataView; label: string; description: string }[] = [
  { id: "where", label: "ข้อมูลเก็บที่ไหน", description: "เก็บในแอป / ในเครื่อง / ในฐานข้อมูล ต่างกันอย่างไร" },
  { id: "table", label: "ตาราง", description: "แถว คอลัมน์ ชนิดข้อมูล และ เพิ่ม / ดู / แก้ / ลบ" },
  { id: "relation", label: "เชื่อมตาราง", description: "ก๊อปชื่อหมวดซ้ำ vs อ้างถึงด้วย ID" },
  { id: "access", label: "ใครเห็นอะไร", description: "กฎสิทธิ์: เห็นเฉพาะรายรับรายจ่ายของตัวเอง" },
];

const rowCenter = (table: TableBox, index: number) => table.box.y + table.titleH + table.headerH + index * table.rowH + table.rowH / 2;
const cols = (x: number, parts: [string, string, number, string?][]): Column[] => {
  let left = x;
  return parts.map(([key, label, w, type]) => { const column = { key, label, type, x: left, w }; left += w; return column; });
};

// ---------------------------------------------------------------------------
// Step 1 — where data lives
// ---------------------------------------------------------------------------
/** A desktop monitor (bezel `frame`, its neck and base hang `MONITOR_STAND` below it); the device storage sits under the stand. */
const computer = (x: number) => ({
  frame: { x, y: 64, w: 260, h: 370 },
  /** The running app fills the monitor's screen (window with a title bar). */
  app: monitorScreen({ x, y: 64, w: 260, h: 370 }),
  /** Transaction list inside the app. */
  screen: { x: x + 10, y: 108, w: 240, h: 156 },
  /** The app's own memory — inside the app, so it goes away with it. */
  memory: { x: x + 20, y: 272, w: 220, h: 132 },
  /** Storage on the computer itself — outside the app. */
  device: { x: x + 12, y: 476, w: 236, h: 134 },
});
export const WHERE = {
  A: computer(50),
  B: computer(810),
  cloud: { x: 420, y: 130, w: 280, h: 330 },
  pipeA: [{ x: 310, y: 300 }, { x: 420, y: 300 }] as Pt[],
  pipeB: [{ x: 700, y: 300 }, { x: 810, y: 300 }] as Pt[],
};

// ---------------------------------------------------------------------------
// Step 2 — one table
// ---------------------------------------------------------------------------
export const TABLE = {
  pc: { frame: { x: 34, y: 190, w: 270, h: 280 }, screen: monitorScreen({ x: 34, y: 190, w: 270, h: 280 }) },
  gate: { x: 362, y: 330 } as Pt,
  db: { x: 424, y: 64, w: 672, h: 546 },
  categories: {
    box: { x: 444, y: 116, w: 632, h: 480 }, titleH: 0, headerH: 50, rowH: 34, maxRows: 12,
    columns: cols(444, [["id", "ID", 70], ["name", "ชื่อ", 250, "ข้อความ"], ["kind", "ประเภท", 170, "รายรับ / รายจ่าย"], ["active", "ใช้อยู่", 142, "ใช่ / ไม่ใช่"]]),
  } as TableBox,
};

// ---------------------------------------------------------------------------
// Step 3 — copy vs link
// ---------------------------------------------------------------------------
const small = (x: number, parts: [string, string, number, string?][], title: string): TableBox & { title: string } =>
  ({ box: { x, y: 232, w: parts.reduce((sum, part) => sum + part[2], 0), h: 370 }, titleH: 0, headerH: 34, rowH: 28, maxRows: 12, columns: cols(x, parts), title });
export const RELATION = {
  /** Mini monitor of computer A at the top (its neck and base end at y = 120). */
  app: { x: 465, y: 58, w: 190, h: 40 },
  copy: { x: 24, y: 136, w: 528, h: 474 },
  link: { x: 568, y: 136, w: 528, h: 474 },
  copyCategories: small(40, [["id", "ID", 44], ["name", "ชื่อ", 136]], "หมวด"),
  copyTransactions: small(236, [["id", "ID", 44], ["copiedName", "หมวด (ก๊อป)", 138], ["amount", "จำนวนเงิน", 118]], "รายการ"),
  linkTransactions: small(584, [["id", "ID", 44], ["categoryId", "หมวด #", 86], ["amount", "จำนวนเงิน", 150]], "รายการ"),
  linkCategories: small(900, [["id", "ID", 44], ["name", "ชื่อ", 136]], "หมวด"),
  linkGate: { x: 882, y: 176 } as Pt,
};

// ---------------------------------------------------------------------------
// Step 4 — who can see what
// ---------------------------------------------------------------------------
export const ACCESS = {
  A: { frame: { x: 40, y: 64, w: 250, h: 232 }, screen: monitorScreen({ x: 40, y: 64, w: 250, h: 232 }) },
  B: { frame: { x: 40, y: 346, w: 250, h: 232 }, screen: monitorScreen({ x: 40, y: 346, w: 250, h: 232 }) },
  gate: { x: 378, y: 337 } as Pt,
  db: { x: 462, y: 64, w: 634, h: 546 },
  categories: {
    box: { x: 478, y: 108, w: 602, h: 164 }, titleH: 26, headerH: 30, rowH: 26, maxRows: 4,
    columns: cols(478, [["id", "ID", 60], ["name", "ชื่อ", 330], ["kind", "ประเภท", 212]]),
  } as TableBox,
  transactions: {
    box: { x: 478, y: 290, w: 602, h: 312 }, titleH: 26, headerH: 30, rowH: 25, maxRows: 10,
    columns: cols(478, [["id", "ID", 56], ["owner", "เจ้าของ", 180], ["category", "หมวด", 220], ["amount", "จำนวนเงิน (บาท)", 146]]),
  } as TableBox,
};

// ---------------------------------------------------------------------------
// Spots and packet paths
// ---------------------------------------------------------------------------

const center = (box: Box): Pt => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

function tableSpot(table: TableBox, rows: { id: number }[], id: number, column?: string): Pt | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0 || index >= table.maxRows) return null;
  const col = column ? table.columns.find((item) => item.key === column) : null;
  return { x: col ? col.x + col.w / 2 : table.box.x + 26, y: rowCenter(table, index) };
}
export const tableRowY = rowCenter;

/** Where a named place is drawn in a step (null = not visible in this step or row off the list). */
export function spotPoint(view: DataView, state: DataState, spot: Spot): Pt | null {
  if (view === "where") {
    const map: Record<string, Pt> = {
      pcA: center(WHERE.A.screen), pcB: center(WHERE.B.screen),
      memA: center(WHERE.A.memory), devA: center(WHERE.A.device), memB: center(WHERE.B.memory), devB: center(WHERE.B.device),
      vanishA: { x: 14, y: center(WHERE.A.memory).y }, vanishB: { x: DATA_W - 14, y: center(WHERE.B.memory).y },
      cloud: center(WHERE.cloud),
    };
    return map[spot] ?? null;
  }
  if (view === "table") {
    if (spot === "pcA") return center(TABLE.pc.screen);
    if (spot === "gate") return TABLE.gate;
    if (spot === "db") return { x: TABLE.db.x + 24, y: TABLE.gate.y };
    const [kind, table, id, field] = spot.split(":");
    if (table !== "categories") return null;
    if (kind === "row") return tableSpot(TABLE.categories, state.categories, Number(id));
    if (kind === "cell") return tableSpot(TABLE.categories, state.categories, Number(id), field);
    return null;
  }
  if (view === "relation") {
    if (spot === "pcA") return { x: center(RELATION.app).x, y: RELATION.app.y + RELATION.app.h + MONITOR_STAND };
    if (spot === "link:gate") return RELATION.linkGate;
    const [side, kind, table, id, field] = spot.split(":");
    const rows = table === "categories" ? state.categories : state.transactions;
    const box = side === "copy" ? (table === "categories" ? RELATION.copyCategories : RELATION.copyTransactions) : (table === "categories" ? RELATION.linkCategories : RELATION.linkTransactions);
    if (kind === "row") return tableSpot(box, rows, Number(id));
    if (kind === "cell") return tableSpot(box, rows, Number(id), field === "name" && table === "transactions" ? "copiedName" : field);
    return null;
  }
  if (spot === "pcA") return center(ACCESS.A.screen);
  if (spot === "pcB") return center(ACCESS.B.screen);
  if (spot === "gate") return ACCESS.gate;
  if (spot === "table:categories") return { x: ACCESS.categories.box.x + 20, y: ACCESS.categories.box.y + ACCESS.categories.box.h / 2 };
  if (spot === "table:transactions") return { x: ACCESS.transactions.box.x + 20, y: ACCESS.transactions.box.y + ACCESS.transactions.box.h / 2 };
  const [kind, table, id] = spot.split(":");
  if (kind === "row" && table === "transactions") return tableSpot(ACCESS.transactions, state.transactions, Number(id));
  return null;
}

/** Which region a spot belongs to, so a packet can follow the pipes between regions. */
function zoneOf(view: DataView, spot: Spot): string {
  if (view === "where") return spot.endsWith("A") ? "A" : spot.endsWith("B") ? "B" : "cloud";
  if (view === "table") return spot === "pcA" ? "pc" : spot === "gate" ? "gate" : "db";
  if (view === "access") return spot === "pcA" ? "A" : spot === "pcB" ? "B" : spot === "gate" ? "gate" : "db";
  return "all";
}

function waypoints(view: DataView, from: string, to: string): Pt[] {
  if (from === to) return [];
  const reverse = (points: Pt[]) => [...points].reverse();
  if (view === "where") {
    const aToCloud = WHERE.pipeA, cloudToB = WHERE.pipeB;
    const route: Record<string, Pt[]> = {
      "A>cloud": aToCloud, "cloud>A": reverse(aToCloud), "cloud>B": cloudToB, "B>cloud": reverse(cloudToB),
      "A>B": [...aToCloud, center(WHERE.cloud), ...cloudToB], "B>A": reverse([...aToCloud, center(WHERE.cloud), ...cloudToB]),
    };
    return route[`${from}>${to}`] ?? [];
  }
  if (view === "table") {
    const pcOut = { x: TABLE.pc.frame.x + TABLE.pc.frame.w, y: TABLE.gate.y };
    const dbIn = { x: TABLE.db.x, y: TABLE.gate.y };
    const route: Record<string, Pt[]> = {
      "pc>gate": [pcOut], "gate>pc": [pcOut],
      "gate>db": [dbIn], "db>gate": [dbIn],
      "pc>db": [pcOut, TABLE.gate, dbIn], "db>pc": [dbIn, TABLE.gate, pcOut],
    };
    return route[`${from}>${to}`] ?? [];
  }
  if (view === "access") {
    const outA = { x: ACCESS.A.frame.x + ACCESS.A.frame.w, y: ACCESS.A.frame.y + ACCESS.A.frame.h / 2 };
    const outB = { x: ACCESS.B.frame.x + ACCESS.B.frame.w, y: ACCESS.B.frame.y + ACCESS.B.frame.h / 2 };
    const dbIn = { x: ACCESS.db.x, y: ACCESS.gate.y };
    const route: Record<string, Pt[]> = {
      "A>gate": [outA], "gate>A": [outA], "B>gate": [outB], "gate>B": [outB],
      "gate>db": [dbIn], "db>gate": [dbIn],
      "db>A": [dbIn, ACCESS.gate, outA], "db>B": [dbIn, ACCESS.gate, outB],
      "A>db": [outA, ACCESS.gate, dbIn], "B>db": [outB, ACCESS.gate, dbIn],
    };
    return route[`${from}>${to}`] ?? [];
  }
  return [];
}

/**
 * Polyline a packet follows for one hop. `from` is resolved in the state before the hop, `to` in the
 * state after it (a new row only exists afterwards; a deleted row only before). Null = nothing to draw.
 */
export function hopPath(view: DataView, before: DataState, after: DataState, move: Hop): Pt[] | null {
  const start = spotPoint(view, before, move.from) ?? spotPoint(view, after, move.from);
  const end = spotPoint(view, after, move.to) ?? spotPoint(view, before, move.to);
  if (!start || !end) return null;
  return [start, ...waypoints(view, zoneOf(view, move.from), zoneOf(view, move.to)), end];
}

/** Pipes to draw for a step (always visible, highlighted while something travels on them); `part` = the reveal part that shows it (the later of its ends). */
export function pipesOf(view: DataView): { from: Pt; to: Pt; label?: string; part: string }[] {
  if (view === "where") return [
    { from: WHERE.pipeA[0], to: WHERE.pipeA[1], label: "อินเทอร์เน็ต", part: "cloud" },
    { from: WHERE.pipeB[0], to: WHERE.pipeB[1], label: "อินเทอร์เน็ต", part: "pcB" },
  ];
  if (view === "table") return [
    { from: { x: TABLE.pc.frame.x + TABLE.pc.frame.w, y: TABLE.gate.y }, to: TABLE.gate, part: "gate" },
    { from: TABLE.gate, to: { x: TABLE.db.x, y: TABLE.gate.y }, part: "db" },
  ];
  if (view === "access") return [
    { from: { x: ACCESS.A.frame.x + ACCESS.A.frame.w, y: ACCESS.A.frame.y + ACCESS.A.frame.h / 2 }, to: ACCESS.gate, part: "gate" },
    { from: { x: ACCESS.B.frame.x + ACCESS.B.frame.w, y: ACCESS.B.frame.y + ACCESS.B.frame.h / 2 }, to: ACCESS.gate, part: "gate" },
    { from: ACCESS.gate, to: { x: ACCESS.db.x, y: ACCESS.gate.y }, part: "db" },
  ];
  return [];
}

// ---------------------------------------------------------------------------
// Progressive reveal (plan 07 §2): the ordered parts of each step. The board draws a part only when it is shown;
// positions never change. Pipes come with the later of their two ends (`pipesOf(...).part`).
// ---------------------------------------------------------------------------

const part = (id: string, label: string): RevealPart => ({ id, label });
const PARTS: Record<DataView, RevealPart[]> = {
  where: [part("pcA", "คอมพิวเตอร์ A: แอปรายรับรายจ่าย"), part("memA", "ความจำของแอป (หายเมื่อรีเฟรช)"), part("devA", "ที่เก็บในเครื่อง A (อยู่ต่อหลังรีเฟรช)"), part("cloud", "ฐานข้อมูล (Cloud)"), part("pcB", "คอมพิวเตอร์ B (อีกเครื่องของเรา)")],
  table: [part("pc", "แอปบนคอมพิวเตอร์ A"), part("gate", "ด่านตรวจชนิดข้อมูล"), part("db", "ฐานข้อมูล"), part("categories", "ตาราง “หมวด”: แถวและคอลัมน์")],
  relation: [part("app", "แอปรายรับรายจ่าย (คอมพิวเตอร์ A)"), part("copy", "แบบก๊อปชื่อหมวด"), part("link", "แบบอ้างด้วย ID"), part("refs", "เส้นอ้างอิงและด่านตรวจ")],
  access: [part("pcA", "คอมพิวเตอร์ของผู้ใช้ A"), part("pcB", "คอมพิวเตอร์ของผู้ใช้ B"), part("gate", "ด่านกฎสิทธิ์ (RLS)"), part("db", "ฐานข้อมูล"), part("categories", "ตาราง “หมวด” (สาธารณะ)"), part("transactions", "ตาราง “รายการ” (ส่วนตัว)")],
};
export const dataParts = (view: DataView): RevealPart[] => PARTS[view];

/** The part that draws a named place in a step (null = the step does not draw it). */
export function dataPartOfSpot(view: DataView, spot: Spot): string | null {
  if (view === "where") {
    if (spot === "pcA") return "pcA";
    if (spot === "memA" || spot === "vanishA") return "memA";
    if (spot === "devA") return "devA";
    if (spot === "cloud") return "cloud";
    return ["pcB", "memB", "devB", "vanishB"].includes(spot) ? "pcB" : null;
  }
  const [kind, table] = spot.split(":");
  if (view === "table") {
    if (spot === "pcA") return "pc";
    if (spot === "gate") return "gate";
    if (spot === "db") return "db";
    return (kind === "row" || kind === "cell") && table === "categories" ? "categories" : null;
  }
  if (view === "relation") {
    if (spot === "pcA") return "app";
    if (spot === "link:gate") return "refs";
    if (kind === "copy" && table !== undefined) return "copy";
    return kind === "link" && table !== undefined ? "link" : null;
  }
  if (spot === "pcA" || spot === "pcB" || spot === "gate") return spot;
  if (spot === "table:categories") return "categories";
  if (spot === "table:transactions" || (kind === "row" && table === "transactions")) return "transactions";
  return null;
}

/** Parts an action needs: those of the places its frames name, plus the gate / the cloud a packet passes on its way. */
export function dataPartsOfFrames(view: DataView, frames: readonly FlowFrame<unknown>[]): string[] {
  return partsOfFrames(frames, (spot) => dataPartOfSpot(view, spot), (move) => {
    const from = zoneOf(view, move.from), to = zoneOf(view, move.to);
    if (from === to) return [];
    if (view === "where") return from !== "cloud" && to !== "cloud" ? ["cloud"] : [];
    return view === "table" || view === "access" ? ["gate"] : [];
  });
}
