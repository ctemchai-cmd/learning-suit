"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Bold, Code2, GripVertical, Lock, Minus, Plus, Trash2 } from "lucide-react";
import type { Bounds, CanvasNode } from "@/domain/document/model";
import { liveRole, useEditorStore } from "@/features/editor/store";
import { applyField, supports, type Field } from "@/features/editor/property-fields";

// Quick properties (plan 03 §quick properties): a small bar like the favorites toolbar that appears with a
// selection — colours, width, line style, text size/bold, then Lock and Delete. It sits above the selection
// (below when there is no room), never on it; dragged by its grip it stays there for THIS selection only —
// a new selection starts at the automatic place again (the canvas keys the bar by the selected IDs).

const COLOURS = ["#1F2937", "#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2", "#2563EB", "#7C3AED", "#DB2777", "#FFFFFF"];
const WIDTHS = [1, 2, 3, 5, 8];
type Popover = "stroke" | "fill" | "color" | "headerFill" | "width";
type Point = { x: number; y: number };

const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function Swatch({ colour }: { colour: string }) {
  const none = colour === "transparent";
  return <span aria-hidden className="block h-4 w-4 rounded-full border border-slate-300"
    style={{ background: none ? "linear-gradient(135deg, #fff 45%, #DC2626 45% 55%, #fff 55%)" : colour }} />;
}

function Palette({ value, allowNone, onPick }: { value: string; allowNone?: boolean; onPick: (colour: string) => void }) {
  return <div className="grid grid-cols-6 gap-1.5">
    {allowNone && <button type="button" className="grid h-7 w-7 place-items-center rounded-full hover:bg-slate-100" aria-label="ไม่มีสีพื้น" title="ไม่มีสีพื้น"
      aria-pressed={value === "transparent"} onClick={() => onPick("transparent")}><Swatch colour="transparent" /></button>}
    {COLOURS.map((colour) => <button key={colour} type="button" aria-label={`สี ${colour}`} title={colour} aria-pressed={value.toUpperCase() === colour}
      className={`grid h-7 w-7 place-items-center rounded-full ${value.toUpperCase() === colour ? "ring-2 ring-blue-500" : "hover:bg-slate-100"}`} onClick={() => onPick(colour)}>
      <span aria-hidden className="block h-5 w-5 rounded-full border border-slate-300" style={{ background: colour }} />
    </button>)}
    <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-full hover:bg-slate-100" title="เลือกสีเอง">
      <span aria-hidden className="block h-5 w-5 rounded-full border border-slate-300" style={{ background: "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)" }} />
      <input type="color" aria-label="เลือกสีเอง" className="absolute inset-0 cursor-pointer opacity-0" value={value === "transparent" ? "#ffffff" : value.toLowerCase()}
        onChange={(event) => onPick(event.target.value.toUpperCase())} />
    </label>
  </div>;
}

function BarButton({ label, onClick, active, children, danger }: { label: string; onClick: () => void; active?: boolean; danger?: boolean; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick}
    className={`grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-slate-700 transition-colors ${active ? "bg-slate-900 !text-white" : danger ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-slate-100"}`}>{children}</button>;
}

