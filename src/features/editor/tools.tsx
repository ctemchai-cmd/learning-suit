import { ArrowUpRight, Circle, Crosshair, Eraser, Hand, Highlighter, ImagePlus, MousePointer2, PenLine, Shapes, Slash, Square, Table, Type } from "lucide-react";
import type { EditorTool } from "./store";

export type ToolItem = { id: EditorTool; label: string; key: string; icon: React.ReactNode };

export const TOOL_ITEMS: ToolItem[] = [
  { id: "select", label: "เลือก", key: "V", icon: <MousePointer2 size={18} /> },
  { id: "hand", label: "เลื่อนกระดาน", key: "H", icon: <Hand size={18} /> },
  { id: "pen", label: "ปากกา", key: "P", icon: <PenLine size={18} /> },
  { id: "highlighter", label: "ไฮไลต์", key: "⇧P", icon: <Highlighter size={18} /> },
  { id: "eraser", label: "ยางลบ", key: "E", icon: <Eraser size={18} /> },
  { id: "rectangle", label: "สี่เหลี่ยม", key: "R", icon: <Square size={18} /> },
  { id: "ellipse", label: "วงกลม", key: "O", icon: <Circle size={18} /> },
  { id: "line", label: "เส้น", key: "L", icon: <Slash size={18} /> },
  { id: "arrow", label: "ลูกศร", key: "A", icon: <ArrowUpRight size={18} /> },
  { id: "text", label: "ข้อความ", key: "T", icon: <Type size={18} /> },
  { id: "laser", label: "เลเซอร์พอยเตอร์", key: "K", icon: <Crosshair size={18} /> },
  { id: "image", label: "รูปภาพ", key: "", icon: <ImagePlus size={18} /> },
  { id: "stencil", label: "ภาพประกอบ (มือถือ, Browser, ไอคอน)", key: "I", icon: <Shapes size={18} /> },
  { id: "table", label: "ตาราง", key: "", icon: <Table size={18} /> },
];

/** Image, stencil and table entries act once (file picker / picture picker / new table) instead of becoming a canvas mode. */
export const isActionTool = (id: EditorTool) => id === "image" || id === "stencil" || id === "table";

export const DEFAULT_FAVORITES: EditorTool[] = ["select", "pen", "rectangle", "ellipse", "arrow", "text"];
