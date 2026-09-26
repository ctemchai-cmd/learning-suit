"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { TableNode } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { worldToScreen } from "@/domain/document/camera";
import { LIMITS } from "@/domain/document/limits";
import { insertRow, isHeaderRow, isTitleCell, readableOn, resizeColumn, setCell, TABLE_LINE_HEIGHT, tableLayout, tablePadding } from "@/domain/document/table";
import { useEditorStore, type TableEdit } from "@/features/editor/store";
import { CANVAS_FONT, konvaFontMetrics } from "./font-metrics";

type Move = "close" | "cancel" | "next" | "prev" | "down";

/**
 * Typing into one table cell (plan 03 §tables): a textarea over the cell, the table re-flows live (rows grow).
 * Tab / Shift+Tab = next / previous cell (Tab on the last cell adds a row), Enter = cell below (a class box
 * adds a line under this one), Shift+Enter = new line inside the cell, Esc = cancel. Each cell is one Undo step.
 */
export function TableCellEditor({ node, edit, camera }: { node: TableNode; edit: TableEdit; camera: Camera }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => node.rows[edit.row]?.cells[edit.col] ?? "");
  const done = useRef(false);
  const composing = useRef(false);
  const textRef = useRef(text);
  useLayoutEffect(() => { textRef.current = text; });
  const setPropertyPreview = useEditorStore((state) => state.setPropertyPreview);
  const registerFlusher = useEditorStore((state) => state.registerFlusher);

  const finish = (move: Move): boolean => {
    if (done.current) return true;
    done.current = true;
    const state = useEditorStore.getState();
    state.setPropertyPreview(null);
    const found = state.history?.content.document.slides.find((slide) => slide.id === edit.slideId)?.nodes.find((item) => item.id === edit.nodeId);
    if (found?.type !== "table") { state.setTableEdit(null); return true; }
    const { row, col } = edit;
    let next = move === "cancel" ? found : setCell(found, row, col, textRef.current);
    let target: { row: number; col: number } | null = null;
    const rows = next.rows.length, cols = next.columns.length;
    if (move === "next") {
      if (col + 1 < cols) target = { row, col: col + 1 };
      else if (row + 1 < rows) target = { row: row + 1, col: 0 };
      else { next = insertRow(next, rows); target = { row: rows, col: 0 }; }
    } else if (move === "prev") {
      if (col > 0) target = { row, col: col - 1 };
      else if (row > 0) target = { row: row - 1, col: cols - 1 };
    } else if (move === "down") {
      if (next.variant === "class" && row > 0) { next = insertRow(next, row + 1); target = { row: row + 1, col: 0 }; }
      else if (row + 1 < rows) target = { row: row + 1, col };
      else { next = insertRow(next, rows); target = { row: rows, col }; }
    }
    if (target && target.row >= next.rows.length) target = null;
    if (next !== found && state.writable) {
      const added = next.rows.length !== found.rows.length;
      const ok = state.transact({ label: added ? "เพิ่มแถวในตาราง" : "แก้ข้อความในตาราง", affectedSlideId: edit.slideId, commands: [{ type: "nodes.replace", slideId: edit.slideId, nodes: [next] }] });
      if (!ok) { done.current = false; return false; }
    }
    // Like Word/Excel: moving to a cell selects its text, so typing replaces it.
    state.setTableEdit(target ? { slideId: edit.slideId, nodeId: edit.nodeId, ...target, selectAll: true } : null);
    return true;
  };
  const finishRef = useRef(finish);
  useLayoutEffect(() => { finishRef.current = finish; });

  // Save, slide change, selection change … commit the cell first (never during IME composition).
  useEffect(() => registerFlusher(() => (composing.current ? false : finishRef.current("close"))), [registerFlusher]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    if (edit.selectAll) element.select();
    else element.setSelectionRange(element.value.length, element.value.length);
  }, [edit.selectAll]);

  // `node` is the stored table (not the preview), so the draft only changes when the text does.
  const draft = useMemo(() => setCell(node, edit.row, edit.col, text), [node, edit.row, edit.col, text]);
  // Live re-flow on the board while typing (rows grow with the text).
  useEffect(() => {
    if (!done.current) setPropertyPreview(draft === node ? null : { slideId: edit.slideId, nodes: [draft] });
  }, [draft, node, edit.slideId, setPropertyPreview]);

  const layout = tableLayout(draft, konvaFontMetrics);
  const pad = tablePadding(node.fontSize);
  const local = { x: layout.colX[edit.col] ?? 0, y: layout.rowY[edit.row] ?? 0 };
  const radians = node.rotation * Math.PI / 180;
  const origin = worldToScreen({ x: node.x + local.x * Math.cos(radians) - local.y * Math.sin(radians), y: node.y + local.x * Math.sin(radians) + local.y * Math.cos(radians) }, camera);
  const header = isHeaderRow(node, edit.row);
  return <textarea
    ref={ref}
    aria-label={`แก้ข้อความในตาราง แถว ${edit.row + 1} คอลัมน์ ${edit.col + 1}`}
    className="absolute z-30 resize-none overflow-hidden border-0 outline outline-2 outline-blue-500"
    style={{
      left: origin.x, top: origin.y, width: node.columns[edit.col], height: layout.rowH[edit.row],
      padding: `${pad.y}px ${pad.x}px`, boxSizing: "border-box",
      transform: `rotate(${node.rotation}deg) scale(${camera.zoom})`, transformOrigin: "top left",
      fontFamily: `"${CANVAS_FONT}", sans-serif`, fontSize: node.fontSize, lineHeight: TABLE_LINE_HEIGHT, fontWeight: header ? 700 : 400,
      color: header ? readableOn(node.headerFill) : node.color, background: header ? node.headerFill : "#FFFFFF",
      textAlign: isTitleCell(node, edit.row) ? "center" : "left", whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}
    value={text}
    spellCheck={false}
    onChange={(event) => { if ([...event.target.value].length <= LIMITS.tableCellCodePoints) setText(event.target.value); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => { if (!composing.current) finish("close"); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      const typing = event.nativeEvent.isComposing || composing.current;
      if (event.key === "Escape") { event.preventDefault(); finish("cancel"); return; }
      if (typing) return;
      if (event.key === "Tab") { event.preventDefault(); finish(event.shiftKey ? "prev" : "next"); return; }
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) { event.preventDefault(); finish("down"); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); finish("close"); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (finish("close")) void useEditorStore.getState().save();
      }
    }}
  />;
}

