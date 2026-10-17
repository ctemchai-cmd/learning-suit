"use client";

import type { JSX, ReactNode } from "react";
import { Ellipse, Group, Line, Rect } from "react-konva";
import type { DataSimulatorNode } from "@/domain/document/model";
import type { ComputerId, DataState, DataView, Mark, MarkTone } from "@/domain/data/model";
import { COMPUTER_USER } from "@/domain/data/model";
import { categoryName, formatBaht, KIND_LABEL, signedAmount, STORAGE_LABEL, userName } from "@/domain/data/reducer";
import { partFilter } from "@/domain/document/reveal";
import { AppSpinner, CaptionBar, Gate, IconLabel, Label, MARK_STYLE, Monitor, Packet, Pipe, type Pt } from "@/features/flow/flow-bits";
import { waitingAt, type FlowPlay, type Waiting } from "@/features/flow/flow-session";
import { monitorScreen } from "@/features/flow/monitor";
import { useFlowPlayback } from "@/features/flow/use-flow-playback";
import {
  ACCESS, CAPTION_BOX, DATA_H, DATA_VIEWS, DATA_W, dataParts, dataPartsOfFrames, hopPath, pipesOf, RELATION, TABLE, tableRowY, WHERE,
  type Box, type TableBox,
} from "./data-layout";

// Canvas rendering of the data-storage simulator (plan 07 §3). Draw inside a Group already translated to
// node.x/node.y. Deterministic for export: without a play it draws the stored state only.

const C = {
  frame: "#FFFFFF", frameStroke: "#CBD5E1", card: "#FFFFFF", cardStroke: "#E2E8F0", title: "#0F172A", text: "#1E293B", muted: "#64748B",
  screen: "#F8FAFC", db: "#F5F3FF", dbStroke: "#C4B5FD", supabase: "#047857", supabaseFill: "#ECFDF5", income: "#15803D", expense: "#B91C1C",
};
const OWNER_COLOR: Record<number, string> = { 1: "#2563EB", 2: "#EA580C" };
const IDLE: Record<DataView, string> = {
  where: "กดปุ่มในแผงขวา: ให้คอม A (ที่ทำงาน) บันทึกรายการ แล้วลองรีเฟรช และเปิดดูจากคอม B (ที่บ้าน)",
  table: "ลองเพิ่ม / ดู / แก้ / ลบ หมวด แล้วดูว่าข้อมูลวิ่งไปถึงแถวไหน",
  relation: "ลองเปลี่ยนชื่อหมวด แล้วเทียบสองวิธีเก็บ",
  access: "ให้คอมของ A หรือ B ขอดูรายรับรายจ่าย แล้วลองปิดกฎสิทธิ์",
};
/** Income green, expense red: for a screen line (“… +25,000 บาท”, “… (รายจ่าย)”) and for a table amount. */
function lineColor(line: string): string | undefined {
  if (/ \+[\d,]+ บาท$/.test(line) || line.includes(`(${KIND_LABEL.income}`)) return C.income;
  if (/ -[\d,]+ บาท$/.test(line) || line.includes(`(${KIND_LABEL.expense}`)) return C.expense;
  return undefined;
}

type Marks = Map<string, Pick<Mark, "tone" | "note">>;
const markOf = (marks: Marks, spot: string) => marks.get(spot)?.tone;

function Card({ box, title, sub, fill = C.card, stroke = C.cardStroke, font, children }: { box: Box; title?: string; sub?: string; fill?: string; stroke?: string; font: string; children?: ReactNode }) {
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={14} fill={fill} stroke={stroke} strokeWidth={1.5} />
    {title && <Label x={box.x + 16} y={box.y + 12} width={box.w - 32} text={title} size={18} bold color={C.title} font={font} />}
    {sub && <Label x={box.x + 16} y={box.y + 36} width={box.w - 32} text={sub} size={12} color={C.muted} font={font} />}
    {children}
  </Group>;
}

function Tag({ x, y, text, font, width }: { x: number; y: number; text: string; font: string; width?: number }) {
  const w = width ?? Math.min(240, [...text].length * 7.4 + 18);
  return <Group x={x} y={y} listening={false}>
    <Rect width={w} height={22} cornerRadius={11} fill={C.supabaseFill} stroke="#A7F3D0" />
    <Label x={0} y={0} width={w} text={text} size={11} bold color={C.supabase} align="center" font={font} lineHeight={22} />
  </Group>;
}