export function QuickProperties({ nodes, slideId, selection, viewport }: {
  /** The stored selected nodes (unlocked). */
  nodes: CanvasNode[];
  slideId: string;
  /** Selection box in screen pixels (relative to the board). */
  selection: Bounds;
  viewport: { width: number; height: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState<Point | null>(null);
  const [auto, setAuto] = useState<Point | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const drag = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [dragged, setDragged] = useState<Point | null>(null);

  const { x: selX, y: selY, width: selW, height: selH } = selection;
  // The bar's width depends on what is selected: re-measure when the kinds change.
  const kinds = nodes.map((node) => node.type).join(",");
  // Place it above the selection, else below, else at the top centre — never over the selection or the favorites bar.
  useLayoutEffect(() => {
    const selection = { x: selX, y: selY, width: selW, height: selH };
    const element = ref.current;
    if (!element || pinned) return;
    const width = element.offsetWidth, height = element.offsetHeight;
    const clampX = (x: number) => Math.max(8, Math.min(x, viewport.width - width - 8));
    const x = clampX(selection.x + selection.width / 2 - width / 2);
    const favorites = element.parentElement?.querySelector<HTMLElement>('[role="toolbar"][aria-label="เครื่องมือโปรด"]');
    const favoriteBox: Bounds | null = favorites ? { x: favorites.offsetLeft, y: favorites.offsetTop, width: favorites.offsetWidth, height: favorites.offsetHeight } : null;
    const candidates: Point[] = [
      { x, y: selection.y - height - 70 }, // clear of the rotation handle and the top connection point
      { x, y: selection.y + selection.height + 40 },
      { x: clampX(viewport.width / 2 - width / 2), y: 8 },
    ];
    const fits = (point: Point) => {
      const box = { x: point.x, y: point.y, width, height };
      return point.y >= 8 && point.y + height <= viewport.height - 8 && !overlaps(box, selection) && !(favoriteBox && overlaps(box, favoriteBox));
    };
    const next = candidates.find(fits) ?? { x: clampX(viewport.width / 2 - width / 2), y: viewport.height - height - 60 };
    setAuto((current) => (current && current.x === next.x && current.y === next.y ? current : next));
  }, [pinned, selX, selY, selW, selH, viewport.width, viewport.height, kinds]);

  // A popover closes on Escape or a press outside the bar.
  useEffect(() => {
    if (!popover) return;
    const outside = (event: globalThis.PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setPopover(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setPopover(null); } };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
  }, [popover]);

  const ids = nodes.map((node) => node.id);
  const latest = () => {
    const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
    return slide?.nodes.filter((node) => ids.includes(node.id) && !node.locked) ?? [];
  };
  const commit = (field: Field, value: unknown) => {
    const next = applyField(latest(), field, value);
    if (next.length) useEditorStore.getState().transact({ label: "แก้คุณสมบัติวัตถุ", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: next }] });
  };
  /** A−/A+: each object steps from its own size. */
  const stepFont = (direction: 1 | -1) => {
    const next = latest().filter((node) => supports(node, "fontSize")).flatMap((node) => {
      const size = (node as unknown as { fontSize: number }).fontSize;
      return applyField([node], "fontSize", Math.round(size * (direction > 0 ? 1.15 : 1 / 1.15)));
    });
    if (next.length) useEditorStore.getState().transact({ label: "เปลี่ยนขนาดตัวอักษร", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: next }] });
  };
  const lock = () => {
    const state = useEditorStore.getState();
    if (state.transact({ label: "ล็อกวัตถุ", affectedSlideId: slideId, commands: [{ type: "nodes.lock", slideId, ids, locked: true }] })) state.setSelectedIds([]);
  };
  const remove = () => {
    const state = useEditorStore.getState();
    if (state.transact({ label: "ลบวัตถุ", affectedSlideId: slideId, commands: [{ type: "nodes.remove", slideId, ids }] })) state.setSelectedIds([]);
  };

  const all = (field: Field) => nodes.length > 0 && nodes.every((node) => supports(node, field));
  const value = (field: Field) => String((nodes.find((node) => supports(node, field)) as unknown as Record<string, unknown> | undefined)?.[field] ?? "");
  const pick = (field: Field) => (colour: string) => { commit(field, colour); setPopover(null); };

  // ---- moving the bar by its grip
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, offsetX: event.clientX - box.left, offsetY: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const place = (event: PointerEvent<HTMLButtonElement>): Point | null => {
    const active = drag.current, parent = ref.current?.parentElement, element = ref.current;
    if (!active || active.pointerId !== event.pointerId || !parent || !element) return null;
    const box = parent.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(event.clientX - box.left - active.offsetX, viewport.width - element.offsetWidth)),
      y: Math.max(0, Math.min(event.clientY - box.top - active.offsetY, viewport.height - element.offsetHeight)),
    };
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const point = place(event);
    if (!point) return;
    drag.current = null;
    setDragged(null);
    setPinned(point);
  };

  const position = dragged ?? pinned ?? auto;
  const pop = (kind: Popover, content: ReactNode) => popover === kind && <div className="absolute left-1/2 top-full z-10 mt-2 w-max -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{content}</div>;
  const colourButton = (field: Field, kind: Popover, label: string, allowNone = false) => <div className="relative">
    <BarButton label={label} active={popover === kind} onClick={() => setPopover(popover === kind ? null : kind)}><Swatch colour={value(field) || "#1F2937"} /></BarButton>
    {pop(kind, <Palette value={value(field)} allowNone={allowNone} onPick={pick(field)} />)}
  </div>;

  return <div ref={ref} role="toolbar" aria-label="ปรับค่าด่วน"
    className="absolute z-40 flex items-center gap-0.5 rounded-xl border border-slate-300 bg-white/95 p-1 shadow-lg backdrop-blur"
    style={{ left: position?.x ?? -9999, top: position?.y ?? -9999, visibility: position ? "visible" : "hidden" }}
    onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <button type="button" className="flex h-8 w-5 cursor-grab items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
      title={pinned ? "ลากเพื่อย้าย · ดับเบิลคลิกให้กลับไปอยู่ใกล้วัตถุ" : "ลากเพื่อย้ายแถบปรับค่า (เลือกใหม่จะกลับมาอยู่ใกล้วัตถุ)"} aria-label="ย้ายแถบปรับค่า"
      onPointerDown={startDrag} onPointerMove={(event) => { const point = place(event); if (point) setDragged(point); }} onPointerUp={endDrag} onPointerCancel={endDrag}
      onDoubleClick={() => setPinned(null)}><GripVertical size={14} /></button>
    {all("stroke") && colourButton("stroke", "stroke", "สีเส้น")}
    {all("fill") && colourButton("fill", "fill", "สีพื้น", true)}
    {all("strokeWidth") && <div className="relative">
      <BarButton label="ความหนาเส้น" active={popover === "width"} onClick={() => setPopover(popover === "width" ? null : "width")}>
        <span aria-hidden className="block w-4 rounded-full bg-slate-700" style={{ height: Math.max(1.5, Math.min(6, Number(value("strokeWidth")) / 1.5)) }} />
      </BarButton>
      {pop("width", <div className="flex flex-col gap-1">{WIDTHS.map((width) => <button key={width} type="button" aria-label={`ความหนา ${width}`} aria-pressed={Number(value("strokeWidth")) === width}
        className={`flex h-7 w-20 items-center gap-2 rounded-md px-2 text-xs text-slate-600 ${Number(value("strokeWidth")) === width ? "bg-slate-100 font-semibold" : "hover:bg-slate-50"}`}
        onClick={() => { commit("strokeWidth", width); setPopover(null); }}>
        <span aria-hidden className="block flex-1 rounded-full bg-slate-700" style={{ height: Math.max(1, width / 1.5) }} />{width}</button>)}</div>)}
    </div>}
    {all("strokeStyle") && <BarButton label={value("strokeStyle") === "dashed" ? "เส้นประ (กดเป็นเส้นทึบ)" : "เส้นทึบ (กดเป็นเส้นประ)"} active={value("strokeStyle") === "dashed"}
      onClick={() => commit("strokeStyle", value("strokeStyle") === "dashed" ? "solid" : "dashed")}>
      <span aria-hidden className="block w-4 border-t-2 border-dashed border-current" />
    </BarButton>}
    {all("headerFill") && colourButton("headerFill", "headerFill", "สีหัวตาราง")}
    {all("color") && colourButton("color", "color", nodes.every((node) => node.type === "stencil") ? "สี" : "สีตัวอักษร")}
    {all("fontSize") && <>
      <BarButton label="ตัวอักษรเล็กลง" onClick={() => stepFont(-1)}><span className="flex items-center text-xs font-bold">A<Minus size={10} /></span></BarButton>
      <BarButton label="ตัวอักษรใหญ่ขึ้น" onClick={() => stepFont(1)}><span className="flex items-center text-sm font-bold">A<Plus size={10} /></span></BarButton>
    </>}
    {all("bold") && <BarButton label="ตัวหนา (⌘B)" active={nodes.every((node) => node.type === "text" && node.bold)}
      onClick={() => commit("bold", !nodes.every((node) => node.type === "text" && node.bold))}><Bold size={15} /></BarButton>}
    {all("theme") && <BarButton label={value("theme") === "dark" ? "ธีมโค้ด: มืด (กดเป็นสว่าง)" : "ธีมโค้ด: สว่าง (กดเป็นมืด)"} active={value("theme") === "dark"}
      onClick={() => commit("theme", value("theme") === "dark" ? "light" : "dark")}><Code2 size={15} /></BarButton>}
    <span aria-hidden className="mx-0.5 h-5 w-px bg-slate-200" />
    {liveRole() !== "guest" && <BarButton label="ล็อก (⌘L) · ปลดล็อกที่แท็บ Objects" onClick={lock}><Lock size={15} /></BarButton>}
    <BarButton label="ลบ (Delete)" danger onClick={remove}><Trash2 size={15} /></BarButton>
  </div>;
}
