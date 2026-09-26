"use client";

import { useId, useState, type JSX } from "react";
import { Coffee, Copy, Database, Eye, Pencil, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { DataSimulatorNode } from "@/domain/document/model";
import type { DataAction, DataState, DataView, PhoneId, StorageMode } from "@/domain/data/model";
import { PHONE_USER } from "@/domain/data/model";
import { applyDataAction, customerName } from "@/domain/data/reducer";
import { useEditorStore } from "@/features/editor/store";
import { Action, Field, PanelHeader, PlaybackControls, ResetLink, ResultMessage, Section, Segmented, Select, StepSelect } from "@/features/flow/flow-panel-parts";
import { useFlowSession } from "@/features/flow/flow-session";
import { DATA_VIEWS } from "./data-layout";

/** The node as currently stored, so actions never start from a stale render. */
function latestNode(slideId: string, nodeId: string): DataSimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "data-simulator" ? node : null;
}

const ACTION_LABEL: Partial<Record<DataAction["type"], string>> = {
  "storage.mode": "เปลี่ยนวิธีเก็บ", "storage.order": "สั่งกาแฟ", "storage.refresh": "รีเฟรช", "storage.open": "เปิดดูออเดอร์",
  "menu.create": "เพิ่มเมนู", "menu.read": "ดูเมนู", "menu.update": "แก้เมนู", "menu.delete": "ลบเมนู",
  "customer.rename": "เปลี่ยนชื่อลูกค้า", "orders.fixCopies": "แก้ชื่อที่ก๊อปไว้", "customer.delete": "ลบลูกค้า",
  "orders.deleteOfCustomer": "ลบออเดอร์ของลูกค้า", "order.create": "สั่งออเดอร์", "access.rules": "กฎสิทธิ์", "access.read": "ขอดูข้อมูล", reset: "เริ่มใหม่",
};

/**
 * Small DOM panel of a data-storage widget (plan 07 §3): lesson step, the scenarios of that step and the
 * playback controls. Render with `key={node.id}`.
 */
