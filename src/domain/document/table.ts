import type { FontMetrics } from "./geometry";
import { DEFAULTS, LIMITS } from "./limits";
import type { Point, TableNode, TableRow, TextNode } from "./model";

// Pure layout and editing of table nodes (plan 03 §tables). Rows grow with their wrapped text, measured with
// the same metrics as text nodes, so the editor, hit testing and export agree.

export const TABLE_LINE_HEIGHT = 1.35;
export const tablePadding = (fontSize: number) => ({ x: Math.round(fontSize * 0.55), y: Math.round(fontSize * 0.35) });

export type TableLayout = { colX: number[]; rowY: number[]; rowH: number[]; width: number; height: number };

/** The text of one cell as a text node, for measuring (width = column minus padding). */
export function cellTextNode(node: TableNode, row: number, col: number): TextNode {
  const pad = tablePadding(node.fontSize);
  return {
    id: node.id, type: "text", x: 0, y: 0, rotation: 0, opacity: 1, locked: false,
    text: node.rows[row]?.cells[col] ?? "", width: Math.max(1, node.columns[col] - pad.x * 2),
    fontFamily: DEFAULTS.fontFamily, fontSize: node.fontSize, lineHeight: TABLE_LINE_HEIGHT, color: node.color,
    align: isTitleCell(node, row) ? "center" : "left",
  };
}

export const isHeaderRow = (node: TableNode, row: number) => row === 0 && (node.header || node.variant === "class");
/** Class boxes centre their title. */
export const isTitleCell = (node: TableNode, row: number) => row === 0 && node.variant === "class";

export function tableLayout(node: TableNode, metrics: FontMetrics): TableLayout {
  const pad = tablePadding(node.fontSize);
  const minRow = node.fontSize * TABLE_LINE_HEIGHT + pad.y * 2;
  const colX: number[] = [];
  let x = 0;
  for (const width of node.columns) { colX.push(x); x += width; }
  const rowY: number[] = [], rowH: number[] = [];
  let y = 0;
  node.rows.forEach((row, index) => {
    let height = minRow;
    row.cells.forEach((text, col) => {
      if (text) height = Math.max(height, metrics.measureText(cellTextNode(node, index, col)).height + pad.y * 2);
    });
    rowY.push(y); rowH.push(height); y += height;
  });
  return { colX, rowY, rowH, width: x, height: y };
}

/** Cell under a world point (null outside the table). */
export function tableCellAt(node: TableNode, world: Point, metrics: FontMetrics): { row: number; col: number } | null {
  const radians = -node.rotation * Math.PI / 180;
  const dx = world.x - node.x, dy = world.y - node.y;
  const local = { x: dx * Math.cos(radians) - dy * Math.sin(radians), y: dx * Math.sin(radians) + dy * Math.cos(radians) };
  const layout = tableLayout(node, metrics);
  if (local.x < 0 || local.y < 0 || local.x > layout.width || local.y > layout.height) return null;
  const lastAtOrBefore = (starts: number[], value: number) => starts.reduce((found, start, index) => (value >= start ? index : found), 0);
  return { row: lastAtOrBefore(layout.rowY, local.y), col: lastAtOrBefore(layout.colX, local.x) };
}

// ------------------------------------------------------------------ editing (return a new node; never mutate)

const clip = (text: string) => [...text].slice(0, LIMITS.tableCellCodePoints).join("");
const emptyRow = (columns: number): TableRow => ({ cells: Array.from({ length: columns }, () => ""), divider: false });

export function setCell(node: TableNode, row: number, col: number, text: string): TableNode {
  if (!node.rows[row] || col < 0 || col >= node.columns.length) return node;
  const clean = clip(text);
  if (node.rows[row].cells[col] === clean) return node;
  return { ...node, rows: node.rows.map((item, index) => index === row ? { ...item, cells: item.cells.map((cell, c) => (c === col ? clean : cell)) } : item) };
}

