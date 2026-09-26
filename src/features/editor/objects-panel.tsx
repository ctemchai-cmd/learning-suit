"use client";

import { useState } from "react";
import { ArrowUpRight, Bot, PanelTop, SquareCode, Table, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Circle, Database, GitBranch, Rocket, Highlighter, Image as ImageIcon, Lock, PenLine, Slash, Square, Type, Unlock } from "lucide-react";
import type { CanvasNode, SlideDocument } from "@/domain/document/model";
import type { DocumentTransaction } from "@/domain/document/commands";
import { hasZOrderChange, type ZOrderAction } from "@/domain/document/z-order";
import { stencilSpec } from "@/domain/document/stencils";
import { STENCIL_DOM_ICON } from "./stencil-picker";
import { CODE_LABEL } from "@/domain/document/code";

export function nodeLabel(node: CanvasNode): string {
  if (node.type === "text") return `text: ${[...(node.text.split("\n")[0] ?? "")].slice(0, 28).join("")}`;
  if (node.type === "git-simulator") return "git-simulator";
  if (node.type === "data-simulator") return "data-simulator";
  if (node.type === "deploy-simulator") return "deploy-simulator";
  if (node.type === "ai-simulator") return "ai-simulator";
  if (node.type === "code") return `โค้ด ${CODE_LABEL[node.language]}: ${[...(node.code.split("\n").find((line) => line.trim()) ?? "").trim()].slice(0, 28).join("")}`;
  if (node.type === "table") return `${node.variant === "class" ? "กล่องคลาส" : "ตาราง"}: ${[...(node.rows[0]?.cells.join(" · ") ?? "")].slice(0, 28).join("")}`;
  if (node.type === "stencil") return `${stencilSpec(node.kind).name}${node.label && node.label !== stencilSpec(node.kind).name ? `: ${node.label}` : ""}`;
  return node.type;
}
function NodeIcon({ node }: { node: CanvasNode }) {
  const props = { size: 15, className: "muted shrink-0", "aria-hidden": true } as const;
  switch (node.type) {
    case "rectangle": return <Square {...props} />;
    case "ellipse": return <Circle {...props} />;
    case "line": return <Slash {...props} />;
    case "arrow": return <ArrowUpRight {...props} />;
    case "pen": return <PenLine {...props} />;
    case "highlighter": return <Highlighter {...props} />;
    case "text": return <Type {...props} />;
    case "image": return <ImageIcon {...props} />;
    case "code": return <SquareCode {...props} />;
    case "table": return node.variant === "class" ? <PanelTop {...props} /> : <Table {...props} />;
    case "stencil": { const Icon = STENCIL_DOM_ICON[node.kind]; return <Icon {...props} />; }
    case "git-simulator": return <GitBranch {...props} />;
    case "data-simulator": return <Database {...props} />;
    case "deploy-simulator": return <Rocket {...props} />;
    case "ai-simulator": return <Bot {...props} />;
  }
}

/** Front-to-back object list with lock toggles; the only way to unlock (plan03 §4). */
export default function ObjectsPanel({ slide, selectedIds, setSelectedIds, writable, transact, onReorder }: {
  slide: SlideDocument | undefined;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  writable: boolean;
  transact: (transaction: DocumentTransaction) => boolean;
  onReorder: (action: ZOrderAction) => void;
}) {
  const [filter, setFilter] = useState<"all" | "locked">("all");
  const nodes = [...(slide?.nodes ?? [])].reverse().filter((node) => filter === "all" || node.locked);
  return <div className="p-3">
    <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="กรองวัตถุ">
      <button className={`flex-1 rounded-md px-2 py-1.5 text-xs ${filter === "all" ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>ทั้งหมด</button>
      <button className={`flex-1 rounded-md px-2 py-1.5 text-xs ${filter === "locked" ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`} aria-pressed={filter === "locked"} onClick={() => setFilter("locked")}>ล็อกอยู่</button>
    </div>
    <div className="mb-3 grid grid-cols-4 gap-1" role="group" aria-label="จัดลำดับวัตถุ">
      {([
        { action: "front", label: "นำขึ้นบนสุด", hint: "⌘⇧]", icon: <ChevronsUp size={16} /> },
        { action: "forward", label: "ย้ายขึ้นหนึ่งชั้น", hint: "⌘]", icon: <ChevronUp size={16} /> },
        { action: "backward", label: "ย้ายลงหนึ่งชั้น", hint: "⌘[", icon: <ChevronDown size={16} /> },
        { action: "back", label: "ส่งลงล่างสุด", hint: "⌘⇧[", icon: <ChevronsDown size={16} /> },
      ] as const).map((item) => {
        const enabled = writable && Boolean(slide) && hasZOrderChange(slide!.nodes, selectedIds, item.action);
        return <button key={item.action} className="app-button icon-button !h-8 !w-full" aria-label={item.label}
          title={enabled ? `${item.label} (${item.hint})` : `${item.label}: เลือกวัตถุที่ยังเลื่อนชั้นได้ก่อน`}
          disabled={!enabled} onClick={() => onReorder(item.action)}>{item.icon}</button>;
      })}
    </div>
    <div className="space-y-1">
      {nodes.map((node) => {
        const label = nodeLabel(node);
        return <div key={node.id} className={`flex items-center gap-1 rounded-lg border p-1 ${selectedIds.includes(node.id) ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
          <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left text-sm enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`เลือกวัตถุ ${label}`} aria-pressed={selectedIds.includes(node.id)}
            title={node.locked ? "ปลดล็อกก่อนเลือกวัตถุ" : "คลิกเพื่อเลือก · Shift+คลิกเพื่อเลือกเพิ่ม"} disabled={node.locked}
            onClick={(event) => setSelectedIds(event.shiftKey ? selectedIds.includes(node.id) ? selectedIds.filter((id) => id !== node.id) : [...selectedIds, node.id] : [node.id])}>
            <NodeIcon node={node} /><span className="truncate">{label}</span>
            {node.groupId && <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 text-[10px] text-slate-500" title="อยู่ในกลุ่ม (คลิกขวา → แยกกลุ่ม)">กลุ่ม</span>}
          </button>
          <button className="app-button icon-button !h-7 !w-7 shrink-0" title={node.locked ? "ปลดล็อก" : "ล็อก"} aria-label={node.locked ? `ปลดล็อก ${label}` : `ล็อก ${label}`} disabled={!writable}
            onClick={() => {
              if (!slide) return;
              if (transact({ label: node.locked ? "ปลดล็อกวัตถุ" : "ล็อกวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.lock", slideId: slide.id, ids: [node.id], locked: !node.locked }] }) && !node.locked) {
                setSelectedIds(selectedIds.filter((id) => id !== node.id));
              }
            }}>{node.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
        </div>;
      })}
      {!nodes.length && <p className="muted p-2 text-sm">{filter === "locked" ? "ไม่มีวัตถุที่ล็อก" : "ยังไม่มีวัตถุบนสไลด์"}</p>}
    </div>
  </div>;
}
