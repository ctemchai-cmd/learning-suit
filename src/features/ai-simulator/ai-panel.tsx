"use client";

import { useId, useState, type JSX } from "react";
import { Bot, Brain, Eraser, FilePlus2, FolderSync, Globe, Lightbulb, MessageSquarePlus, Send, ShieldQuestion, Terminal, Trash2, Wrench } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { AiSimulatorNode } from "@/domain/document/model";
import { AI_LIMITS, type AiAction, type AiState, type AiView } from "@/domain/ai/model";
import { CHAT_PRESETS, MEMORY_PRESETS, PUZZLES } from "@/domain/ai/chat";
import { applyAiAction } from "@/domain/ai/reducer";
import { useEditorStore } from "@/features/editor/store";
import { Action, PanelHeader, PlaybackControls, ResetLink, ResultMessage, Section, Segmented, StepSelect } from "@/features/flow/flow-panel-parts";
import { useFlowSession } from "@/features/flow/flow-session";
import { AI_VIEWS } from "./ai-layout";

/** The node as currently stored, so actions never start from a stale render. */
function latestNode(slideId: string, nodeId: string): AiSimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "ai-simulator" ? node : null;
}

const ACTION_LABEL: Record<AiAction["type"], string> = {
  "chat.send": "ส่งข้อความ", "chat.new": "เริ่มแชทใหม่", "think.set": "คิดก่อนตอบ", "think.ask": "ถามโจทย์",
  "memory.set": "Memory", "memory.send": "ส่งข้อความ", "memory.newChat": "เปิดแชทใหม่", "memory.clear": "ลบความจำ",
  "agent.web": "ถาม AI บนเว็บ", "agent.cc": "สั่ง Claude Code", "agent.reset": "ใส่บั๊กกลับ",
  "cc.start": "เปิด session ใหม่", "cc.say": "คุยกับ Claude Code", "cc.compact": "สรุปย่อ", "cc.forget": "ลบไฟล์ความจำ", reset: "เริ่มใหม่",
};

