"use client";

import type { JSX, ReactNode } from "react";
import { Ellipse, Group, Line, Rect } from "react-konva";
import type { DataSimulatorNode } from "@/domain/document/model";
import type { DataState, DataView, Mark, MarkTone, PhoneId } from "@/domain/data/model";
import { PHONE_USER } from "@/domain/data/model";
import { customerName, menuName, STORAGE_LABEL } from "@/domain/data/reducer";
import { AppSpinner, CaptionBar, Gate, Label, MARK_STYLE, Packet, Pipe, type Pt } from "@/features/flow/flow-bits";
import { waitingAt, type FlowPlay, type Waiting } from "@/features/flow/flow-session";
import { useFlowPlayback } from "@/features/flow/use-flow-playback";
import {
  ACCESS, CAPTION_BOX, DATA_H, DATA_VIEWS, DATA_W, hopPath, pipesOf, RELATION, TABLE, tableRowY, WHERE,
  type Box, type TableBox,
} from "./data-layout";

// Canvas rendering of the data-storage simulator (plan 07 §3). Draw inside a Group already translated to
// node.x/node.y. Deterministic for export: without a play it draws the stored state only.

const C = {
  frame: "#FFFFFF", frameStroke: "#CBD5E1", card: "#FFFFFF", cardStroke: "#E2E8F0", title: "#0F172A", text: "#1E293B", muted: "#64748B",
  phone: "#0F172A", screen: "#F8FAFC", db: "#F5F3FF", dbStroke: "#C4B5FD", supabase: "#047857", supabaseFill: "#ECFDF5",
};
const OWNER_COLOR: Record<number, string> = { 1: "#2563EB", 2: "#EA580C" };
const IDLE: Record<DataView, string> = {
  where: "กดปุ่มในแผงขวา: ให้ A สั่งกาแฟ แล้วลองรีเฟรช และให้ B เปิดดู",
  table: "ลองเพิ่ม / ดู / แก้ / ลบ เมนู แล้วดูว่าข้อมูลวิ่งไปถึงแถวไหน",
  relation: "ลองเปลี่ยนชื่อลูกค้า แล้วเทียบสองวิธีเก็บ",
  access: "ให้ลูกค้า A หรือ B ขอดูออเดอร์ แล้วลองปิดกฎสิทธิ์",
};

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

function Phone({ frame, screen, title, lines, empty, font, highlight, waiting }: {
  frame: Box; screen: Box; title: string; lines: string[]; empty: string; font: string; highlight?: MarkTone; waiting?: Waiting | null;
}) {
  const style = highlight ? MARK_STYLE[highlight] : null;
  const lineH = 26;
  const max = Math.max(1, Math.floor((screen.h - 44) / lineH));
  return <Group listening={false}>
    <Rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} cornerRadius={30} fill={C.phone} />
    <Rect x={frame.x + frame.w / 2 - 34} y={frame.y + 12} width={68} height={8} cornerRadius={4} fill="#334155" />
    <Rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} cornerRadius={12} fill={style?.fill ?? C.screen} stroke={style?.stroke} strokeWidth={style ? 2.5 : 0} />
    <Label x={screen.x + 12} y={screen.y + 10} width={screen.w - 24} text={title} size={15} bold color={C.title} font={font} />
    {lines.length === 0
      ? <Label x={screen.x + 12} y={screen.y + 44} width={screen.w - 24} text={empty} size={14} color={C.muted} font={font} />
      : lines.slice(0, max).map((line, index) => <Group key={index}>
        <Rect x={screen.x + 8} y={screen.y + 38 + index * lineH} width={screen.w - 16} height={lineH - 4} cornerRadius={6}
          fill={line.startsWith("⚠") ? "#FEE2E2" : "#FFFFFF"} stroke={line.startsWith("⚠") ? "#FCA5A5" : "#E2E8F0"} />
        <Label x={screen.x + 16} y={screen.y + 38 + index * lineH} width={screen.w - 32} text={line} size={13} color={line.startsWith("⚠") ? "#991B1B" : C.text} font={font} lineHeight={lineH - 4} />
      </Group>)}
    {lines.length > max && <Label x={screen.x + 12} y={screen.y + screen.h - 20} width={screen.w - 24} text={`… อีก ${lines.length - max} รายการ`} size={12} color={C.muted} font={font} />}
    {waiting && <AppSpinner box={{ x: screen.x, y: screen.y + 34, w: screen.w, h: screen.h - 34 }} kind={waiting} font={font} />}
  </Group>;
}