/** A computer: desktop monitor whose screen shows the app's last answer (title + one row per line). */
function Computer({ frame, label, title, lines, empty, font, highlight, waiting, lineH = 26 }: {
  frame: Box; label: string; title: string; lines: string[]; empty: string; font: string; highlight?: MarkTone; waiting?: Waiting | null; lineH?: number;
}) {
  const screen = monitorScreen(frame);
  const style = highlight ? MARK_STYLE[highlight] : null;
  const top = 36;
  // When the list does not fit, the last slot says how many more there are.
  const slots = Math.max(1, Math.floor((screen.h - top - 4) / lineH));
  const shown = lines.length > slots ? lines.slice(0, slots - 1) : lines;
  return <Group listening={false}>
    <Monitor frame={frame} label={label} font={font} />
    <Rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} cornerRadius={4} fill={style?.fill ?? C.screen} stroke={style?.stroke} strokeWidth={style ? 2.5 : 0} />
    <Label x={screen.x + 12} y={screen.y + 8} width={screen.w - 24} text={title} size={15} bold color={C.title} font={font} />
    {lines.length === 0
      ? <Label x={screen.x + 12} y={screen.y + top + 8} width={screen.w - 24} text={empty} size={14} color={C.muted} font={font} />
      : shown.map((line, index) => {
        // “⚠ …” marks someone else's transaction that leaked through: drawn with a warning icon.
        const leaked = line.startsWith("⚠");
        const y = screen.y + top + index * lineH;
        return <Group key={index}>
          <Rect x={screen.x + 8} y={y} width={screen.w - 16} height={lineH - 4} cornerRadius={6} fill={leaked ? "#FEE2E2" : "#FFFFFF"} stroke={leaked ? "#FCA5A5" : "#E2E8F0"} />
          {leaked
            ? <IconLabel x={screen.x + 14} y={y} width={screen.w - 26} icon="alert" text={line.replace(/^⚠\s*/u, "")} size={12} color="#991B1B" font={font} lineHeight={lineH - 4} />
            : <Label x={screen.x + 16} y={y} width={screen.w - 32} text={line} size={13} color={lineColor(line) ?? C.text} font={font} lineHeight={lineH - 4} />}
        </Group>;
      })}
    {lines.length > slots && <Label x={screen.x + 12} y={screen.y + top + (slots - 1) * lineH} width={screen.w - 24} text={`… อีก ${lines.length - slots + 1} รายการ`} size={12} color={C.muted} font={font} lineHeight={lineH - 4} />}
    {waiting && <AppSpinner box={{ x: screen.x, y: screen.y + 32, w: screen.w, h: screen.h - 32 }} kind={waiting} font={font} />}
  </Group>;
}

/** Wrapped row of small item chips (layout computed first, then drawn). */
function chipLayout(box: Box, items: string[]): { item: string; x: number; y: number; w: number }[] {
  const placed: { item: string; x: number; y: number; w: number }[] = [];
  let x = box.x + 10, y = box.y + 46;
  for (const item of items) {
    // Thai vowel/tone marks sit on the previous letter: they take no width.
    const w = Math.min(box.w - 20, [...item.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/gu, "")].length * 8.4 + 22);
    if (x + w > box.x + box.w - 10) { x = box.x + 10; y += 28; }
    placed.push({ item, x, y, w });
    x += w + 6;
  }
  return placed;
}
function Chips({ box, items, font }: { box: Box; items: string[]; font: string }) {
  // Chips that would run past the bottom of the zone are replaced by a count.
  const placed = chipLayout(box, items);
  const fits = placed.filter(({ y }) => y + 24 <= box.y + box.h - 6);
  const hidden = placed.length - fits.length;
  const shown = hidden ? fits.slice(0, Math.max(0, fits.length - 1)) : fits;
  const more = hidden ? placed.length - shown.length : 0;
  return <Group listening={false}>
    {shown.map(({ item, x, y, w }, index) => <Group key={index} x={x} y={y}>
      <Rect width={w} height={24} cornerRadius={12} fill="#EFF6FF" stroke="#93C5FD" />
      <Label x={0} y={0} width={w} text={item} size={12} bold color="#1D4ED8" align="center" font={font} lineHeight={24} />
    </Group>)}
    {more > 0 && fits.length > 0 && <Label x={fits[Math.max(0, fits.length - 1)].x} y={fits[Math.max(0, fits.length - 1)].y} width={box.w - 20} text={`… อีก ${more} รายการ`} size={12} color={C.muted} font={font} lineHeight={24} />}
  </Group>;
}

