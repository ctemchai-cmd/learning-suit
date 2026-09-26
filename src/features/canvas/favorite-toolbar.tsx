"use client";

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { isActionTool, TOOL_ITEMS } from "@/features/editor/tools";
import { useEditorStore, type EditorTool } from "@/features/editor/store";

export type ToolbarPosition = { x: number; y: number };

/** Floating favorites on the viewport (screen coordinates, device preference only). */
export default function FavoriteToolbar({ favorites, position, viewport, onPositionChange, onImage }: {
  favorites: EditorTool[];
  position: ToolbarPosition;
  viewport: { width: number; height: number };
  onPositionChange: (position: ToolbarPosition) => void;
  onImage: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [current, setCurrent] = useState(position);
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const writable = useEditorStore((state) => state.writable);

  if (!favorites.length) return null;
  const items = TOOL_ITEMS.filter((item) => favorites.includes(item.id));
  const estimatedWidth = 34 + items.length * 41;
  const clamp = (x: number, y: number): ToolbarPosition => ({
    x: Math.max(0, Math.min(x, viewport.width - (ref.current?.offsetWidth ?? estimatedWidth))),
    y: Math.max(0, Math.min(y, viewport.height - (ref.current?.offsetHeight ?? 48))),
  });
  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !ref.current?.parentElement) return;
    const bounds = ref.current.parentElement.getBoundingClientRect();
    setCurrent(clamp(event.clientX - bounds.left - active.offsetX, event.clientY - bounds.top - active.offsetY));
  };
  const end = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    const next = parent ? clamp(event.clientX - parent.left - drag.current.offsetX, event.clientY - parent.top - drag.current.offsetY) : current;
    setCurrent(next);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onPositionChange(next);
  };
  return <div ref={ref} className="absolute z-20 flex items-center gap-1 rounded-xl border border-slate-300 bg-white/95 p-1 shadow-lg backdrop-blur"
    style={{ left: Math.max(0, Math.min(current.x, viewport.width - estimatedWidth)), top: Math.max(0, Math.min(current.y, viewport.height - 46)) }}
    role="toolbar" aria-label="เครื่องมือโปรด" onPointerDown={(event) => event.stopPropagation()}>
    <button className="flex h-9 w-6 cursor-grab items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 active:cursor-grabbing" title="ลากเพื่อย้ายแถบเครื่องมือโปรด" aria-label="ย้ายแถบเครื่องมือโปรด" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><GripVertical size={16} /></button>
    {items.map((item) => <button key={item.id} className={`app-button icon-button ${tool === item.id ? "!border-slate-800 !bg-slate-900 !text-white" : ""}`}
      title={item.key ? `${item.label} (${item.key})` : item.label} aria-label={`เครื่องมือโปรด: ${item.label}`} aria-pressed={isActionTool(item.id) ? undefined : tool === item.id}
      disabled={isActionTool(item.id) && !writable}
      onClick={() => { if (isActionTool(item.id)) onImage(); else setTool(item.id); }}>{item.icon}</button>)}
  </div>;
}
