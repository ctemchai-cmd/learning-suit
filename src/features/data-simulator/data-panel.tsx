"use client";

import { useId, useState, type JSX } from "react";
import { Copy, Database, Eye, Monitor, Pencil, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { DataSimulatorNode } from "@/domain/document/model";
import type { ComputerId, DataAction, DataState, DataView, StorageMode } from "@/domain/data/model";
import { COMPUTER_USER } from "@/domain/data/model";
import { applyDataAction, STORAGE_SAMPLES, userName } from "@/domain/data/reducer";
import { useEditorStore } from "@/features/editor/store";
import { Action, Field, PanelHeader, PlaybackControls, ResetLink, ResultMessage, RevealControls, Section, Segmented, Select, StepSelect } from "@/features/flow/flow-panel-parts";
import { revealForParts, revealOnStepChange, withReveal } from "@/domain/document/reveal";
import { useFlowSession } from "@/features/flow/flow-session";
import { DATA_VIEWS, dataParts, dataPartsOfFrames } from "./data-layout";

/** The node as currently stored, so actions never start from a stale render. */
function latestNode(slideId: string, nodeId: string): DataSimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "data-simulator" ? node : null;
}

const ACTION_LABEL: Partial<Record<DataAction["type"], string>> = {
  "storage.mode": "เปลี่ยนวิธีเก็บ", "storage.record": "บันทึกรายการ", "storage.refresh": "รีเฟรช", "storage.open": "เปิดดูรายการ",
  "category.create": "เพิ่มหมวด", "category.read": "ดูหมวด", "category.update": "แก้หมวด", "category.delete": "ลบหมวด",
  "category.rename": "เปลี่ยนชื่อหมวด", "transactions.fixCopies": "แก้ชื่อหมวดที่ก๊อปไว้", "category.deleteLinked": "ลบหมวด",
  "transactions.deleteOfCategory": "ลบรายการของหมวด", "transaction.create": "บันทึกรายการ", "access.rules": "กฎสิทธิ์", "access.read": "ขอดูข้อมูล", reset: "เริ่มใหม่",
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
    // Parts the animation needs are shown in the same step (no-op while the reveal mode is off).
    const reveal = revealForParts(dataParts(latest.view), latest.reveal, dataPartsOfFrames(latest.view, transition.frames));
    if ((transition.changed || reveal !== latest.reveal) && !transact({
      label: `ข้อมูล (จำลอง): ${ACTION_LABEL[action.type] ?? action.type}`,
      affectedSlideId: slideId,
      commands: [{ type: "nodes.replace", slideId, nodes: [withReveal({ ...latest, state: transition.nextState }, reveal)] }],
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
    // Computer screens show the answer of the last action; a new step starts with empty screens.
    const state = { ...latest.state, screens: { A: { title: "", lines: [] }, B: { title: "", lines: [] } } };
    if (transact({ label: "ข้อมูล (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [withReveal({ ...latest, view: next, state }, revealOnStepChange(latest.reveal))] }] })) {
      flow.stop(nodeId);
      flow.setResult(nodeId, undefined);
    }
  };

  return <section className="space-y-4 p-4 text-sm" aria-label="ตัวจำลองข้อมูล">
    <PanelHeader icon={<Database size={16} />} color="bg-violet-700" title="การเก็บข้อมูล" />
    <StepSelect id={ids} value={view} steps={DATA_VIEWS} disabled={!writable} onChange={changeView} />
    <RevealControls node={node} parts={dataParts(view)} slideId={slideId} writable={writable} transact={transact} onHidden={() => flow.stop(nodeId)} />
    {view === "where" && <WhereControls state={state} writable={writable} run={run} />}
    {view === "table" && <TableControls state={state} writable={writable} run={run} />}
    {view === "relation" && <RelationControls state={state} writable={writable} run={run} />}
    {view === "access" && <AccessControls state={state} writable={writable} run={run} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="คืนข้อมูลแอปรายรับรายจ่ายเป็นค่าตั้งต้น (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

// ---------------------------------------------------------------------------
// Controls per lesson step: one section per idea, short labels, details on the board.
// ---------------------------------------------------------------------------

type Props = { state: DataState; writable: boolean; run: (action: DataAction) => void };

function WhereControls({ state, writable, run }: Props) {
  const { storage } = state;
  // Each press records the next sample transaction, so the teacher only presses one button.
  const item = STORAGE_SAMPLES[(storage.memory.A.length + storage.device.A.length + storage.cloud.length) % STORAGE_SAMPLES.length];
  return <>
    <Section title="แอปบนคอม A เก็บรายการที่">
      <Segmented label="วิธีเก็บ" value={storage.mode} disabled={!writable} onChange={(mode: StorageMode) => run({ type: "storage.mode", mode })}
        options={[{ value: "app", label: "ในแอป" }, { value: "device", label: "ในเครื่อง" }, { value: "cloud", label: "ฐานข้อมูล" }]} />
      <p className="pt-1 text-[11px] text-slate-400">คอม B คืออีกเครื่องของเรา เช่น คอมที่บ้าน ส่วนคอม A คือคอมที่ทำงาน</p>
    </Section>
    <Section title="ลองกดตามลำดับ">
      <div className="space-y-1.5">
        <Action primary icon={<Wallet size={14} />} disabled={!writable} onClick={() => run({ type: "storage.record", item })}>A บันทึก {item}</Action>
        <Action icon={<RefreshCw size={14} />} disabled={!writable} onClick={() => run({ type: "storage.refresh", computer: "A" })}>A รีเฟรชหน้า</Action>
        <Action icon={<Monitor size={14} />} disabled={!writable} onClick={() => run({ type: "storage.open", computer: "B" })}>B เปิดแอปดูรายการ</Action>
      </div>
    </Section>
  </>;
}

type Crud = "create" | "read" | "update" | "delete";

function TableControls({ state, writable, run }: Props) {
  const { categories } = state;
  const [tab, setTab] = useState<Crud>("create");
  const [name, setName] = useState("ของขวัญ");
  const [kind, setKind] = useState("รายจ่าย");
  const [active, setActive] = useState(true);
  const [rowId, setRowId] = useState("");
  const [field, setField] = useState<"name" | "kind" | "active">("kind");
  const [value, setValue] = useState("");
  const selected = categories.find((item) => String(item.id) === rowId) ?? categories[0];
  const rowPicker = <Select label="แถว" value={selected ? String(selected.id) : ""} onChange={setRowId}>
    {categories.map((item) => <option key={item.id} value={item.id}>ID {item.id} · {item.name}</option>)}
  </Select>;
  return <Section title="ลองกับตารางหมวด">
    <Segmented label="สิ่งที่จะทำ" value={tab} onChange={setTab}
      options={[{ value: "create", label: "เพิ่ม" }, { value: "read", label: "ดู" }, { value: "update", label: "แก้" }, { value: "delete", label: "ลบ" }]} />
    <div className="space-y-2 pt-1">
      {tab === "create" && <>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label="ชื่อ" value={name} onChange={setName} />
          <Field label="ประเภท (รายรับ / รายจ่าย)" value={kind} onChange={setKind} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> ใช้อยู่</label>
        <Action primary icon={<Plus size={14} />} disabled={!writable} onClick={() => run({ type: "category.create", name, kind, active })}>เพิ่มหมวด</Action>
        <p className="text-[11px] text-slate-400">ลองใส่ประเภทเป็น “ออม” ดูว่าติดด่าน</p>
      </>}
      {tab === "read" && <Action primary icon={<Eye size={14} />} disabled={!writable} onClick={() => run({ type: "category.read", computer: "A" })}>ดูหมวดทั้งหมด</Action>}
      {tab === "update" && <>
        {rowPicker}
        <Segmented label="ช่อง" value={field} onChange={(next) => { setField(next); setValue(""); }}
          options={[{ value: "name", label: "ชื่อ" }, { value: "kind", label: "ประเภท" }, { value: "active", label: "ใช้อยู่" }]} />
        {field === "active"
          ? <Segmented label="ค่าใหม่" value={value === "false" ? "false" : "true"} onChange={setValue} options={[{ value: "true", label: "ใช่" }, { value: "false", label: "ไม่ใช่" }]} />
          : <Field label="ค่าใหม่" value={value} onChange={setValue} placeholder={field === "kind" ? "รายรับ หรือ รายจ่าย" : "ชื่อใหม่"} />}
        <Action primary icon={<Pencil size={14} />} disabled={!writable || !selected}
          onClick={() => selected && run({ type: "category.update", id: selected.id, field, value: field === "active" ? value || "true" : value })}>แก้ช่องนี้</Action>
      </>}
      {tab === "delete" && <>
        {rowPicker}
        <Action danger icon={<Trash2 size={14} />} disabled={!writable || !selected} onClick={() => selected && run({ type: "category.delete", id: selected.id })}>ลบแถวนี้</Action>
      </>}
    </div>
  </Section>;
}

type RelationTab = "rename" | "record" | "delete";

/** A rename that makes the stale copies obvious: “อาหาร” → “อาหารและเครื่องดื่ม”. */
const suggestedName = (name: string) => (name === "อาหาร" ? "อาหารและเครื่องดื่ม" : `${name} (ใหม่)`);

function RelationControls({ state, writable, run }: Props) {
  const { categories, transactions } = state;
  const [tab, setTab] = useState<RelationTab>("rename");
  // Starts on “อาหาร” (two transactions) and stays on that row after it is renamed.
  const [categoryId, setCategoryId] = useState(() => String(categories.find((item) => item.name === "อาหาร")?.id ?? ""));
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("100");
  const category = categories.find((item) => String(item.id) === categoryId) ?? categories[0];
  const id = category?.id ?? 0;
  const stale = category ? transactions.filter((row) => row.categoryId === id && row.copiedName !== category.name).length : 0;
  const owned = transactions.filter((row) => row.categoryId === id).length;
  const user = COMPUTER_USER.A;
  return <Section title="ลองกับหมวด">
    <Select label="หมวด" value={category ? String(id) : ""} onChange={setCategoryId}>
      {categories.map((entry) => <option key={entry.id} value={entry.id}>#{entry.id} · {entry.name}</option>)}
    </Select>
    <Segmented label="สิ่งที่จะทำ" value={tab} onChange={setTab}
      options={[{ value: "rename", label: "แก้ชื่อ" }, { value: "record", label: "บันทึกใหม่" }, { value: "delete", label: "ลบ" }]} />
    <div className="space-y-2 pt-1">
      {tab === "rename" && <>
        <Field label="ชื่อใหม่" value={name} onChange={setName} placeholder={category ? suggestedName(category.name) : ""} />
        <Action primary icon={<Pencil size={14} />} disabled={!writable || !category} onClick={() => run({ type: "category.rename", id, name: name || suggestedName(category?.name ?? "") })}>เปลี่ยนชื่อ</Action>
        {stale > 0 && <Action icon={<Copy size={14} />} disabled={!writable} count={stale} onClick={() => run({ type: "transactions.fixCopies", categoryId: id })}>ตามแก้ชื่อหมวดที่ก๊อปไว้</Action>}
      </>}
      {tab === "record" && <>
        <Field label="จำนวนเงิน (บาท)" value={amount} onChange={setAmount} />
        <Action primary icon={<Wallet size={14} />} disabled={!writable || !category} onClick={() => run({ type: "transaction.create", userId: user, categoryId: id, amount })}>
          {category ? `${userName(state, user)} บันทึก${category.name}` : "บันทึกรายการ"}</Action>
      </>}
      {tab === "delete" && <>
        <Action danger icon={<Trash2 size={14} />} disabled={!writable || !category} onClick={() => run({ type: "category.deleteLinked", id })}>ลบหมวดนี้</Action>
        {owned > 0 && <Action icon={<Trash2 size={14} />} disabled={!writable} count={owned} onClick={() => run({ type: "transactions.deleteOfCategory", categoryId: id })}>ลบรายการของหมวดนี้ก่อน</Action>}
      </>}
    </div>
  </Section>;
}

function AccessControls({ state, writable, run }: Props) {
  const names: Record<ComputerId, string> = { A: userName(state, COMPUTER_USER.A), B: userName(state, COMPUTER_USER.B) };
  return <>
    <Section title="กฎสิทธิ์ (RLS)">
      <Segmented label="กฎสิทธิ์" value={state.rulesOn} disabled={!writable} onChange={(on: boolean) => run({ type: "access.rules", on })}
        options={[{ value: true, label: "เปิด", tone: "good" }, { value: false, label: "ปิด", tone: "bad" }]} />
    </Section>
    <Section title="ให้ผู้ใช้ขอดูข้อมูล">
      <div className="space-y-1.5">
        {(["A", "B"] as const).map((computer) => <div key={computer} className="grid grid-cols-[72px_1fr_1fr] items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-slate-600" title={names[computer]}>{computer} · {names[computer]}</span>
          <Action primary={computer === "B"} disabled={!writable} onClick={() => run({ type: "access.read", computer, table: "transactions" })}>ดูรายการ</Action>
          <Action disabled={!writable} onClick={() => run({ type: "access.read", computer, table: "categories" })}>ดูหมวด</Action>
        </div>)}
      </div>
    </Section>
  </>;
}