function Zone({ box, title, sub, items, active, mark, font }: { box: Box; title: string; sub: string; items: string[]; active: boolean; mark?: MarkTone; font: string }) {
  const style = mark ? MARK_STYLE[mark] : null;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={12} fill={style?.fill ?? "#FFFFFF"}
      stroke={style?.stroke ?? (active ? "#2563EB" : "#CBD5E1")} strokeWidth={active || style ? 2.5 : 1} dash={active || style ? undefined : [6, 5]} />
    <Label x={box.x + 10} y={box.y + 8} width={box.w - 20 - (active ? 92 : 0)} text={title} size={14} bold color={C.title} font={font} />
    <Label x={box.x + 10} y={box.y + 28} width={box.w - 20} text={sub} size={11} color={C.muted} font={font} />
    {active && <Group x={box.x + box.w - 92} y={box.y + 6}>
      <Rect width={84} height={20} cornerRadius={10} fill="#2563EB" />
      <Label x={0} y={0} width={84} text="แอปเก็บที่นี่" size={10} bold color="#FFFFFF" align="center" font={font} lineHeight={20} />
    </Group>}
    <Chips box={box} items={items} font={font} />
  </Group>;
}

function Cylinder({ box, title, font, mark, children }: { box: Box; title: string; font: string; mark?: MarkTone; children?: ReactNode }) {
  const style = mark ? MARK_STYLE[mark] : null;
  const rx = box.w / 2, ry = 26;
  const cx = box.x + rx;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y + ry} width={box.w} height={box.h - 2 * ry} fill={style?.fill ?? C.db} stroke={style?.stroke ?? C.dbStroke} strokeWidth={style ? 3 : 2} />
    <Ellipse x={cx} y={box.y + box.h - ry} radiusX={rx} radiusY={ry} fill={style?.fill ?? C.db} stroke={style?.stroke ?? C.dbStroke} strokeWidth={style ? 3 : 2} />
    <Rect x={box.x + 1.5} y={box.y + box.h - 2 * ry - 2} width={box.w - 3} height={ry + 2} fill={style?.fill ?? C.db} />
    <Ellipse x={cx} y={box.y + ry} radiusX={rx} radiusY={ry} fill="#EDE9FE" stroke={style?.stroke ?? C.dbStroke} strokeWidth={style ? 3 : 2} />
    <Label x={box.x + 10} y={box.y + ry + 36} width={box.w - 20} text={title} size={18} bold color={C.title} align="center" font={font} />
    {children}
  </Group>;
}