/** New empty row at `at` (0…rows). A class box never gets a row above its title. */
export function insertRow(node: TableNode, at: number): TableNode {
  if (node.rows.length >= LIMITS.tableRows) return node;
  const index = Math.max(node.variant === "class" ? 1 : 0, Math.min(node.rows.length, at));
  return { ...node, rows: [...node.rows.slice(0, index), emptyRow(node.columns.length), ...node.rows.slice(index)] };
}

export function removeRow(node: TableNode, row: number): TableNode {
  if (node.rows.length <= 1 || !node.rows[row] || (node.variant === "class" && row === 0)) return node;
  return { ...node, rows: node.rows.filter((_, index) => index !== row) };
}

/** New column at `at`, as wide as its neighbour. Grid tables only. */
export function insertColumn(node: TableNode, at: number): TableNode {
  if (node.variant !== "grid" || node.columns.length >= LIMITS.tableColumns) return node;
  const index = Math.max(0, Math.min(node.columns.length, at));
  const width = node.columns[Math.min(index, node.columns.length - 1)] ?? 160;
  return {
    ...node,
    columns: [...node.columns.slice(0, index), width, ...node.columns.slice(index)],
    rows: node.rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, index), "", ...row.cells.slice(index)] })),
  };
}

export function removeColumn(node: TableNode, col: number): TableNode {
  if (node.variant !== "grid" || node.columns.length <= 1 || col < 0 || col >= node.columns.length) return node;
  return { ...node, columns: node.columns.filter((_, index) => index !== col), rows: node.rows.map((row) => ({ ...row, cells: row.cells.filter((_, index) => index !== col) })) };
}

/** Section line above a row (not above the title/first row). */
export function toggleDivider(node: TableNode, row: number): TableNode {
  if (row <= 0 || !node.rows[row]) return node;
  return { ...node, rows: node.rows.map((item, index) => (index === row ? { ...item, divider: !item.divider } : item)) };
}

/** Moves the border after column `col` by `delta`, keeping both neighbours at least the minimum width. */
export function resizeColumn(node: TableNode, col: number, delta: number): TableNode {
  if (col < 0 || col >= node.columns.length - 1 || !Number.isFinite(delta)) return node;
  const min = LIMITS.tableColumnMin;
  const left = node.columns[col], right = node.columns[col + 1];
  const move = Math.max(min - left, Math.min(right - min, delta));
  if (!move) return node;
  return { ...node, columns: node.columns.map((width, index) => (index === col ? width + move : index === col + 1 ? width - move : width)) };
}

/** Scales every column to a new total width (each at least the minimum). */
export function setTableWidth(node: TableNode, width: number): TableNode {
  const total = node.columns.reduce((sum, value) => sum + value, 0);
  const factor = Math.max(width, LIMITS.tableColumnMin * node.columns.length) / total;
  return { ...node, columns: node.columns.map((value) => Math.max(LIMITS.tableColumnMin, value * factor)) };
}

/** Black or white text, whichever reads better on a header colour. */
export function readableOn(fill: string): string {
  const value = Number.parseInt(fill.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0F172A" : "#FFFFFF";
}

type NewTable = Omit<TableNode, "id" | "x" | "y">;
const base = { rotation: 0, opacity: 1, locked: false, stroke: "#334155", color: "#0F172A", fontSize: 18 };
export const createGridTable = (): NewTable => ({
  ...base, type: "table", variant: "grid", header: true, headerFill: "#E2E8F0", columns: [160, 160, 160],
  rows: [{ cells: ["หัวข้อ 1", "หัวข้อ 2", "หัวข้อ 3"], divider: false }, emptyRow(3), emptyRow(3)],
});
export const createClassBox = (): NewTable => ({
  ...base, type: "table", variant: "class", header: true, headerFill: "#2563EB", columns: [240],
  rows: [
    { cells: ["User"], divider: false }, { cells: ["id: int"], divider: false }, { cells: ["name: string"], divider: false },
    { cells: ["login()"], divider: true },
  ],
});
