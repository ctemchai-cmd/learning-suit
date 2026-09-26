import type { DataState, DataView, Hop, Spot } from "@/domain/data/model";
import { DATA_BASE_SIZE } from "@/domain/document/model";

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
  { id: "relation", label: "เชื่อมตาราง", description: "ก๊อปชื่อซ้ำ vs อ้างถึงด้วย ID" },
  { id: "access", label: "ใครเห็นอะไร", description: "กฎสิทธิ์: เห็นเฉพาะข้อมูลของตัวเอง" },
];

const rowCenter = (table: TableBox, index: number) => table.box.y + table.titleH + table.headerH + index * table.rowH + table.rowH / 2;
const cols = (x: number, parts: [string, string, number, string?][]): Column[] => {
  let left = x;
  return parts.map(([key, label, w, type]) => { const column = { key, label, type, x: left, w }; left += w; return column; });
};

// ---------------------------------------------------------------------------
// Step 1 — where data lives
// ---------------------------------------------------------------------------
const phone = (x: number) => ({
  frame: { x, y: 64, w: 260, h: 546 },
  /** The running app (window with a title bar). */
  app: { x: x + 12, y: 100, w: 236, h: 366 },
  /** Order list inside the app. */
  screen: { x: x + 12, y: 134, w: 236, h: 190 },
  /** The app's own memory — inside the app, so it goes away with it. */
  memory: { x: x + 22, y: 332, w: 216, h: 124 },
  /** Storage on the phone itself — outside the app. */
  device: { x: x + 12, y: 476, w: 236, h: 124 },
});
export const WHERE = {
  A: phone(50),
  B: phone(810),
  cloud: { x: 420, y: 130, w: 280, h: 330 },
  pipeA: [{ x: 310, y: 300 }, { x: 420, y: 300 }] as Pt[],
  pipeB: [{ x: 700, y: 300 }, { x: 810, y: 300 }] as Pt[],
};

// ---------------------------------------------------------------------------
// Step 2 — one table
// ---------------------------------------------------------------------------
export const TABLE = {
  phone: { frame: { x: 40, y: 64, w: 260, h: 546 }, screen: { x: 54, y: 104, w: 232, h: 492 } },
  gate: { x: 362, y: 330 } as Pt,
  db: { x: 424, y: 64, w: 672, h: 546 },
  menu: {
    box: { x: 444, y: 116, w: 632, h: 480 }, titleH: 0, headerH: 50, rowH: 34, maxRows: 12,
    columns: cols(444, [["id", "ID", 70], ["name", "ชื่อ", 250, "ข้อความ"], ["price", "ราคา", 150, "ตัวเลข"], ["available", "มีขาย", 162, "ใช่ / ไม่ใช่"]]),
  } as TableBox,
};

// ---------------------------------------------------------------------------
// Step 3 — copy vs link
// ---------------------------------------------------------------------------
const small = (x: number, parts: [string, string, number, string?][], title: string): TableBox & { title: string } =>
  ({ box: { x, y: 232, w: parts.reduce((sum, part) => sum + part[2], 0), h: 370 }, titleH: 0, headerH: 34, rowH: 28, maxRows: 12, columns: cols(x, parts), title });
export const RELATION = {
  app: { x: 460, y: 62, w: 200, h: 58 },
  copy: { x: 24, y: 136, w: 528, h: 474 },
  link: { x: 568, y: 136, w: 528, h: 474 },
  copyCustomers: small(40, [["id", "ID", 44], ["name", "ชื่อ", 136]], "ลูกค้า"),
  copyOrders: small(236, [["id", "ID", 44], ["copiedName", "ชื่อลูกค้า (ก๊อป)", 150], ["menu", "เมนู", 106]], "ออเดอร์"),
  linkOrders: small(584, [["id", "ID", 44], ["customerId", "ลูกค้า #", 86], ["menu", "เมนู", 150]], "ออเดอร์"),
  linkCustomers: small(900, [["id", "ID", 44], ["name", "ชื่อ", 136]], "ลูกค้า"),
  linkGate: { x: 882, y: 176 } as Pt,
};