/** Wrapped row of small item chips (layout computed first, then drawn). */
function chipLayout(box: Box, items: string[]): { item: string; x: number; y: number; w: number }[] {
  const placed: { item: string; x: number; y: number; w: number }[] = [];
  let x = box.x + 10, y = box.y + 56;
  for (const item of items) {
    const w = Math.min(box.w - 20, [...item].length * 12 + 20);
    if (x + w > box.x + box.w - 10) { x = box.x + 10; y += 30; }
    placed.push({ item, x, y, w });
    x += w + 6;
  }
  return placed;
}
function Chips({ box, items, font }: { box: Box; items: string[]; font: string }) {
  return <Group listening={false}>
    {chipLayout(box, items).map(({ item, x, y, w }, index) => <Group key={index} x={x} y={y}>
      <Rect width={w} height={24} cornerRadius={12} fill="#EFF6FF" stroke="#93C5FD" />
      <Label x={0} y={0} width={w} text={item} size={12} bold color="#1D4ED8" align="center" font={font} lineHeight={24} />
    </Group>)}
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
// Spot names use the table's data key (menu/customers/orders).
function tableKey(table: TableBox): string {
  if (table === TABLE.menu || table === ACCESS.menu) return "menu";
  if (table === ACCESS.orders || table === RELATION.copyOrders || table === RELATION.linkOrders) return "orders";
  return "customers";
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function WhereStep({ state, marks, waiting, font }: { state: DataState; marks: Marks; waiting: (spot: string) => Waiting | null; font: string }) {
  const { storage } = state;
  const phone = (id: PhoneId) => {
    const p = WHERE[id];
    const busy = waiting(`phone${id}`);
    const lineH = 26;
    const max = Math.max(1, Math.floor((p.screen.h - 12) / lineH));
    const lines = storage.screen[id];
    return <Group key={id}>
      <Rect x={p.frame.x} y={p.frame.y} width={p.frame.w} height={p.frame.h} cornerRadius={30} fill={C.phone} />
      <Rect x={p.frame.x + p.frame.w / 2 - 34} y={p.frame.y + 10} width={68} height={8} cornerRadius={4} fill="#334155" />
      <Label x={p.frame.x} y={p.frame.y + 21} width={p.frame.w} text={`เครื่อง ${id}`} size={11} color="#94A3B8" align="center" font={font} />
      {/* The app window: title bar, order list and — inside it — the app's memory. */}
      <Rect x={p.app.x} y={p.app.y} width={p.app.w} height={p.app.h} cornerRadius={14} fill={C.screen} stroke="#CBD5E1" strokeWidth={1.5} />
      <Rect x={p.app.x} y={p.app.y} width={p.app.w} height={30} cornerRadius={[14, 14, 0, 0]} fill="#E2E8F0" />
      <Label x={p.app.x + 12} y={p.app.y} width={p.app.w - 50} text="☕ แอปร้านกาแฟ" size={13} bold color={C.title} font={font} lineHeight={30} />
      <Label x={p.app.x + p.app.w - 36} y={p.app.y} width={24} text="↻" size={16} bold color={busy === "refresh" ? "#2563EB" : "#64748B"} align="center" font={font} lineHeight={30} />
      {lines.length === 0
        ? <Label x={p.screen.x + 12} y={p.screen.y + 10} width={p.screen.w - 24} text={id === "A" ? "ยังไม่มีออเดอร์" : "ยังไม่ได้เปิดดู"} size={14} color={C.muted} font={font} />
        : lines.slice(0, max).map((line, index) => <Group key={index}>
          <Rect x={p.screen.x + 8} y={p.screen.y + 6 + index * lineH} width={p.screen.w - 16} height={lineH - 4} cornerRadius={6} fill="#FFFFFF" stroke="#E2E8F0" />
          <Label x={p.screen.x + 16} y={p.screen.y + 6 + index * lineH} width={p.screen.w - 32} text={`☕ ${line}`} size={13} color={C.text} font={font} lineHeight={lineH - 4} />
        </Group>)}
      <Zone box={p.memory} title="ความจำของแอป" sub="อยู่ในแอป: หายเมื่อรีเฟรชหรือปิดแอป" items={storage.memory[id]} active={id === "A" && storage.mode === "app"} mark={markOf(marks, `mem${id}`)} font={font} />
      {busy && <AppSpinner box={p.screen} kind={busy} font={font} />}
      <Zone box={p.device} title={`เก็บในเครื่อง ${id}`} sub="นอกแอป: อยู่ต่อหลังรีเฟรช แต่มีแค่เครื่องนี้" items={storage.device[id]} active={id === "A" && storage.mode === "device"} mark={markOf(marks, `dev${id}`)} font={font} />
    </Group>;
  };
  const cloud = WHERE.cloud;
  const cloudActive = storage.mode === "cloud";
  return <Group listening={false}>
    {phone("A")}{phone("B")}
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
      <Label x={12} y={10} width={cloud.w + 16} text="แอปของ A ตอนนี้" size={12} color={C.muted} align="center" font={font} />
      <Label x={12} y={30} width={cloud.w + 16} text={STORAGE_LABEL[storage.mode]} size={20} bold color="#1D4ED8" align="center" font={font} />
    </Group>
  </Group>;
}

function TableStep({ state, marks, gateTone, waiting, font }: { state: DataState; marks: Marks; gateTone: "idle" | "ok" | "blocked"; waiting: (spot: string) => Waiting | null; font: string }) {
  const note = marks.get("gate")?.note;
  return <Group listening={false}>
    <Phone frame={TABLE.phone.frame} screen={TABLE.phone.screen} title={state.phones.A.title || "เครื่อง A · แอปร้านกาแฟ"} lines={state.phones.A.lines} empty="ผลจากฐานข้อมูลจะขึ้นที่นี่" waiting={waiting("phoneA")} font={font} />
    <Gate at={TABLE.gate} label="ตรวจชนิดข้อมูล" sub={gateTone === "blocked" && note ? "✗ ไม่ผ่าน" : undefined} tone={gateTone} font={font} />
    <Card box={TABLE.db} title="ฐานข้อมูล · ตาราง “เมนู”" fill={C.db} stroke={C.dbStroke} font={font}>
      <Tag x={TABLE.db.x + TABLE.db.w - 196} y={TABLE.db.y + 12} text="Supabase: Table Editor" width={180} font={font} />
    </Card>
    <TableGrid table={TABLE.menu} rows={state.menu} marks={marks} spotPrefix="" font={font}
      cell={(row, key) => {
        const item = state.menu.find((entry) => entry.id === row.id)!;
        if (key === "id") return { text: String(item.id), color: C.muted, bold: true };
        if (key === "name") return { text: item.name };
        if (key === "price") return { text: `${item.price}` };
        return { text: item.available ? "ใช่" : "ไม่ใช่", color: item.available ? "#15803D" : "#B91C1C" };
      }} />
  </Group>;
}

function RelationStep({ state, marks, font }: { state: DataState; marks: Marks; font: string }) {
  const nameOf = (id: number) => customerName(state, id);
  const customerCell = (row: { id: number }, key: string): Cell => {
    const customer = state.customers.find((entry) => entry.id === row.id)!;
    return key === "id" ? { text: `#${customer.id}`, color: C.muted, bold: true } : { text: customer.name };
  };
  const orderOf = (row: { id: number }) => state.orders.find((entry) => entry.id === row.id)!;
  const linkColor = (customerId: number) => ["#2563EB", "#EA580C", "#16A34A", "#9333EA", "#DB2777", "#0891B2"][(customerId - 1) % 6];
  const linkOrders = RELATION.linkOrders, linkCustomers = RELATION.linkCustomers;
  const customerIndex = new Map(state.customers.map((customer, index) => [customer.id, index]));
  return <Group listening={false}>
    <Group x={RELATION.app.x} y={RELATION.app.y}>
      <Rect width={RELATION.app.w} height={RELATION.app.h} cornerRadius={29} fill={C.phone} />
      <Label x={0} y={0} width={RELATION.app.w} text="📱 แอปร้านกาแฟ" size={16} bold color="#FFFFFF" align="center" font={font} lineHeight={RELATION.app.h} />
    </Group>
    <Card box={RELATION.copy} title="แบบ ก๊อปชื่อ" sub="เก็บชื่อลูกค้าซ้ำไว้ในทุกออเดอร์" font={font} />
    <Card box={RELATION.link} title="แบบ อ้างด้วย ID" sub="ออเดอร์เก็บแค่เลขลูกค้า แล้วตามเส้นไปดูชื่อ" font={font} />
    <Label x={RELATION.copyCustomers.box.x} y={RELATION.copyCustomers.box.y - 22} width={180} text="ลูกค้า" size={13} bold color={C.title} font={font} />
    <Label x={RELATION.copyOrders.box.x} y={RELATION.copyOrders.box.y - 22} width={300} text="ออเดอร์" size={13} bold color={C.title} font={font} />
    <Label x={linkOrders.box.x} y={linkOrders.box.y - 22} width={280} text="ออเดอร์" size={13} bold color={C.title} font={font} />
    <Label x={linkCustomers.box.x} y={linkCustomers.box.y - 22} width={180} text="ลูกค้า" size={13} bold color={C.title} font={font} />
    <TableGrid table={RELATION.copyCustomers} rows={state.customers} marks={marks} spotPrefix="copy:" cell={customerCell} font={font} />
    <TableGrid table={RELATION.copyOrders} rows={state.orders} marks={marks} spotPrefix="copy:" font={font} cell={(row, key) => {
      const order = orderOf(row);
      if (key === "id") return { text: `#${order.id}`, color: C.muted, bold: true };
      if (key === "copiedName") {
        const stale = order.copiedName !== nameOf(order.customerId);
        return { text: stale ? `${order.copiedName} ✗` : order.copiedName, tone: stale ? "stale" : undefined };
      }
      return { text: menuName(state, order.menuId) };
    }} />
    {/* Link lines: every order points at its customer row. */}
    {state.orders.slice(0, linkOrders.maxRows).map((order, index) => {
      const target = customerIndex.get(order.customerId);
      if (target === undefined || target >= linkCustomers.maxRows) return null;
      const from = { x: linkOrders.columns[1].x + linkOrders.columns[1].w - 6, y: tableRowY(linkOrders, index) };
      const to = { x: linkCustomers.box.x + 4, y: tableRowY(linkCustomers, target) };
      return <Line key={order.id} points={[from.x, from.y, from.x + 30, from.y, to.x - 30, to.y, to.x, to.y]} bezier stroke={linkColor(order.customerId)} strokeWidth={2} opacity={0.75} />;
    })}
    <TableGrid table={linkOrders} rows={state.orders} marks={marks} spotPrefix="link:" font={font} cell={(row, key) => {
      const order = orderOf(row);
      if (key === "id") return { text: `#${order.id}`, color: C.muted, bold: true };
      if (key === "customerId") return { text: `→ #${order.customerId}`, color: linkColor(order.customerId), bold: true };
      return { text: menuName(state, order.menuId) };
    }} />
    <TableGrid table={linkCustomers} rows={state.customers} marks={marks} spotPrefix="link:" cell={customerCell} font={font} />
    <Gate at={RELATION.linkGate} tone={markOf(marks, "link:gate") === "blocked" ? "blocked" : markOf(marks, "link:gate") === "allowed" ? "ok" : "idle"} font={font} />
  </Group>;
}

function AccessStep({ state, marks, waiting, font }: { state: DataState; marks: Marks; waiting: (spot: string) => Waiting | null; font: string }) {
  const gateMark = markOf(marks, "gate");
  const gateTone = gateMark === "leak" ? "leak" : gateMark === "allowed" ? "ok" : state.rulesOn ? "idle" : "off";
  const phoneTitle = (id: PhoneId) => `เครื่อง ${id} · ${customerName(state, PHONE_USER[id])}`;
  const ownerLabel = (customerId: number) => customerId === PHONE_USER.A ? `${customerName(state, customerId)} (A)` : customerId === PHONE_USER.B ? `${customerName(state, customerId)} (B)` : customerName(state, customerId);
  return <Group listening={false}>
    {(["A", "B"] as const).map((id) => <Phone key={id} frame={ACCESS[id].frame} screen={ACCESS[id].screen} title={phoneTitle(id)}
      lines={state.phones[id].lines} empty="กดให้เครื่องนี้ขอดูข้อมูล" waiting={waiting(`phone${id}`)} font={font} />)}
    <Gate at={ACCESS.gate} label={state.rulesOn ? "กฎสิทธิ์: เปิด" : "กฎสิทธิ์: ปิด"} sub="Supabase: RLS Policy" tone={gateTone} font={font} />
    <Card box={ACCESS.db} title="ฐานข้อมูล" fill={C.db} stroke={C.dbStroke} font={font} />
    <TableGrid table={ACCESS.menu} rows={state.menu} marks={marks} spotPrefix="" title="เมนู" font={font}
      badge={<Group x={ACCESS.menu.box.x + 60} y={ACCESS.menu.box.y}><Rect width={120} height={20} cornerRadius={10} fill="#DCFCE7" />
        <Label x={0} y={0} width={120} text="สาธารณะ ทุกคนเห็น" size={11} bold color="#166534" align="center" font={font} lineHeight={20} /></Group>}
      cell={(row, key) => {
        const item = state.menu.find((entry) => entry.id === row.id)!;
        return key === "id" ? { text: String(item.id), color: C.muted, bold: true } : key === "name" ? { text: item.name } : { text: `${item.price} บาท` };
      }} />
    <TableGrid table={ACCESS.orders} rows={state.orders} marks={marks} spotPrefix="" title="ออเดอร์" font={font}
      badge={<Group x={ACCESS.orders.box.x + 70} y={ACCESS.orders.box.y}><Rect width={170} height={20} cornerRadius={10} fill={state.rulesOn ? "#DBEAFE" : "#FEE2E2"} />
        <Label x={0} y={0} width={170} text={state.rulesOn ? "เห็นเฉพาะเจ้าของ" : "ไม่มีกฎ: ใครก็เห็น"} size={11} bold color={state.rulesOn ? "#1E40AF" : "#991B1B"} align="center" font={font} lineHeight={20} /></Group>}
      cell={(row, key) => {
        const order = state.orders.find((entry) => entry.id === row.id)!;
        if (key === "id") return { text: `#${order.id}`, color: C.muted, bold: true };
        if (key === "owner") return { text: ownerLabel(order.customerId), color: OWNER_COLOR[order.customerId] ?? C.muted, bold: true };
        if (key === "menu") return { text: menuName(state, order.menuId) };
        return { text: `×${order.qty}` };
      }} />
  </Group>;
}

/**
 * Canvas rendering of a data-storage simulator node. `play` (editor only) animates the last action;
 * export passes null and gets the stored state.
 */
export function DataWidgetView({ node, play, fontFamily }: { node: DataSimulatorNode; play: FlowPlay | null; fontFamily: string }): JSX.Element {
  const view = node.view;
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
    {pipesOf(view).map((pipe, index) => <Pipe key={index} from={pipe.from} to={pipe.to} label={pipe.label}
      active={moving && onPath(pipe.from) && onPath(pipe.to) ? moving.tone : null} font={fontFamily} />)}
    {view === "where" && <WhereStep state={shown.state} marks={marks} waiting={waiting} font={fontFamily} />}
    {view === "table" && <TableStep state={shown.state} marks={marks} gateTone={gateTone} waiting={waiting} font={fontFamily} />}
    {view === "relation" && <RelationStep state={shown.state} marks={marks} font={fontFamily} />}
    {view === "access" && <AccessStep state={shown.state} marks={marks} waiting={waiting} font={fontFamily} />}
    <CaptionBar box={CAPTION_BOX} text={flow.frame ? flow.frame.caption : IDLE[view]} step={flow.step} font={fontFamily} />
    {moving && path && <Packet key={flow.runKey} runKey={flow.runKey} path={path} label={moving.label} tone={moving.tone}
      duration={flow.travel} font={fontFamily} onLanded={flow.onLanded} />}
  </Group>;
}