/** Small DOM panel of an AI widget (plan 07 §5). Everything is simulated: no request ever reaches an AI. Render with `key={node.id}`. */
export function AiPanel({ node, slideId, writable, transact }: {
  node: AiSimulatorNode;
  slideId: string;
  writable: boolean;
  transact: (tx: DocumentTransaction) => boolean;
}): JSX.Element {
  const ids = useId();
  const nodeId = node.id;
  const { state, view } = node;
  const result = useFlowSession((s) => s.results[nodeId]);
  const flow = useFlowSession.getState();

  const run = (action: AiAction) => {
    if (!writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    const transition = applyAiAction(latest.state, action);
    if (transition.changed && !transact({
      label: `AI (จำลอง): ${ACTION_LABEL[action.type]}`,
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

  const changeView = (next: AiView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    if (transact({ label: "AI (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, view: next }] }] })) {
      flow.stop(nodeId);
      flow.setResult(nodeId, undefined);
    }
  };

  const props = { state, writable, run, ids };
  return <section className="space-y-4 p-4 text-sm" aria-label="ตัวจำลอง AI">
    <PanelHeader icon={<Bot size={16} />} color="bg-violet-600" title="AI ทำงานยังไง" />
    <StepSelect id={ids} value={view} steps={AI_VIEWS} disabled={!writable} onChange={changeView} />
    {view === "history" && <HistoryControls {...props} />}
    {view === "thinking" && <ThinkingControls {...props} />}
    {view === "memory" && <MemoryControls {...props} />}
    {view === "agent" && <AgentControls {...props} />}
    {view === "ccMemory" && <CcMemoryControls {...props} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="ล้างแชท ความจำ และโปรเจกต์ตัวอย่างทั้งหมด (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

// ---------------------------------------------------------------------------

type Props = { state: AiState; writable: boolean; run: (action: AiAction) => void; ids: string };

/** Preset messages + a line to type one's own. */
function Composer({ presets, writable, onSend, id }: { presets: readonly string[]; writable: boolean; onSend: (text: string) => void; id: string }) {
  const [draft, setDraft] = useState("");
  const send = () => { const text = draft.trim(); if (!text) return; onSend(text); setDraft(""); };
  return <Section title="ส่งข้อความ">
    <div className="space-y-1.5">
      {presets.map((text) => <Action key={text} icon={<Send size={13} />} disabled={!writable} onClick={() => onSend(text)}>{text}</Action>)}
    </div>
    <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <label htmlFor={`${id}-draft`} className="sr-only">พิมพ์ข้อความเอง</label>
      <input id={`${id}-draft`} className="field !py-1.5 text-sm" value={draft} maxLength={AI_LIMITS.inputCodePoints} placeholder="หรือพิมพ์เอง เช่น ผมชื่อ…" disabled={!writable}
        onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" disabled={!writable || !draft.trim()} className="app-button app-button-primary !px-3" aria-label="ส่งข้อความที่พิมพ์"><Send size={15} /></button>
    </form>
  </Section>;
}

function HistoryControls({ writable, run, ids }: Props) {
  return <>
    <Composer id={ids} presets={CHAT_PRESETS} writable={writable} onSend={(text) => run({ type: "chat.send", text })} />
    <p className="text-xs text-slate-500">AI รับได้ {AI_LIMITS.window} ข้อความล่าสุด: ลองแนะนำตัว คุยต่ออีกหน่อย แล้วถามชื่อ</p>
    <Action icon={<MessageSquarePlus size={14} />} disabled={!writable} onClick={() => run({ type: "chat.new" })}>เริ่มแชทใหม่ (ล้างประวัติ)</Action>
  </>;
}

function ThinkingControls({ state, writable, run }: Props) {
  return <>
    <Section title="คิดก่อนตอบ (Chain of Thought)">
      <Segmented label="คิดก่อนตอบ" value={state.thinking.on} disabled={!writable} onChange={(on: boolean) => run({ type: "think.set", on })}
        options={[{ value: false, label: "ปิด: ตอบทันที", tone: "bad" }, { value: true, label: "💭 เปิด", tone: "good" }]} />
    </Section>
    <Section title="ถามโจทย์">
      <div className="space-y-1.5">
        {PUZZLES.map((puzzle) => <Action key={puzzle.id} icon={<Lightbulb size={14} />} disabled={!writable} onClick={() => run({ type: "think.ask", puzzle: puzzle.id })}>{puzzle.label}</Action>)}
      </div>
    </Section>
  </>;
}

function MemoryControls({ state, writable, run, ids }: Props) {
  return <>
    <Section title="Memory ของแอป">
      <Segmented label="Memory ของแอป" value={state.memory.on} disabled={!writable} onChange={(on: boolean) => run({ type: "memory.set", on })}
        options={[{ value: true, label: "🗂 เปิด", tone: "good" }, { value: false, label: "ปิด", tone: "bad" }]} />
    </Section>
    <Composer id={ids} presets={MEMORY_PRESETS} writable={writable} onSend={(text) => run({ type: "memory.send", text })} />
    <div className="space-y-1.5">
      <Action primary icon={<MessageSquarePlus size={14} />} disabled={!writable} onClick={() => run({ type: "memory.newChat" })}>เปิดแชทใหม่</Action>
      <Action danger icon={<Trash2 size={14} />} disabled={!writable || !state.memory.items.length} onClick={() => run({ type: "memory.clear" })}>ลบความจำทั้งหมด</Action>
    </div>
  </>;
}

function AgentControls({ state, writable, run }: Props) {
  const fixed = state.agent.code === "fixed" && state.agent.tests === "pass";
  return <Section title="ลองกด">
    <div className="space-y-1.5">
      <Action icon={<Globe size={14} />} disabled={!writable} onClick={() => run({ type: "agent.web" })}>ถาม AI บนเว็บ</Action>
      <Action primary={!fixed} icon={<Terminal size={14} />} disabled={!writable || fixed} onClick={() => run({ type: "agent.cc" })}>สั่ง Claude Code แก้บั๊ก</Action>
      <Action icon={<Wrench size={14} />} disabled={!writable} onClick={() => run({ type: "agent.reset" })}>ใส่บั๊กกลับ (ลองใหม่)</Action>
    </div>
  </Section>;
}

function CcMemoryControls({ state, writable, run }: Props) {
  const open = state.cc.session > 0;
  return <>
    <Section title="Session">
      <Action primary={!open} icon={<FolderSync size={14} />} disabled={!writable} onClick={() => run({ type: "cc.start" })}>{open ? "ปิดแล้วเปิด session ใหม่" : "เปิด session ใหม่"}</Action>
    </Section>
    <Section title="คุยกับ Claude Code">
      <div className="space-y-1.5">
        <Action icon={<Brain size={14} />} disabled={!writable || !open} onClick={() => run({ type: "cc.say", say: "thai" })}>บอก: ตอบเป็นภาษาไทยเสมอนะ</Action>
        <Action icon={<FilePlus2 size={14} />} disabled={!writable || !open} onClick={() => run({ type: "cc.say", say: "work" })}>สั่งงานใหญ่ (ใช้ context เยอะ)</Action>
        <Action icon={<ShieldQuestion size={14} />} disabled={!writable || !open} onClick={() => run({ type: "cc.say", say: "ask" })}>ถาม: ต้องตอบเป็นภาษาอะไร?</Action>
        <Action icon={<Eraser size={14} />} disabled={!writable || !open} onClick={() => run({ type: "cc.compact" })}>/compact สรุปย่อ</Action>
      </div>
    </Section>
    <Action danger icon={<Trash2 size={14} />} disabled={!writable || !state.cc.memories.length} onClick={() => run({ type: "cc.forget" })}>ลบไฟล์ความจำ</Action>
  </>;
}