// ---------------------------------------------------------------------------
// Step 4 — who can see what
// ---------------------------------------------------------------------------
export const ACCESS = {
  A: { frame: { x: 40, y: 64, w: 250, h: 266 }, screen: { x: 52, y: 100, w: 226, h: 220 } },
  B: { frame: { x: 40, y: 344, w: 250, h: 266 }, screen: { x: 52, y: 380, w: 226, h: 220 } },
  gate: { x: 378, y: 337 } as Pt,
  db: { x: 462, y: 64, w: 634, h: 546 },
  menu: {
    box: { x: 478, y: 108, w: 602, h: 164 }, titleH: 26, headerH: 30, rowH: 26, maxRows: 4,
    columns: cols(478, [["id", "ID", 60], ["name", "ชื่อ", 330], ["price", "ราคา", 212]]),
  } as TableBox,
  orders: {
    box: { x: 478, y: 290, w: 602, h: 312 }, titleH: 26, headerH: 30, rowH: 25, maxRows: 10,
    columns: cols(478, [["id", "ID", 60], ["owner", "เจ้าของ", 200], ["menu", "เมนู", 230], ["qty", "จำนวน", 112]]),
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
      phoneA: center(WHERE.A.screen), phoneB: center(WHERE.B.screen),
      memA: center(WHERE.A.memory), devA: center(WHERE.A.device), memB: center(WHERE.B.memory), devB: center(WHERE.B.device),
      vanishA: { x: 14, y: center(WHERE.A.memory).y }, vanishB: { x: DATA_W - 14, y: center(WHERE.B.memory).y },
      cloud: center(WHERE.cloud),
    };
    return map[spot] ?? null;
  }
  if (view === "table") {
    if (spot === "phoneA") return center(TABLE.phone.screen);
    if (spot === "gate") return TABLE.gate;
    if (spot === "db") return { x: TABLE.db.x + 24, y: TABLE.gate.y };
    const [kind, table, id, field] = spot.split(":");
    if (table !== "menu") return null;
    if (kind === "row") return tableSpot(TABLE.menu, state.menu, Number(id));
    if (kind === "cell") return tableSpot(TABLE.menu, state.menu, Number(id), field);
    return null;
  }
  if (view === "relation") {
    if (spot === "phoneA") return { x: center(RELATION.app).x, y: RELATION.app.y + RELATION.app.h };
    if (spot === "link:gate") return RELATION.linkGate;
    const [side, kind, table, id, field] = spot.split(":");
    const rows = table === "customers" ? state.customers : state.orders;
    const box = side === "copy" ? (table === "customers" ? RELATION.copyCustomers : RELATION.copyOrders) : (table === "customers" ? RELATION.linkCustomers : RELATION.linkOrders);
    if (kind === "row") return tableSpot(box, rows, Number(id));
    if (kind === "cell") return tableSpot(box, rows, Number(id), field === "name" && table === "orders" ? "copiedName" : field);
    return null;
  }
  if (spot === "phoneA") return center(ACCESS.A.screen);
  if (spot === "phoneB") return center(ACCESS.B.screen);
  if (spot === "gate") return ACCESS.gate;
  if (spot === "table:menu") return { x: ACCESS.menu.box.x + 20, y: ACCESS.menu.box.y + ACCESS.menu.box.h / 2 };
  if (spot === "table:orders") return { x: ACCESS.orders.box.x + 20, y: ACCESS.orders.box.y + ACCESS.orders.box.h / 2 };
  const [kind, table, id] = spot.split(":");
  if (kind === "row" && table === "orders") return tableSpot(ACCESS.orders, state.orders, Number(id));
  return null;
}

/** Which region a spot belongs to, so a packet can follow the pipes between regions. */
function zoneOf(view: DataView, spot: Spot): string {
  if (view === "where") return spot.endsWith("A") ? "A" : spot.endsWith("B") ? "B" : "cloud";
  if (view === "table") return spot === "phoneA" ? "phone" : spot === "gate" ? "gate" : "db";
  if (view === "access") return spot === "phoneA" ? "A" : spot === "phoneB" ? "B" : spot === "gate" ? "gate" : "db";
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
    const phoneOut = { x: TABLE.phone.frame.x + TABLE.phone.frame.w, y: TABLE.gate.y };
    const dbIn = { x: TABLE.db.x, y: TABLE.gate.y };
    const route: Record<string, Pt[]> = {
      "phone>gate": [phoneOut], "gate>phone": [phoneOut],
      "gate>db": [dbIn], "db>gate": [dbIn],
      "phone>db": [phoneOut, TABLE.gate, dbIn], "db>phone": [dbIn, TABLE.gate, phoneOut],
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

/** Pipes to draw for a step (always visible, highlighted while something travels on them). */
export function pipesOf(view: DataView): { from: Pt; to: Pt; label?: string }[] {
  if (view === "where") return [
    { from: WHERE.pipeA[0], to: WHERE.pipeA[1], label: "อินเทอร์เน็ต" },
    { from: WHERE.pipeB[0], to: WHERE.pipeB[1], label: "อินเทอร์เน็ต" },
  ];
  if (view === "table") return [
    { from: { x: TABLE.phone.frame.x + TABLE.phone.frame.w, y: TABLE.gate.y }, to: TABLE.gate },
    { from: TABLE.gate, to: { x: TABLE.db.x, y: TABLE.gate.y } },
  ];
  if (view === "access") return [
    { from: { x: ACCESS.A.frame.x + ACCESS.A.frame.w, y: ACCESS.A.frame.y + ACCESS.A.frame.h / 2 }, to: ACCESS.gate },
    { from: { x: ACCESS.B.frame.x + ACCESS.B.frame.w, y: ACCESS.B.frame.y + ACCESS.B.frame.h / 2 }, to: ACCESS.gate },
    { from: ACCESS.gate, to: { x: ACCESS.db.x, y: ACCESS.gate.y } },
  ];
  return [];
}
