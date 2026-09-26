"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AppWindow, Bot, Cloud, CodeXml, Database, FileCode2, FileText, Folder, GitBranch, Globe, KeyRound, Laptop, Lock, Monitor,
  PanelTop, Server, Smartphone, SquareCode, SquareTerminal, Table, User, Users, Webhook, X, type LucideIcon,
} from "lucide-react";
import type { StencilKind } from "@/domain/document/model";
import { STENCILS, type StencilSpec } from "@/domain/document/stencils";

/** Icon of each stencil in DOM lists (picker, Objects panel); the board draws the same Lucide shapes. */
export const STENCIL_DOM_ICON: Record<StencilKind, LucideIcon> = {
  browser: AppWindow, phone: Smartphone, laptop: Laptop, window: PanelTop, terminal: SquareTerminal, editor: FileCode2,
  server: Server, database: Database, cloud: Cloud, internet: Globe, user: User, users: Users, computer: Monitor, mobile: Smartphone,
  file: FileText, folder: Folder, code: CodeXml, git: GitBranch, lock: Lock, key: KeyRound, ai: Bot, api: Webhook,
};

function Item({ spec, onPick }: { spec: StencilSpec; onPick: (spec: StencilSpec) => void }) {
  const Icon = STENCIL_DOM_ICON[spec.kind];
  return <button type="button" onClick={() => onPick(spec)}
    className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-center !text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500">
    <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg" style={{ color: spec.color, background: `${spec.color}1A` }}><Icon size={20} /></span>
    <span className="leading-tight">{spec.name}</span>
  </button>;
}

/** Picker of ready-made pictures: a click places the picture in the middle of the view (plan 03 §stencils). */
export default function StencilPicker({ open, onOpenChange, onPick, onPickTable, onPickCode }: {
  open: boolean; onOpenChange: (open: boolean) => void; onPick: (spec: StencilSpec) => void; onPickTable: (variant: "grid" | "class") => void; onPickCode: () => void;
}) {
  const frames = STENCILS.filter((item) => item.family === "frame");
  const icons = STENCILS.filter((item) => item.family === "icon");
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content !w-[min(600px,calc(100vw-2rem))]"
      // The new object may open its own editor (a table cell): do not pull focus back to the button.
      onCloseAutoFocus={(event) => event.preventDefault()}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Dialog.Title className="text-xl font-semibold">ภาพประกอบ</Dialog.Title>
          <Dialog.Description className="muted mt-1 text-sm">คลิกเพื่อวางกลางจอ แล้วลากย้าย/ปรับขนาดได้ · แก้ข้อความและสีที่แผง Properties</Dialog.Description>
        </div>
        <Dialog.Close className="app-button icon-button shrink-0" aria-label="ปิด"><X size={16} /></Dialog.Close>
      </div>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">อุปกรณ์และหน้าต่าง</h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{frames.map((spec) => <Item key={spec.kind} spec={spec} onPick={onPick} />)}</div>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">ตาราง โค้ด และ Diagram</h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {([["grid", "ตาราง", Table, "#334155"], ["class", "กล่องคลาส / ตารางฐานข้อมูล", PanelTop, "#2563EB"], ["code", "บล็อกโค้ด", SquareCode, "#7C3AED"]] as const).map(([variant, name, Icon, color]) =>
          <button key={variant} type="button" onClick={() => (variant === "code" ? onPickCode() : onPickTable(variant))}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-center !text-xs text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-lg" style={{ color, background: `${color}1A` }}><Icon size={20} /></span>
            <span className="leading-tight">{name}</span>
          </button>)}
      </div>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">ไอคอน</h3>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">{icons.map((spec) => <Item key={spec.kind} spec={spec} onPick={onPick} />)}</div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
