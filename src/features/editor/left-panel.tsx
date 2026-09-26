"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, ChevronDown, ChevronUp, Copy, Database, GitBranch, Rocket, PanelLeftClose, PanelLeftOpen, PenLine, Plus, Star, Trash2 } from "lucide-react";
import type { SlideDocument } from "@/domain/document/model";
import { isActionTool, TOOL_ITEMS } from "./tools";
import type { EditorTool } from "./store";

const WIDTH_KEY = "learning-suit-left-panel-width-v1";
const COLLAPSED_KEY = "learning-suit-left-panel-collapsed-v1";
const MIN_WIDTH = 192;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 56;
const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));

function readWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(saved) && saved >= MIN_WIDTH ? clampWidth(saved) : DEFAULT_WIDTH;
}
function readCollapsed() {
  return typeof window !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "true";
}

export default function LeftPanel({ slides, activeSlideId, tool, setTool, favorites, toggleFavorite, writable, onSwitchSlide, onAddSlide, onCopySlide, onRenameSlide, onDeleteSlide, onMoveSlide, onReorderSlides, onInsertGit, onInsertData, onInsertDeploy, onInsertAi, onImage, autoCollapsed = false }: {
  slides: SlideDocument[];
  activeSlideId: string | undefined;
  tool: EditorTool;
  setTool: (tool: EditorTool) => void;
  favorites: EditorTool[];
  toggleFavorite: (tool: EditorTool) => void;
  writable: boolean;
  onSwitchSlide: (slideId: string) => void;
  onAddSlide: () => void;
  onCopySlide: () => void;
  onRenameSlide: () => void;
  onDeleteSlide: () => void;
  onMoveSlide: (direction: -1 | 1) => void;
  onReorderSlides: (orderedIds: string[]) => void;
  onInsertGit: () => void;
  onInsertData: () => void;
  onInsertDeploy: () => void;
  onInsertAi: () => void;
  onImage: () => void;
  /** Below 1100 px the rail starts collapsed and opens as an overlay over the canvas. */
  autoCollapsed?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const pickTool = (id: EditorTool) => { if (isActionTool(id)) onImage(); else setTool(id); };
  const dropOn = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const ordered = slides.map((slide) => slide.id).filter((id) => id !== dragging);
    ordered.splice(ordered.indexOf(targetId) + (slides.findIndex((slide) => slide.id === dragging) < slides.findIndex((slide) => slide.id === targetId) ? 1 : 0), 0, dragging);
    onReorderSlides(ordered);
  };
  const [width, setWidth] = useState(readWidth);
  const [storedCollapsed, setCollapsed] = useState(readCollapsed);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const collapsed = autoCollapsed ? !overlayOpen : storedCollapsed;
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const activeIndex = slides.findIndex((slide) => slide.id === activeSlideId);
  const toggle = () => {
    if (autoCollapsed) { setOverlayOpen(!overlayOpen); return; }
    const next = !storedCollapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setWidth(clampWidth(active.startWidth + event.clientX - active.startX));
  };
  const endResize = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const next = cancel ? active.startWidth : clampWidth(active.startWidth + event.clientX - active.startX);
    drag.current = null;
    setWidth(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel) localStorage.setItem(WIDTH_KEY, String(next));
  };
  const separatorKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault(); event.stopPropagation();
      setWidth(drag.current.startWidth);
      if (event.currentTarget.hasPointerCapture(drag.current.pointerId)) event.currentTarget.releasePointerCapture(drag.current.pointerId);
      drag.current = null;
      return;
    }
    let next = width;
    if (event.key === "ArrowLeft") next = clampWidth(width - (event.shiftKey ? 32 : 16));
    else if (event.key === "ArrowRight") next = clampWidth(width + (event.shiftKey ? 32 : 16));
    else if (event.key === "Home") next = MIN_WIDTH;
    else if (event.key === "End") next = MAX_WIDTH;
    else return;
    event.preventDefault(); event.stopPropagation();
    setWidth(next);
    localStorage.setItem(WIDTH_KEY, String(next));
  };

  const overlay = autoCollapsed && overlayOpen;
  return <div className="relative flex shrink-0" style={{ width: collapsed || overlay ? COLLAPSED_WIDTH : width }}>
    <aside className={`flex min-w-0 flex-1 flex-col overflow-hidden border-r border-slate-200 bg-white ${overlay ? "absolute left-0 top-0 z-40 h-full shadow-2xl" : ""}`} style={overlay ? { width } : undefined} aria-label="เครื่องมือและสไลด์">
      <div className={`flex shrink-0 items-center border-b border-slate-200 ${collapsed ? "justify-center p-2" : "justify-between px-3 py-2"}`}>
        {!collapsed && <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">เครื่องมือและสไลด์</span>}
        <button className="app-button icon-button !h-8 !w-8" aria-label={collapsed ? "ขยายแถบซ้าย" : "ยุบแถบซ้าย"} title={collapsed ? "ขยายแถบซ้าย" : "ยุบแถบซ้าย"} aria-expanded={!collapsed} onClick={toggle}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
      </div>
      {collapsed ? <>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-3">{TOOL_ITEMS.map((item) => <button key={item.id} className={`app-button icon-button !h-9 !w-9 ${tool === item.id ? "!border-slate-800 !bg-slate-900 !text-white" : ""}`} title={`${item.label} (${item.key})`} aria-label={item.label} aria-pressed={isActionTool(item.id) ? undefined : tool === item.id} disabled={isActionTool(item.id) && !writable} onClick={() => pickTool(item.id)}>{item.icon}</button>)}
          <button className="app-button icon-button !h-9 !w-9" aria-label="เพิ่มตัวจำลอง Git" title="เพิ่มตัวจำลอง Git กลางจอ" disabled={!writable} onClick={onInsertGit}><GitBranch size={17} /></button>
          <button className="app-button icon-button !h-9 !w-9" aria-label="เพิ่มตัวจำลองข้อมูล" title="เพิ่มตัวจำลองการเก็บข้อมูลกลางจอ" disabled={!writable} onClick={onInsertData}><Database size={17} /></button>
          <button className="app-button icon-button !h-9 !w-9" aria-label="เพิ่มตัวจำลอง Deploy" title="เพิ่มตัวจำลองการ Deploy กลางจอ" disabled={!writable} onClick={onInsertDeploy}><Rocket size={17} /></button>
          <button className="app-button icon-button !h-9 !w-9" aria-label="เพิ่มตัวจำลอง AI" title="เพิ่มตัวจำลอง AI (แชท, Memory, Claude Code) กลางจอ" disabled={!writable} onClick={onInsertAi}><Bot size={17} /></button></div>
        <div className="space-y-2 border-t border-slate-200 p-2">
          <select className="w-9 rounded border border-slate-200 bg-white text-xs" aria-label="เลือกสไลด์" title="เลือกสไลด์" value={activeSlideId ?? ""} onChange={(event) => onSwitchSlide(event.target.value)}>{slides.map((slide, index) => <option key={slide.id} value={slide.id}>{index + 1}. {slide.name}</option>)}</select>
          <button className="app-button icon-button !h-9 !w-9" aria-label="เพิ่มสไลด์" title="เพิ่มสไลด์" disabled={!writable} onClick={onAddSlide}><Plus size={17} /></button>
        </div>
      </> : <>
        <div className="border-b border-slate-200 p-3"><div className="mb-2 text-xs text-slate-500">กดดาวเพื่อปักหมุดเครื่องมือโปรด</div><div className="grid grid-cols-4 gap-2">{TOOL_ITEMS.map((item) => <div key={item.id} className="relative"><button className={`app-button icon-button w-full ${tool === item.id ? "!border-slate-800 !bg-slate-900 !text-white" : ""}`} title={item.key ? `${item.label} (${item.key})` : item.label} aria-label={item.label} aria-pressed={isActionTool(item.id) ? undefined : tool === item.id} disabled={isActionTool(item.id) && !writable} onClick={() => pickTool(item.id)}>{item.icon}</button><button className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-white ${favorites.includes(item.id) ? "text-amber-500" : "text-slate-400"}`} title={favorites.includes(item.id) ? `นำ ${item.label} ออกจากเครื่องมือโปรด` : `เพิ่ม ${item.label} ในเครื่องมือโปรด`} aria-label={favorites.includes(item.id) ? `นำ ${item.label} ออกจากเครื่องมือโปรด` : `เพิ่ม ${item.label} ในเครื่องมือโปรด`} aria-pressed={favorites.includes(item.id)} onClick={() => toggleFavorite(item.id)}><Star size={11} fill={favorites.includes(item.id) ? "currentColor" : "none"} /></button></div>)}</div>
          {/* One compact row so the slide list keeps its room on short screens. */}
          <div className="mt-3 text-xs text-slate-500">เพิ่มตัวจำลอง</div>
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            <button className="app-button flex-col !gap-0.5 !px-1 !py-1.5 !text-[11px] !leading-tight" disabled={!writable} onClick={onInsertGit} aria-label="เพิ่มตัวจำลอง Git" title="เพิ่มตัวจำลอง Git: เครื่อง A ↔ GitHub ↔ เครื่อง B กลางจอ"><GitBranch size={16} />Git</button>
            <button className="app-button flex-col !gap-0.5 !px-1 !py-1.5 !text-[11px] !leading-tight" disabled={!writable} onClick={onInsertData} aria-label="เพิ่มตัวจำลองข้อมูล" title="เพิ่มตัวจำลองการเก็บข้อมูล (ร้านกาแฟ) กลางจอ"><Database size={16} />ข้อมูล</button>
            <button className="app-button flex-col !gap-0.5 !px-1 !py-1.5 !text-[11px] !leading-tight" disabled={!writable} onClick={onInsertDeploy} aria-label="เพิ่มตัวจำลอง Deploy" title="เพิ่มตัวจำลองการ Deploy (Local → Vercel) กลางจอ"><Rocket size={16} />Deploy</button>
            <button className="app-button flex-col !gap-0.5 !px-1 !py-1.5 !text-[11px] !leading-tight" disabled={!writable} onClick={onInsertAi} aria-label="เพิ่มตัวจำลอง AI" title="เพิ่มตัวจำลอง AI: ประวัติแชท, คิดก่อนตอบ, Memory, Claude Code กลางจอ"><Bot size={16} />AI</button>
          </div></div>
        <div className="flex items-center justify-between px-3 pb-2 pt-4"><h2 className="text-sm font-semibold">สไลด์ <span className="muted font-normal">{slides.length}</span></h2><button className="app-button icon-button" aria-label="เพิ่มสไลด์" title="เพิ่มสไลด์" disabled={!writable} onClick={onAddSlide}><Plus size={17} /></button></div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" aria-label="รายการสไลด์">{slides.map((item, index) => <li key={item.id}><button aria-current={item.id === activeSlideId ? "true" : undefined} onClick={() => onSwitchSlide(item.id)}
          draggable={writable} onDragStart={(event) => { setDragging(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
          onDragOver={(event) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={(event) => { event.preventDefault(); dropOn(item.id); setDragging(null); }} onDragEnd={() => setDragging(null)}
          title="คลิกเพื่อเปิด · ลากเพื่อจัดลำดับ" className={`flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm ${item.id === activeSlideId ? "bg-slate-900 font-semibold text-white" : "hover:bg-slate-100"} ${dragging === item.id ? "opacity-50" : ""}`}><span className="shrink-0 text-xs opacity-60">{String(index + 1).padStart(2, "0")}</span><span className="truncate">{item.name}</span></button></li>)}</ul>
        <div className="grid grid-cols-4 gap-1 border-t border-slate-200 p-2"><button className="app-button icon-button" title="เปลี่ยนชื่อสไลด์" aria-label="เปลี่ยนชื่อสไลด์" disabled={!writable} onClick={onRenameSlide}><PenLine size={15} /></button><button className="app-button icon-button" title="ทำสำเนาสไลด์" aria-label="ทำสำเนาสไลด์" disabled={!writable} onClick={onCopySlide}><Copy size={15} /></button><button className="app-button icon-button" title="เลื่อนสไลด์ขึ้น" aria-label="เลื่อนสไลด์ขึ้น" disabled={!writable || activeIndex <= 0} onClick={() => onMoveSlide(-1)}><ChevronUp size={17} /></button><button className="app-button icon-button" title="เลื่อนสไลด์ลง" aria-label="เลื่อนสไลด์ลง" disabled={!writable || activeIndex >= slides.length - 1} onClick={() => onMoveSlide(1)}><ChevronDown size={17} /></button><button className="app-button col-span-4 !border-red-200 !text-red-700" disabled={!writable || slides.length <= 1} title={slides.length <= 1 ? "ลบไม่ได้: บทเรียนต้องมีอย่างน้อยหนึ่งสไลด์" : "ลบสไลด์นี้ (เลิกทำได้)"} aria-describedby={slides.length <= 1 ? "delete-slide-reason" : undefined} onClick={onDeleteSlide}><Trash2 size={15} /> ลบสไลด์</button>{slides.length <= 1 && <p id="delete-slide-reason" className="col-span-4 px-1 text-xs muted">ต้องมีอย่างน้อยหนึ่งสไลด์ จึงลบสไลด์สุดท้ายไม่ได้</p>}</div>
      </>}
    </aside>
    {!collapsed && !overlay && <div role="separator" aria-label="ปรับความกว้างแถบซ้าย" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0} className="group absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize touch-none outline-none" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={(event) => endResize(event)} onPointerCancel={(event) => endResize(event, true)} onLostPointerCapture={(event) => endResize(event, true)} onKeyDown={separatorKey}><div className="mx-auto h-full w-px bg-transparent group-hover:bg-blue-500 group-focus:bg-blue-500" /></div>}
  </div>;
}