type Cell = { text: string; color?: string; bold?: boolean; tone?: MarkTone };
function TableGrid({ table, rows, cell, marks, spotPrefix, title, badge, font }: {
  table: TableBox; rows: { id: number }[]; cell: (row: { id: number }, key: string) => Cell; marks: Marks; spotPrefix: string;
  title?: string; badge?: ReactNode; font: string;
}) {
  const { box, titleH, headerH, rowH, columns, maxRows } = table;
  const top = box.y + titleH;
  const shown = rows.slice(0, maxRows);
  return <Group listening={false}>
    {title && <Label x={box.x} y={box.y + 2} width={box.w - 120} text={title} size={14} bold color={C.title} font={font} />}
    {badge}
    <Rect x={box.x} y={top} width={box.w} height={headerH + Math.max(1, shown.length) * rowH} cornerRadius={8} fill="#FFFFFF" stroke={C.cardStroke} />
    <Rect x={box.x} y={top} width={box.w} height={headerH} cornerRadius={[8, 8, 0, 0]} fill="#F1F5F9" />
    {columns.map((column) => <Group key={column.key}>
      <Label x={column.x + 8} y={top + (column.type ? 6 : 0)} width={column.w - 16} text={column.label} size={13} bold color={C.title} font={font} lineHeight={column.type ? undefined : headerH} />
      {column.type && <Label x={column.x + 8} y={top + 26} width={column.w - 16} text={column.type} size={11} color="#7C3AED" font={font} />}
    </Group>)}
    {shown.length === 0 && <Label x={box.x + 10} y={top + headerH} width={box.w - 20} text="(ว่าง)" size={13} color={C.muted} font={font} lineHeight={rowH} />}
    {shown.map((row, index) => {
      const y = top + headerH + index * rowH;
      const rowTone = markOf(marks, `${spotPrefix}row:${tableKey(table)}:${row.id}`);
      const style = rowTone ? MARK_STYLE[rowTone] : null;
      return <Group key={row.id}>
        {index > 0 && <Line points={[box.x, y, box.x + box.w, y]} stroke="#F1F5F9" strokeWidth={1} />}
        {style && <Rect x={box.x + 2} y={y + 1} width={box.w - 4} height={rowH - 2} cornerRadius={6} fill={style.fill} stroke={style.stroke} strokeWidth={2}
          opacity={rowTone === "removed" ? 0.8 : 1} dash={rowTone === "removed" ? [6, 4] : undefined} />}
        {columns.map((column) => {
          const value = cell(row, column.key);
          const cellTone = value.tone ?? markOf(marks, `${spotPrefix}cell:${tableKey(table)}:${row.id}:${column.key === "copiedName" ? "name" : column.key}`);
          const cellStyle = cellTone ? MARK_STYLE[cellTone] : null;
          return <Group key={column.key}>
            {cellStyle && <Rect x={column.x + 3} y={y + 3} width={column.w - 6} height={rowH - 6} cornerRadius={5} fill={cellStyle.fill} stroke={cellStyle.stroke} strokeWidth={2} />}
            <Label x={column.x + 8} y={y} width={column.w - 16} text={value.text} size={rowH >= 30 ? 15 : 13} bold={value.bold}
              color={cellStyle?.text ?? value.color ?? (rowTone === "removed" ? C.muted : C.text)} font={font} lineHeight={rowH} />
          </Group>;
        })}
      </Group>;
    })}
    {rows.length > maxRows && <Label x={box.x + 8} y={top + headerH + shown.length * rowH + 4} width={box.w - 16} text={`… อีก ${rows.length - maxRows} แถว`} size={12} color={C.muted} font={font} />}
  </Group>;
}
// Spot names use the table's data key (categories/transactions).
function tableKey(table: TableBox): string {
  if (table === TABLE.categories || table === ACCESS.categories || table === RELATION.copyCategories || table === RELATION.linkCategories) return "categories";
  return "transactions";
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Shows = (partId: string) => boolean;

function WhereStep({ state, marks, waiting, font, shows }: { state: DataState; marks: Marks; waiting: (spot: string) => Waiting | null; font: string; shows: Shows }) {
  const { storage } = state;
  const computer = (id: ComputerId) => {
    const p = WHERE[id];
    const busy = waiting(`pc${id}`);
    const lineH = 26;
    const max = Math.max(1, Math.floor((p.screen.h - 12) / lineH));
    const lines = storage.screen[id];
    // Reveal parts: computer A shows its memory and its own storage as parts of their own; computer B is one part.
    const own = `pc${id}`, memory = id === "A" ? "memA" : own, device = id === "A" ? "devA" : own;
    return <Group key={id}>
      {shows(own) && <>
      <Monitor frame={p.frame} label={`คอม ${id}`} font={font} />
      {/* The app window fills the screen: title bar, transaction list and — inside it — the app's memory. */}
      <Rect x={p.app.x} y={p.app.y} width={p.app.w} height={p.app.h} cornerRadius={4} fill={C.screen} />
      <Rect x={p.app.x} y={p.app.y} width={p.app.w} height={30} cornerRadius={[4, 4, 0, 0]} fill="#E2E8F0" />
      <IconLabel x={p.app.x + 12} y={p.app.y} width={p.app.w - 50} icon="wallet" text="แอปรายรับรายจ่าย" size={13} bold color={C.title} font={font} lineHeight={30} />
      <Label x={p.app.x + p.app.w - 36} y={p.app.y} width={24} text="↻" size={16} bold color={busy === "refresh" ? "#2563EB" : "#64748B"} align="center" font={font} lineHeight={30} />
      {lines.length === 0
        ? <Label x={p.screen.x + 12} y={p.screen.y + 4} width={p.screen.w - 24} text={id === "A" ? "ยังไม่มีรายการ" : "ยังไม่ได้เปิดดู"} size={14} color={C.muted} font={font} />
        : lines.slice(0, max).map((line, index) => <Group key={index}>
          <Rect x={p.screen.x + 8} y={p.screen.y + 2 + index * lineH} width={p.screen.w - 16} height={lineH - 4} cornerRadius={6} fill="#FFFFFF" stroke="#E2E8F0" />
          <IconLabel x={p.screen.x + 16} y={p.screen.y + 2 + index * lineH} width={p.screen.w - 32} icon="wallet" text={line} size={13} color={C.text} iconColor="#0F766E" font={font} lineHeight={lineH - 4} />
        </Group>)}
      {busy && <AppSpinner box={{ x: p.app.x, y: p.screen.y, w: p.app.w, h: p.screen.h }} kind={busy} font={font} />}
      </>}
      {shows(memory) && <Zone box={p.memory} title="ความจำของแอป" sub="อยู่ในแอป: หายเมื่อรีเฟรชหรือปิดแอป" items={storage.memory[id]} active={id === "A" && storage.mode === "app"} mark={markOf(marks, `mem${id}`)} font={font} />}
      {shows(device) && <Zone box={p.device} title={`เก็บในเครื่อง ${id}`} sub="นอกแอป: อยู่ต่อหลังรีเฟรช แต่มีแค่คอมเครื่องนี้" items={storage.device[id]} active={id === "A" && storage.mode === "device"} mark={markOf(marks, `dev${id}`)} font={font} />}
    </Group>;
  };
  const cloud = WHERE.cloud;
  const cloudActive = storage.mode === "cloud";
  return <Group listening={false}>
    {computer("A")}{computer("B")}
    {shows("cloud") && <>
    <Cylinder box={cloud} title="ฐานข้อมูล (Cloud)" mark={markOf(marks, "cloud")} font={font}>
      <Tag x={cloud.x + cloud.w / 2 - 52} y={cloud.y + 92} text="Supabase" width={104} font={font} />
      {cloudActive && <Group x={cloud.x + cloud.w / 2 - 50} y={cloud.y + 122}>
        <Rect width={100} height={22} cornerRadius={11} fill="#2563EB" />
        <Label x={0} y={0} width={100} text="แอปเก็บที่นี่" size={11} bold color="#FFFFFF" align="center" font={font} lineHeight={22} />
      </Group>}
      {storage.cloud.length === 0
        ? <Label x={cloud.x + 20} y={cloud.y + 170} width={cloud.w - 40} text="ยังไม่มีข้อมูล" size={14} color={C.muted} align="center" font={font} />
        : storage.cloud.slice(0, 6).map((item, index) => <Group key={index}>
          <Rect x={cloud.x + 30} y={cloud.y + 156 + index * 26} width={cloud.w - 60} height={22} cornerRadius={6} fill="#FFFFFF" stroke={C.dbStroke} />
          <Label x={cloud.x + 40} y={cloud.y + 156 + index * 26} width={cloud.w - 80} text={`${index + 1}. ${item}`} size={13} color={C.text} font={font} lineHeight={22} />
        </Group>)}
    </Cylinder>
    <Group x={cloud.x - 20} y={cloud.y + cloud.h + 24}>
      <Rect width={cloud.w + 40} height={64} cornerRadius={14} fill="#F8FAFC" stroke={C.cardStroke} />
      <Label x={12} y={10} width={cloud.w + 16} text="แอปบนคอม A ตอนนี้" size={12} color={C.muted} align="center" font={font} />
      <Label x={12} y={30} width={cloud.w + 16} text={STORAGE_LABEL[storage.mode]} size={20} bold color="#1D4ED8" align="center" font={font} />
    </Group>
    </>}
  </Group>;
}

function TableStep({ state, marks, gateTone, waiting, font, shows }: { state: DataState; marks: Marks; gateTone: "idle" | "ok" | "blocked"; waiting: (spot: string) => Waiting | null; font: string; shows: Shows }) {
  const note = marks.get("gate")?.note;
  return <Group listening={false}>
    {shows("pc") && <Computer frame={TABLE.pc.frame} label="คอม A" title={state.screens.A.title || "คอม A · แอปรายรับรายจ่าย"} lines={state.screens.A.lines} empty="ผลจากฐานข้อมูลจะขึ้นที่นี่" waiting={waiting("pcA")} font={font} />}
    {shows("gate") && <Gate at={TABLE.gate} label="ตรวจชนิดข้อมูล" sub={gateTone === "blocked" && note ? "✗ ไม่ผ่าน" : undefined} tone={gateTone} font={font} />}
    {shows("db") && <Card box={TABLE.db} title="ฐานข้อมูล · ตาราง “หมวด”" fill={C.db} stroke={C.dbStroke} font={font}>
      <Tag x={TABLE.db.x + TABLE.db.w - 196} y={TABLE.db.y + 12} text="Supabase: Table Editor" width={180} font={font} />
    </Card>}
    {shows("categories") && <TableGrid table={TABLE.categories} rows={state.categories} marks={marks} spotPrefix="" font={font}
      cell={(row, key) => {
        const item = state.categories.find((entry) => entry.id === row.id)!;
        if (key === "id") return { text: String(item.id), color: C.muted, bold: true };
        if (key === "name") return { text: item.name };
        if (key === "kind") return { text: KIND_LABEL[item.kind], color: item.kind === "income" ? C.income : C.expense };
        return { text: item.active ? "ใช่" : "ไม่ใช่", color: item.active ? C.income : C.expense };
      }} />}
  </Group>;
}

function RelationStep({ state, marks, font, shows }: { state: DataState; marks: Marks; font: string; shows: Shows }) {
  const nameOf = (id: number) => categoryName(state, id);
  const categoryCell = (row: { id: number }, key: string): Cell => {
    const category = state.categories.find((entry) => entry.id === row.id)!;
    return key === "id" ? { text: `#${category.id}`, color: C.muted, bold: true } : { text: category.name };
  };
  const transactionOf = (row: { id: number }) => state.transactions.find((entry) => entry.id === row.id)!;
  const amountCell = (row: { id: number }): Cell => {
    const transaction = transactionOf(row);
    return { text: signedAmount(state, transaction), color: signedAmount(state, transaction).startsWith("+") ? C.income : C.expense };
  };
  const linkColor = (categoryId: number) => ["#2563EB", "#EA580C", "#16A34A", "#9333EA", "#DB2777", "#0891B2"][(categoryId - 1) % 6];
  const linkTransactions = RELATION.linkTransactions, linkCategories = RELATION.linkCategories;
  const categoryIndex = new Map(state.categories.map((category, index) => [category.id, index]));
  const app = RELATION.app;
  const appScreen = monitorScreen(app, 5, 8);
  return <Group listening={false}>
    {shows("app") && <Group>
      <Monitor frame={app} chin={8} font={font} />
      <Rect x={appScreen.x} y={appScreen.y} width={appScreen.w} height={appScreen.h} cornerRadius={3} fill="#334155" />
      <IconLabel x={appScreen.x} y={appScreen.y} width={appScreen.w} icon="wallet" text="แอปรายรับรายจ่าย" size={15} bold color="#FFFFFF" align="center" font={font} lineHeight={appScreen.h} />
    </Group>}
    {shows("copy") && <>
    <Card box={RELATION.copy} title="แบบ ก๊อปชื่อ" sub="เก็บชื่อหมวดซ้ำไว้ในทุกรายการ" font={font} />
    <Label x={RELATION.copyCategories.box.x} y={RELATION.copyCategories.box.y - 22} width={180} text="หมวด" size={13} bold color={C.title} font={font} />
    <Label x={RELATION.copyTransactions.box.x} y={RELATION.copyTransactions.box.y - 22} width={300} text="รายการ" size={13} bold color={C.title} font={font} />
    <TableGrid table={RELATION.copyCategories} rows={state.categories} marks={marks} spotPrefix="copy:" cell={categoryCell} font={font} />
    <TableGrid table={RELATION.copyTransactions} rows={state.transactions} marks={marks} spotPrefix="copy:" font={font} cell={(row, key) => {
      const transaction = transactionOf(row);
      if (key === "id") return { text: `#${transaction.id}`, color: C.muted, bold: true };
      if (key === "copiedName") {
        const stale = transaction.copiedName !== nameOf(transaction.categoryId);
        return { text: stale ? `${transaction.copiedName} ✗` : transaction.copiedName, tone: stale ? "stale" : undefined };
      }
      return amountCell(row);
    }} />
    </>}
    {shows("link") && <>
    <Card box={RELATION.link} title="แบบ อ้างด้วย ID" sub="รายการเก็บแค่เลขหมวด แล้วตามเส้นไปดูชื่อ" font={font} />
    <Label x={linkTransactions.box.x} y={linkTransactions.box.y - 22} width={280} text="รายการ" size={13} bold color={C.title} font={font} />
    <Label x={linkCategories.box.x} y={linkCategories.box.y - 22} width={180} text="หมวด" size={13} bold color={C.title} font={font} />
    </>}
    {/* Link lines: every transaction points at its category row. */}
    {shows("refs") && state.transactions.slice(0, linkTransactions.maxRows).map((transaction, index) => {
      const target = categoryIndex.get(transaction.categoryId);
      if (target === undefined || target >= linkCategories.maxRows) return null;
      const from = { x: linkTransactions.columns[1].x + linkTransactions.columns[1].w - 6, y: tableRowY(linkTransactions, index) };
      const to = { x: linkCategories.box.x + 4, y: tableRowY(linkCategories, target) };
      return <Line key={transaction.id} points={[from.x, from.y, from.x + 30, from.y, to.x - 30, to.y, to.x, to.y]} bezier stroke={linkColor(transaction.categoryId)} strokeWidth={2} opacity={0.75} />;
    })}
    {shows("link") && <TableGrid table={linkTransactions} rows={state.transactions} marks={marks} spotPrefix="link:" font={font} cell={(row, key) => {
      const transaction = transactionOf(row);
      if (key === "id") return { text: `#${transaction.id}`, color: C.muted, bold: true };
      if (key === "categoryId") return { text: `→ #${transaction.categoryId}`, color: linkColor(transaction.categoryId), bold: true };
      return amountCell(row);
    }} />}
    {shows("link") && <TableGrid table={linkCategories} rows={state.categories} marks={marks} spotPrefix="link:" cell={categoryCell} font={font} />}
    {shows("refs") && <Gate at={RELATION.linkGate} tone={markOf(marks, "link:gate") === "blocked" ? "blocked" : markOf(marks, "link:gate") === "allowed" ? "ok" : "idle"} font={font} />}
  </Group>;
}

function AccessStep({ state, marks, waiting, font, shows }: { state: DataState; marks: Marks; waiting: (spot: string) => Waiting | null; font: string; shows: Shows }) {
  const gateMark = markOf(marks, "gate");
  const gateTone = gateMark === "leak" ? "leak" : gateMark === "allowed" ? "ok" : state.rulesOn ? "idle" : "off";
  const computerTitle = (id: ComputerId) => `คอม ${id} · ${userName(state, COMPUTER_USER[id])}`;
  const ownerLabel = (userId: number) => userId === COMPUTER_USER.A ? `${userName(state, userId)} (A)` : userId === COMPUTER_USER.B ? `${userName(state, userId)} (B)` : userName(state, userId);
  return <Group listening={false}>
    {(["A", "B"] as const).filter((id) => shows(`pc${id}`)).map((id) => <Computer key={id} frame={ACCESS[id].frame} label={`คอม ${id}`} title={computerTitle(id)}
      lines={state.screens[id].lines} empty="กดให้คอมนี้ขอดูข้อมูล" waiting={waiting(`pc${id}`)} font={font} lineH={24} />)}
    {shows("gate") && <Gate at={ACCESS.gate} label={state.rulesOn ? "กฎสิทธิ์: เปิด" : "กฎสิทธิ์: ปิด"} sub="Supabase: RLS Policy" tone={gateTone} font={font} />}
    {shows("db") && <Card box={ACCESS.db} title="ฐานข้อมูล" fill={C.db} stroke={C.dbStroke} font={font} />}
    {shows("categories") && <TableGrid table={ACCESS.categories} rows={state.categories} marks={marks} spotPrefix="" title="หมวด" font={font}
      badge={<Group x={ACCESS.categories.box.x + 60} y={ACCESS.categories.box.y}><Rect width={120} height={20} cornerRadius={10} fill="#DCFCE7" />
        <Label x={0} y={0} width={120} text="สาธารณะ ทุกคนเห็น" size={11} bold color="#166534" align="center" font={font} lineHeight={20} /></Group>}
      cell={(row, key) => {
        const item = state.categories.find((entry) => entry.id === row.id)!;
        if (key === "id") return { text: String(item.id), color: C.muted, bold: true };
        return key === "name" ? { text: item.name } : { text: KIND_LABEL[item.kind], color: item.kind === "income" ? C.income : C.expense };
      }} />}
    {shows("transactions") && <TableGrid table={ACCESS.transactions} rows={state.transactions} marks={marks} spotPrefix="" title="รายการ" font={font}
      badge={<Group x={ACCESS.transactions.box.x + 70} y={ACCESS.transactions.box.y}><Rect width={170} height={20} cornerRadius={10} fill={state.rulesOn ? "#DBEAFE" : "#FEE2E2"} />
        <Label x={0} y={0} width={170} text={state.rulesOn ? "เห็นเฉพาะเจ้าของ" : "ไม่มีกฎ: ใครก็เห็น"} size={11} bold color={state.rulesOn ? "#1E40AF" : "#991B1B"} align="center" font={font} lineHeight={20} /></Group>}
      cell={(row, key) => {
        const transaction = state.transactions.find((entry) => entry.id === row.id)!;
        if (key === "id") return { text: `#${transaction.id}`, color: C.muted, bold: true };
        if (key === "owner") return { text: ownerLabel(transaction.userId), color: OWNER_COLOR[transaction.userId] ?? C.muted, bold: true };
        if (key === "category") return { text: categoryName(state, transaction.categoryId) };
        const signed = signedAmount(state, transaction);
        return { text: signed.startsWith("+") ? `+${formatBaht(transaction.amount)}` : signed, color: signed.startsWith("+") ? C.income : C.expense };
      }} />}
  </Group>;
}

/**
 * Canvas rendering of a data-storage simulator node. `play` (editor only) animates the last action;
 * export passes null and gets the stored state.
 */
export function DataWidgetView({ node, play: playing, fontFamily }: { node: DataSimulatorNode; play: FlowPlay | null; fontFamily: string }): JSX.Element {
  const view = node.view;
  // Progressive reveal: hidden parts are not drawn (an animation needing hidden parts is not drawn either).
  const shows = partFilter(dataParts(view), node.reveal);
  const play = playing && dataPartsOfFrames(view, playing.frames).every(shows) ? playing : null;
  const flow = useFlowPlayback<DataState, Pt>(node.id, play, node.state, (before, after, move) => hopPath(view, before, after, move));
  const { marks, moving, path } = flow;
  const shown = { state: flow.state };
  // A pipe lights up while the packet's path runs along it.
  const onPath = (point: Pt) => Boolean(path?.some((item) => Math.abs(item.x - point.x) < 1 && Math.abs(item.y - point.y) < 1));
  const gateMark = markOf(marks, "gate");
  const gateTone = gateMark === "blocked" ? "blocked" : gateMark === "allowed" ? "ok" : "idle";
  // Apps spin while they wait for the travelling packet (editor only: export has no play).
  const waiting = (spot: string) => waitingAt(play, spot);

  const title = DATA_VIEWS.find((item) => item.id === view)!;
  return <Group scaleX={node.scale} scaleY={node.scale} clipX={0} clipY={0} clipWidth={DATA_W} clipHeight={DATA_H}>
    <Rect x={1} y={1} width={DATA_W - 2} height={DATA_H - 2} cornerRadius={18} fill={C.frame} stroke={C.frameStroke} strokeWidth={2} />
    <Label x={24} y={18} width={DATA_W - 48} text={`การเก็บข้อมูล: ${title.label}`} size={24} bold color={C.title} font={fontFamily} />
    {pipesOf(view).map((pipe, index) => shows(pipe.part) && <Pipe key={index} from={pipe.from} to={pipe.to} label={pipe.label}
      active={moving && onPath(pipe.from) && onPath(pipe.to) ? moving.tone : null} font={fontFamily} />)}
    {view === "where" && <WhereStep state={shown.state} marks={marks} waiting={waiting} font={fontFamily} shows={shows} />}
    {view === "table" && <TableStep state={shown.state} marks={marks} gateTone={gateTone} waiting={waiting} font={fontFamily} shows={shows} />}
    {view === "relation" && <RelationStep state={shown.state} marks={marks} font={fontFamily} shows={shows} />}
    {view === "access" && <AccessStep state={shown.state} marks={marks} waiting={waiting} font={fontFamily} shows={shows} />}
    <CaptionBar box={CAPTION_BOX} text={flow.frame ? flow.frame.caption : IDLE[view]} step={flow.step} font={fontFamily} />
    {moving && path && <Packet key={flow.runKey} runKey={flow.runKey} path={path} label={moving.label} tone={moving.tone}
      duration={flow.travel} font={fontFamily} onLanded={flow.onLanded} />}
  </Group>;
}