/**
 * Drag handles on the inner column borders of the one selected table: the border moves, the neighbours
 * share the change (each keeps the minimum width). One drag = one Undo step.
 */
export function TableColumnHandles({ node, shown, slideId, camera }: { node: TableNode; shown: TableNode; slideId: string; camera: Camera }) {
  const drag = useRef<{ pointerId: number; col: number; start: { x: number; y: number } } | null>(null);
  const setPropertyPreview = useEditorStore((state) => state.setPropertyPreview);
  const setGestureActive = useEditorStore((state) => state.setGestureActive);
  const layout = tableLayout(shown, konvaFontMetrics);
  const radians = node.rotation * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  /** Pointer travel along the table's own x axis, in board units. */
  const along = (event: ReactPointerEvent, start: { x: number; y: number }) => ((event.clientX - start.x) * cos + (event.clientY - start.y) * sin) / camera.zoom;
  const end = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setGestureActive(false);
    setPropertyPreview(null);
    const next = resizeColumn(node, active.col, along(event, active.start));
    if (commit && next !== node) {
      useEditorStore.getState().transact({ label: "ปรับความกว้างคอลัมน์", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [next] }] });
    }
  };
  return <>{layout.colX.slice(1).map((x, index) => {
    const at = worldToScreen({ x: node.x + x * cos, y: node.y + x * sin }, camera);
    return <div key={index} role="separator" aria-orientation="vertical" data-board-chrome aria-label={`ปรับความกว้างคอลัมน์ ${index + 1}`} title="ลากเพื่อปรับความกว้างคอลัมน์"
      className="group absolute z-20 w-3 cursor-col-resize touch-none"
      style={{ left: at.x - 6, top: at.y, height: layout.height * camera.zoom, transform: `rotate(${node.rotation}deg)`, transformOrigin: "6px 0" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, col: index, start: { x: event.clientX, y: event.clientY } };
        setGestureActive(true);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        setPropertyPreview({ slideId, nodes: [resizeColumn(node, active.col, along(event, active.start))] });
      }}
      onPointerUp={(event) => end(event, true)}
      onPointerCancel={(event) => end(event, false)}>
      <div className="mx-auto h-full w-0.5 rounded bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>;
  })}</>;
}
