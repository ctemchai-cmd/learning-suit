"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { isActionTool, TOOL_ITEMS, type ToolItem } from "@/features/editor/tools";
import { useEditorStore, type EditorTool } from "@/features/editor/store";
import { FAVORITE_KEY_COUNT, moveFavorite } from "@/features/editor/favorites";

export type ToolbarPosition = { x: number; y: number };

/** Pointer travel before pressing a favorite turns into dragging it to a new place. */
const REORDER_THRESHOLD = 6;

/**
 * Floating favorites on the viewport (screen coordinates, device preference only). Shown in the teacher's
 * order: drag a tool sideways to move it (a plain click still picks it), or Alt+←/→ on a focused tool.
 * The first eight carry their number key.
 */
export default function FavoriteToolbar({ favorites, position, viewport, onPositionChange, onReorder, onAction }: {
  favorites: EditorTool[];
  position: ToolbarPosition;
  viewport: { width: number; height: number };
  onPositionChange: (position: ToolbarPosition) => void;
  onReorder: (order: EditorTool[]) => void;
  onAction: (tool: EditorTool) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const reorder = useRef<{ pointerId: number; id: EditorTool; startX: number; moved: boolean } | null>(null);
  /** The click that follows a drag must not also pick the tool. */
  const suppressClick = useRef(false);
  const [current, setCurrent] = useState(position);
  const [preview, setPreview] = useState<EditorTool[] | null>(null);
  const [draggingId, setDraggingId] = useState<EditorTool | null>(null);
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const writable = useEditorStore((state) => state.writable);

  if (!favorites.length) return null;
  const order = preview ?? favorites;
  const items = order.map((id) => TOOL_ITEMS.find((item) => item.id === id)).filter((item): item is ToolItem => Boolean(item));
  const estimatedWidth = 34 + items.length * 41;
  const clamp = (x: number, y: number): ToolbarPosition => ({
    x: Math.max(0, Math.min(x, viewport.width - (ref.current?.offsetWidth ?? estimatedWidth))),
    y: Math.max(0, Math.min(y, viewport.height - (ref.current?.offsetHeight ?? 48))),
  });

  // ---- moving the whole toolbar by its grip
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !ref.current?.parentElement) return;
    const bounds = ref.current.parentElement.getBoundingClientRect();
    setCurrent(clamp(event.clientX - bounds.left - active.offsetX, event.clientY - bounds.top - active.offsetY));
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    const next = parent ? clamp(event.clientX - parent.left - drag.current.offsetX, event.clientY - parent.top - drag.current.offsetY) : current;
    setCurrent(next);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onPositionChange(next);
  };

  // ---- reordering one tool by dragging it sideways
  /** Index the pointer is over, from the centres of the tool buttons (not counting the dragged one). */
  const indexAt = (clientX: number, id: EditorTool): number => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[data-favorite]") ?? [])].filter((button) => button.dataset.favorite !== id);
    return buttons.filter((button) => { const box = button.getBoundingClientRect(); return clientX > box.left + box.width / 2; }).length;
  };
  const pressTool = (event: PointerEvent<HTMLButtonElement>, id: EditorTool) => {
    if (event.button !== 0) return;
    reorder.current = { pointerId: event.pointerId, id, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragTool = (event: PointerEvent<HTMLButtonElement>) => {
    const active = reorder.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved && Math.abs(event.clientX - active.startX) < REORDER_THRESHOLD) return;
    active.moved = true;
    setDraggingId(active.id);
    setPreview(moveFavorite(favorites, active.id, indexAt(event.clientX, active.id)));
  };
  const releaseTool = (event: PointerEvent<HTMLButtonElement>) => {
    const active = reorder.current;
    if (!active || active.pointerId !== event.pointerId) return;
    reorder.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingId(null);
    setPreview(null);
    if (!active.moved) return;
    suppressClick.current = true;
    const next = moveFavorite(favorites, active.id, indexAt(event.clientX, active.id));
    if (next.some((id, index) => id !== favorites[index])) onReorder(next);
  };
  const cancelTool = () => { reorder.current = null; setDraggingId(null); setPreview(null); };
  const pick = (item: ToolItem) => {
    if (isActionTool(item.id)) { if (writable) onAction(item.id); } else setTool(item.id);
  };
  const keyTool = (event: KeyboardEvent<HTMLButtonElement>, item: ToolItem, index: number) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    onReorder(moveFavorite(favorites, item.id, index + (event.key === "ArrowLeft" ? -1 : 1)));
  };

  return <div ref={ref} className="absolute z-20 flex items-center gap-1 rounded-xl border border-slate-300 bg-white/95 p-1 shadow-lg backdrop-blur"
    style={{ left: Math.max(0, Math.min(current.x, viewport.width - estimatedWidth)), top: Math.max(0, Math.min(current.y, viewport.height - 46)) }}
    role="toolbar" aria-label="เครื่องมือโปรด" onPointerDown={(event) => event.stopPropagation()}>
    <button className="flex h-9 w-6 cursor-grab items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 active:cursor-grabbing" title="ลากเพื่อย้ายแถบเครื่องมือโปรด" aria-label="ย้ายแถบเครื่องมือโปรด" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><GripVertical size={16} /></button>
    {items.map((item, index) => {
      const number = index < FAVORITE_KEY_COUNT ? index + 1 : null;
      const hint = [item.key ? `คีย์ ${item.key}` : "", number ? `หรือ ${number}` : "", "ลากเพื่อสลับลำดับ"].filter(Boolean).join(" · ");
      return <button key={item.id} data-favorite={item.id}
        className={`app-button icon-button relative touch-none ${tool === item.id ? "!border-slate-800 !bg-slate-900 !text-white" : ""} ${draggingId === item.id ? "opacity-60 ring-2 ring-blue-400" : ""}`}
        title={`${item.label} (${hint})`} aria-label={`เครื่องมือโปรด: ${item.label}`} aria-keyshortcuts={number ? String(number) : undefined}
        aria-pressed={isActionTool(item.id) ? undefined : tool === item.id}
        disabled={isActionTool(item.id) && !writable}
        onPointerDown={(event) => pressTool(event, item.id)} onPointerMove={dragTool} onPointerUp={releaseTool} onPointerCancel={cancelTool}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } pick(item); }}
        onKeyDown={(event) => keyTool(event, item, index)}>
        {item.icon}
        {number && <span aria-hidden className={`pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-bold leading-none ${tool === item.id ? "text-slate-300" : "text-slate-400"}`}>{number}</span>}
      </button>;
    })}
  </div>;
}
