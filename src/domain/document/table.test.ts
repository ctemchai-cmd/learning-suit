import { describe, expect, it } from "vitest";
import { fallbackFontMetrics as metrics, getNodeBounds } from "./geometry";
import { LIMITS } from "./limits";
import { createProjectContent, type CanvasNode, type TableNode } from "./model";
import { parseProjectContent } from "./schema";
import {
  createClassBox, createGridTable, insertColumn, insertRow, readableOn, removeColumn, removeRow, resizeColumn, setCell,
  setTableWidth, tableCellAt, tableLayout, tablePadding, TABLE_LINE_HEIGHT, toggleDivider,
} from "./table";
import { getSingleHandles, scaleSelection, transformSingle } from "./transform";

const grid = (overrides: Partial<TableNode> = {}): TableNode => ({ ...createGridTable(), id: crypto.randomUUID(), x: 100, y: 50, ...overrides });
const classBox = (): TableNode => ({ ...createClassBox(), id: crypto.randomUUID(), x: 0, y: 0 });
const withNodes = (nodes: CanvasNode[]) => {
  const content = createProjectContent("ตาราง");
  content.document.slides[0].nodes = nodes;
  return content;
};

describe("TBL-01: table layout", () => {
  it("sums the columns and grows a row with its wrapped text", () => {
    const table = grid();
    const minRow = table.fontSize * TABLE_LINE_HEIGHT + tablePadding(table.fontSize).y * 2;
    const layout = tableLayout(table, metrics);
    expect(layout.width).toBe(480);
    expect(layout.colX).toEqual([0, 160, 320]);
    expect(layout.rowH).toEqual([minRow, minRow, minRow]);
    const long = tableLayout(setCell(table, 1, 0, "ข้อความยาวมากที่ต้องตัดขึ้นบรรทัดใหม่หลายบรรทัดในช่องแคบ"), metrics);
    expect(long.rowH[1]).toBeGreaterThan(minRow * 2);
    expect(long.height).toBe(long.rowH.reduce((sum, value) => sum + value, 0));
    const bounds = getNodeBounds(table, metrics);
    expect(bounds).toMatchObject({ x: 99, y: 49, width: 482 });
    expect(bounds.height).toBeCloseTo(layout.height + 2);
  });

  it("finds the cell under a point, also when rotated", () => {
    const table = grid();
    const layout = tableLayout(table, metrics);
    expect(tableCellAt(table, { x: 100 + 170, y: 50 + layout.rowY[1] + 2 }, metrics)).toEqual({ row: 1, col: 1 });
    expect(tableCellAt(table, { x: 90, y: 60 }, metrics)).toBeNull();
    const turned = { ...table, rotation: 90 };
    // Rotated 90°: local x runs down the page, local y to the left.
    expect(tableCellAt(turned, { x: 100 - 5, y: 50 + 330 }, metrics)).toEqual({ row: 0, col: 2 });
  });
});

describe("TBL-02: editing a table never mutates and respects the limits", () => {
  it("sets, clips and keeps identity when nothing changes", () => {
    const table = grid();
    expect(setCell(table, 0, 0, "หัวข้อ 1")).toBe(table);
    expect(setCell(table, 9, 0, "x")).toBe(table);
    expect([...setCell(table, 1, 1, "ก".repeat(600)).rows[1].cells[1]]).toHaveLength(LIMITS.tableCellCodePoints);
    expect(table.rows[1].cells[1]).toBe("");
  });

  it("adds and removes rows and columns (never the last one, never above a class title)", () => {
    const table = grid();
    expect(insertRow(table, 1).rows.map((row) => row.cells[0])).toEqual(["หัวข้อ 1", "", "", ""]);
    const wider = insertColumn(table, 1);
    expect(wider.columns).toEqual([160, 160, 160, 160]);
    expect(wider.rows[0].cells).toEqual(["หัวข้อ 1", "", "หัวข้อ 2", "หัวข้อ 3"]);
    expect(removeColumn(wider, 1)).toEqual(table);
    expect(removeRow(removeRow(removeRow(table, 0), 0), 0).rows).toHaveLength(1);
    expect(removeColumn({ ...table, columns: [160], rows: table.rows.map((row) => ({ ...row, cells: [row.cells[0]] })) }, 0).columns).toEqual([160]);
    const box = classBox();
    expect(insertRow(box, 0).rows[0].cells).toEqual(["User"]);
    expect(removeRow(box, 0)).toBe(box);
    expect(insertColumn(box, 1)).toBe(box);
    expect(toggleDivider(box, 0)).toBe(box);
    expect(toggleDivider(box, 1).rows[1].divider).toBe(true);
    let full = table;
    for (let i = 0; i < LIMITS.tableRows; i++) full = insertRow(full, 0);
    expect(full.rows).toHaveLength(LIMITS.tableRows);
  });

  it("moves a column border between neighbours and scales the whole width", () => {
    const table = grid();
    expect(resizeColumn(table, 0, 80).columns).toEqual([240, 80, 160]);
    expect(resizeColumn(table, 0, 500).columns).toEqual([320 - LIMITS.tableColumnMin, LIMITS.tableColumnMin, 160]);
    expect(resizeColumn(table, 2, 50)).toBe(table);
    expect(setTableWidth(table, 240).columns).toEqual([80, 80, 80]);
    expect(setTableWidth(table, 10).columns).toEqual([LIMITS.tableColumnMin, LIMITS.tableColumnMin, LIMITS.tableColumnMin]);
  });

  it("picks readable header text", () => {
    expect(readableOn("#2563EB")).toBe("#FFFFFF");
    expect(readableOn("#E2E8F0")).toBe("#0F172A");
  });
});

describe("TBL-03: tables in documents and transforms", () => {
  it("validates tables strictly", () => {
    expect(() => parseProjectContent(withNodes([grid(), classBox()]))).not.toThrow();
    const table = grid();
    for (const bad of [
      { ...table, rows: [{ cells: ["a"], divider: false }] },
      { ...classBox(), columns: [100, 100], rows: [{ cells: ["a", "b"], divider: false }] },
      { ...table, columns: [10, 160, 160] },
      { ...table, fontSize: 100 },
      { ...table, rows: [] },
      { ...table, variant: "chart" },
    ]) expect(() => parseProjectContent(withNodes([bad as CanvasNode])), JSON.stringify(bad).slice(0, 60)).toThrow();
  });

  it("resizes the width with side handles (rows follow the text) and scales columns + font in a group", () => {
    const table = grid();
    expect(getSingleHandles(table, metrics, 1).map((handle) => handle.id)).toEqual(["e", "w", "rotate"]);
    expect((transformSingle(table, "e", { x: 100 + 240, y: 60 }, { keepAspect: false }, metrics) as TableNode).columns).toEqual([80, 80, 80]);
    const west = transformSingle(table, "w", { x: 340, y: 60 }, { keepAspect: false }, metrics) as TableNode;
    expect(west.x).toBe(340);
    expect(west.columns).toEqual([80, 80, 80]);
    const bounds = getNodeBounds(table, metrics);
    const [half] = scaleSelection([table], "se", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, metrics) as TableNode[];
    expect(half.fontSize).toBeLessThan(table.fontSize);
    expect(half.columns[0]).toBeLessThan(160);
  });
});