export function DataPanel({ node, slideId, writable, transact }: {
  node: DataSimulatorNode;
  slideId: string;
  writable: boolean;
  transact: (tx: DocumentTransaction) => boolean;
}): JSX.Element {
  const ids = useId();
  const nodeId = node.id;
  const state = node.state;
  const view = node.view;
  const result = useFlowSession((s) => s.results[nodeId]);
  const flow = useFlowSession.getState();

  const run = (action: DataAction) => {
    if (!writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    const transition = applyDataAction(latest.state, action);
    if (transition.changed && !transact({
      label: `ข้อมูล (จำลอง): ${ACTION_LABEL[action.type] ?? action.type}`,
      affectedSlideId: slideId,
      commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, state: transition.nextState }] }],
    })) {
      flow.setResult(nodeId, { outcome: "rejected", message: "ทำไม่สำเร็จ: โปรเจกต์อ่านอย่างเดียวหรือข้อมูลไม่ผ่านการตรวจ" });
      return;
    }
    flow.setResult(nodeId, { outcome: transition.outcome, message: transition.message });
    if (transition.frames.length) flow.start(nodeId, latest.state, transition.frames);
    else flow.stop(nodeId);
  };

  const changeView = (next: DataView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    // Phone screens show the answer of the last action; a new step starts with empty screens.
    const state = { ...latest.state, phones: { A: { title: "", lines: [] }, B: { title: "", lines: [] } } };
    if (transact({ label: "ข้อมูล (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, view: next, state }] }] })) {
      flow.stop(nodeId);
      flow.setResult(nodeId, undefined);
    }
  };

  return <section className="space-y-4 p-4 text-sm" aria-label="ตัวจำลองข้อมูล">
    <PanelHeader icon={<Database size={16} />} color="bg-violet-700" title="การเก็บข้อมูล" />
    <StepSelect id={ids} value={view} steps={DATA_VIEWS} disabled={!writable} onChange={changeView} />
    {view === "where" && <WhereControls state={state} writable={writable} run={run} />}
    {view === "table" && <TableControls state={state} writable={writable} run={run} />}
    {view === "relation" && <RelationControls state={state} writable={writable} run={run} />}
    {view === "access" && <AccessControls state={state} writable={writable} run={run} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="คืนข้อมูลร้านกาแฟเป็นค่าตั้งต้น (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

// ---------------------------------------------------------------------------
// Controls per lesson step: one section per idea, short labels, details on the board.
// ---------------------------------------------------------------------------

type Props = { state: DataState; writable: boolean; run: (action: DataAction) => void };

function WhereControls({ state, writable, run }: Props) {
  const { storage, menu } = state;
  // Each order picks the next menu item, so the teacher only presses one button.
  const names = menu.length ? menu.map((item) => item.name) : ["ลาเต้"];
  const item = names[(storage.memory.A.length + storage.device.A.length + storage.cloud.length) % names.length];
  return <>
    <Section title="แอปของ A เก็บออเดอร์ที่">
      <Segmented label="วิธีเก็บ" value={storage.mode} disabled={!writable} onChange={(mode: StorageMode) => run({ type: "storage.mode", mode })}
        options={[{ value: "app", label: "ในแอป" }, { value: "device", label: "ในเครื่อง" }, { value: "cloud", label: "ฐานข้อมูล" }]} />
    </Section>
    <Section title="ลองกดตามลำดับ">
      <div className="space-y-1.5">
        <Action primary icon={<Coffee size={14} />} disabled={!writable} onClick={() => run({ type: "storage.order", item })}>A สั่ง{item}</Action>
        <Action icon={<RefreshCw size={14} />} disabled={!writable} onClick={() => run({ type: "storage.refresh", phone: "A" })}>A รีเฟรชหน้า</Action>
        <Action icon={<Smartphone size={14} />} disabled={!writable} onClick={() => run({ type: "storage.open", phone: "B" })}>B เปิดแอปดูออเดอร์</Action>
      </div>
    </Section>
  </>;
}

type Crud = "create" | "read" | "update" | "delete";

function TableControls({ state, writable, run }: Props) {
  const { menu } = state;
  const [tab, setTab] = useState<Crud>("create");
  const [name, setName] = useState("มอคค่า");
  const [price, setPrice] = useState("65");
  const [available, setAvailable] = useState(true);
  const [rowId, setRowId] = useState("");
  const [field, setField] = useState<"name" | "price" | "available">("price");
  const [value, setValue] = useState("");
  const selected = menu.find((item) => String(item.id) === rowId) ?? menu[0];
  const rowPicker = <Select label="แถว" value={selected ? String(selected.id) : ""} onChange={setRowId}>
    {menu.map((item) => <option key={item.id} value={item.id}>ID {item.id} · {item.name}</option>)}
  </Select>;
  return <Section title="ลองกับตารางเมนู">
    <Segmented label="สิ่งที่จะทำ" value={tab} onChange={setTab}
      options={[{ value: "create", label: "เพิ่ม" }, { value: "read", label: "ดู" }, { value: "update", label: "แก้" }, { value: "delete", label: "ลบ" }]} />
    <div className="space-y-2 pt-1">
      {tab === "create" && <>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <Field label="ชื่อ" value={name} onChange={setName} />
          <Field label="ราคา (ตัวเลข)" value={price} onChange={setPrice} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} /> มีขาย</label>
        <Action primary icon={<Plus size={14} />} disabled={!writable} onClick={() => run({ type: "menu.create", name, price, available })}>เพิ่มเมนู</Action>
        <p className="text-[11px] text-slate-400">ลองใส่ราคาเป็น “ห้าสิบ” ดูว่าติดด่าน</p>
      </>}
      {tab === "read" && <Action primary icon={<Eye size={14} />} disabled={!writable} onClick={() => run({ type: "menu.read", phone: "A" })}>ดูเมนูทั้งหมด</Action>}
      {tab === "update" && <>
        {rowPicker}
        <Segmented label="ช่อง" value={field} onChange={(next) => { setField(next); setValue(""); }}
          options={[{ value: "name", label: "ชื่อ" }, { value: "price", label: "ราคา" }, { value: "available", label: "มีขาย" }]} />
        {field === "available"
          ? <Segmented label="ค่าใหม่" value={value === "false" ? "false" : "true"} onChange={setValue} options={[{ value: "true", label: "ใช่" }, { value: "false", label: "ไม่ใช่" }]} />
          : <Field label="ค่าใหม่" value={value} onChange={setValue} placeholder={field === "price" ? "เช่น 70" : "ชื่อใหม่"} />}
        <Action primary icon={<Pencil size={14} />} disabled={!writable || !selected}
          onClick={() => selected && run({ type: "menu.update", id: selected.id, field, value: field === "available" ? value || "true" : value })}>แก้ช่องนี้</Action>
      </>}
      {tab === "delete" && <>
        {rowPicker}
        <Action danger icon={<Trash2 size={14} />} disabled={!writable || !selected} onClick={() => selected && run({ type: "menu.delete", id: selected.id })}>ลบแถวนี้</Action>
      </>}
    </div>
  </Section>;
}

type RelationTab = "rename" | "order" | "delete";

function RelationControls({ state, writable, run }: Props) {
  const { customers, menu, orders } = state;
  const [tab, setTab] = useState<RelationTab>("rename");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [menuId, setMenuId] = useState("");
  const customer = customers.find((item) => String(item.id) === customerId) ?? customers[0];
  const id = customer?.id ?? 0;
  const stale = customer ? orders.filter((order) => order.customerId === id && order.copiedName !== customer.name).length : 0;
  const owned = orders.filter((order) => order.customerId === id).length;
  const item = menu.find((entry) => String(entry.id) === menuId) ?? menu[0];
  return <Section title="ลองกับลูกค้า">
    <Select label="ลูกค้า" value={customer ? String(id) : ""} onChange={setCustomerId}>
      {customers.map((entry) => <option key={entry.id} value={entry.id}>#{entry.id} · {entry.name}</option>)}
    </Select>
    <Segmented label="สิ่งที่จะทำ" value={tab} onChange={setTab}
      options={[{ value: "rename", label: "แก้ชื่อ" }, { value: "order", label: "สั่งใหม่" }, { value: "delete", label: "ลบ" }]} />
    <div className="space-y-2 pt-1">
      {tab === "rename" && <>
        <Field label="ชื่อใหม่" value={name} onChange={setName} placeholder={customer ? `${customer.name} ใจดี` : ""} />
        <Action primary icon={<Pencil size={14} />} disabled={!writable || !customer} onClick={() => run({ type: "customer.rename", id, name: name || `${customer?.name ?? ""} ใจดี` })}>เปลี่ยนชื่อ</Action>
        {stale > 0 && <Action icon={<Copy size={14} />} disabled={!writable} count={stale} onClick={() => run({ type: "orders.fixCopies", customerId: id })}>ตามแก้ชื่อที่ก๊อปไว้</Action>}
      </>}
      {tab === "order" && <>
        <Select label="เมนู" value={item ? String(item.id) : ""} onChange={setMenuId}>{menu.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</Select>
        <Action primary icon={<Coffee size={14} />} disabled={!writable || !customer || !item} onClick={() => item && run({ type: "order.create", customerId: id, menuId: item.id })}>
          {customer ? `${customer.name} สั่ง${item?.name ?? ""}` : "สั่งออเดอร์"}</Action>
      </>}
      {tab === "delete" && <>
        <Action danger icon={<Trash2 size={14} />} disabled={!writable || !customer} onClick={() => run({ type: "customer.delete", id })}>ลบลูกค้าคนนี้</Action>
        {owned > 0 && <Action icon={<Trash2 size={14} />} disabled={!writable} count={owned} onClick={() => run({ type: "orders.deleteOfCustomer", customerId: id })}>ลบออเดอร์ของเขาก่อน</Action>}
      </>}
    </div>
  </Section>;
}

function AccessControls({ state, writable, run }: Props) {
  const names: Record<PhoneId, string> = { A: customerName(state, PHONE_USER.A), B: customerName(state, PHONE_USER.B) };
  return <>
    <Section title="กฎสิทธิ์ (RLS)">
      <Segmented label="กฎสิทธิ์" value={state.rulesOn} disabled={!writable} onChange={(on: boolean) => run({ type: "access.rules", on })}
        options={[{ value: true, label: "เปิด", tone: "good" }, { value: false, label: "ปิด", tone: "bad" }]} />
    </Section>
    <Section title="ให้ลูกค้าขอดูข้อมูล">
      <div className="space-y-1.5">
        {(["A", "B"] as const).map((phone) => <div key={phone} className="grid grid-cols-[72px_1fr_1fr] items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-slate-600" title={names[phone]}>{phone} · {names[phone]}</span>
          <Action primary={phone === "B"} disabled={!writable} onClick={() => run({ type: "access.read", phone, table: "orders" })}>ดูออเดอร์</Action>
          <Action disabled={!writable} onClick={() => run({ type: "access.read", phone, table: "menu" })}>ดูเมนู</Action>
        </div>)}
      </div>
    </Section>
  </>;
}
