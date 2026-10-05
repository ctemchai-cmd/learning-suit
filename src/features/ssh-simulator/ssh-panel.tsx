"use client";

import { useId, type JSX } from "react";
import { Fingerprint, GitPullRequestArrow, KeyRound, LaptopMinimal, Send, ShieldCheck, Trash2, UserRoundX } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { SshSimulatorNode } from "@/domain/document/model";
import { KEYGEN_COMMAND, type SshAction, type SshState, type SshView } from "@/domain/ssh/model";
import { applySshAction } from "@/domain/ssh/reducer";
import { useEditorStore } from "@/features/editor/store";
import { Action, PanelHeader, PlaybackControls, ResetLink, ResultMessage, Section, StepSelect } from "@/features/flow/flow-panel-parts";
import { useFlowSession } from "@/features/flow/flow-session";
import { SSH_VIEWS } from "./ssh-layout";

/** The node as currently stored, so actions never start from a stale render. */
function latestNode(slideId: string, nodeId: string): SshSimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "ssh-simulator" ? node : null;
}

const ACTION_LABEL: Record<SshAction["type"], string> = {
  keygen: "สร้างกุญแจ", register: "ลงทะเบียนกุญแจ", test: "ทดสอบการเชื่อมต่อ", push: "git push", "thief.try": "คนแอบคัดลอก .pub",
  revoke: "ลบกุญแจออกจาก GitHub", "b.setup": "เครื่อง B สร้างกุญแจและลงทะเบียน", reset: "เริ่มใหม่",
};

/** Small DOM panel of an SSH widget (plan 07 §4c). Render with `key={node.id}`. */
export function SshPanel({ node, slideId, writable, transact }: {
  node: SshSimulatorNode;
  slideId: string;
  writable: boolean;
  transact: (tx: DocumentTransaction) => boolean;
}): JSX.Element {
  const ids = useId();
  const nodeId = node.id;
  const { view } = node;
  const result = useFlowSession((s) => s.results[nodeId]);
  const flow = useFlowSession.getState();

  const run = (action: SshAction) => {
    if (!writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    const transition = applySshAction(latest.state, action, latest.view);
    if (transition.changed && !transact({
      label: `SSH (จำลอง): ${ACTION_LABEL[action.type]}`,
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

  const changeView = (next: SshView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    // Terminals show the answer of the last action; a new step starts with clean screens.
    const cleared: SshState = { ...latest.state, a: { ...latest.state.a, cmd: "", out: [] }, b: { ...latest.state.b, cmd: "", out: [] }, thief: "idle" };
    if (transact({ label: "SSH (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, view: next, state: cleared }] }] })) {
      flow.stop(nodeId);
      flow.setResult(nodeId, undefined);
    }
  };

  const props = { writable, run };
  return <section className="space-y-4 p-4 text-sm" aria-label="ตัวจำลอง SSH">
    <PanelHeader icon={<KeyRound size={16} />} color="bg-slate-900" title="SSH กุญแจของ GitHub" />
    <StepSelect id={ids} value={view} steps={SSH_VIEWS} disabled={!writable} onChange={changeView} />
    {view === "why" && <Section title="ลองกด"><div className="space-y-1.5">
      <Action primary icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>ส่งโค้ดขึ้น (git push)</Action>
    </div></Section>}
    {view === "keygen" && <KeygenControls {...props} />}
    {view === "register" && <Section title="ลองกด"><div className="space-y-1.5">
      <Action primary icon={<Fingerprint size={14} />} disabled={!writable} onClick={() => run({ type: "register", machine: "a" })}>คัดลอก .pub ไปใส่ GitHub</Action>
    </div></Section>}
    {view === "connect" && <Section title="ลองกด"><div className="space-y-1.5">
      <Action primary icon={<ShieldCheck size={14} />} disabled={!writable} onClick={() => run({ type: "test", machine: "a" })}>ทดสอบ ssh -T git@github.com</Action>
      <Action icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>git push</Action>
    </div></Section>}
    {view === "others" && <OthersControls {...props} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="กลับไปก่อนมีกุญแจ (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

type Props = { writable: boolean; run: (action: SshAction) => void };

function KeygenControls({ writable, run }: Props) {
  return <Section title="ลองกด">
    <div className="space-y-1.5">
      <p className="rounded-lg bg-slate-900 px-2.5 py-2 font-mono text-[11px] leading-snug text-slate-100" aria-label="คำสั่งสร้างกุญแจ">$ {KEYGEN_COMMAND}</p>
      <Action primary icon={<KeyRound size={14} />} disabled={!writable} onClick={() => run({ type: "keygen", machine: "a" })}>สร้างกุญแจ</Action>
    </div>
  </Section>;
}

function OthersControls({ writable, run }: Props) {
  return <>
    <Section title="เครื่องอื่นและคนแปลกหน้า">
      <div className="space-y-1.5">
        <Action primary icon={<LaptopMinimal size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "b" })}>เครื่อง B ส่งโค้ด</Action>
        <Action icon={<UserRoundX size={14} />} disabled={!writable} onClick={() => run({ type: "thief.try" })}>มีคนคัดลอก .pub ไปลองเข้า</Action>
      </div>
    </Section>
    <Section title="โน้ตบุ๊กหาย / เครื่องใหม่">
      <div className="space-y-1.5">
        <Action danger icon={<Trash2 size={14} />} disabled={!writable} onClick={() => run({ type: "revoke", machine: "a" })}>ทำโน้ตบุ๊ก A หาย → ลบกุญแจออกจาก GitHub</Action>
        <Action icon={<GitPullRequestArrow size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>เครื่อง A ส่งโค้ด</Action>
        <Action icon={<KeyRound size={14} />} disabled={!writable} onClick={() => run({ type: "b.setup" })}>เครื่อง B สร้างกุญแจของตัวเองแล้วลงทะเบียน</Action>
      </div>
    </Section>
  </>;
}
