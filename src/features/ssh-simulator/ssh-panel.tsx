"use client";

import { useId, type JSX, type ReactNode } from "react";
import { Fingerprint, GitPullRequestArrow, KeyRound, LaptopMinimal, Send, ShieldCheck, Trash2, UserRoundX } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { SshSimulatorNode } from "@/domain/document/model";
import { KEYGEN_COMMAND, normalizeSshView, type SshAction, type SshState, type SshView } from "@/domain/ssh/model";
import { applySshAction, hasKeys } from "@/domain/ssh/reducer";
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
  const view = normalizeSshView(node.view);
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
    <PanelHeader icon={<KeyRound size={16} />} color="bg-slate-900" title="กุญแจ SSH" />
    <StepSelect id={ids} value={view} steps={SSH_VIEWS} disabled={!writable} onChange={changeView} />
    {view === "setup" && <SetupControls state={node.state} {...props} />}
    {view === "others" && <OthersControls {...props} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="กลับไปก่อนมีกุญแจ (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

type Props = { writable: boolean; run: (action: SshAction) => void };

type Next = "try" | "keygen" | "register" | "connect";
/** The next useful card: nothing done yet → the demo; no key → create; not registered → register; else connect. */
export function nextCard(state: SshState): Next {
  if (!hasKeys(state, "a")) return !state.a.priv && state.a.cmd === "" && state.pushes === 0 ? "try" : "keygen";
  return state.registered.includes("a") ? "connect" : "register";
}

/** One numbered step of the guided setup. Highlighted when it is the next thing to do. */
function StepCard({ number, title, description, active, children }: { number: number; title: string; description: string; active: boolean; children: ReactNode }) {
  return <li className={`rounded-xl border p-3 transition-colors ${active ? "border-blue-300 bg-blue-50/70 shadow-sm shadow-blue-100" : "border-slate-200 bg-white"}`}>
    <div className="flex items-start gap-2.5">
      <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{number}</span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 font-semibold leading-6 text-slate-900">
          {title}{active && <span className="shrink-0 whitespace-nowrap rounded-full bg-blue-600/10 px-1.5 py-px text-[10px] font-semibold text-blue-700">ทำต่อ</span>}
        </h3>
        <p className="text-xs leading-snug text-slate-500">{description}</p>
      </div>
    </div>
    <div className="mt-2.5 space-y-1.5">{children}</div>
  </li>;
}

function SetupControls({ state, writable, run }: Props & { state: SshState }) {
  const next = nextCard(state);
  return <ol className="space-y-3" aria-label="ขั้นตอนเชื่อม GitHub ด้วย SSH">
    <StepCard number={1} title="ลอง push ก่อน" description="ยังไม่มีกุญแจ → โดนปฏิเสธ" active={next === "try"}>
      <Action primary={next === "try"} icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>ลอง git push</Action>
    </StepCard>
    <StepCard number={2} title="สร้างคู่กุญแจ" description="ลับ = นิ้วจริง · .pub = ลายนิ้วมือ" active={next === "keygen"}>
      <p className="rounded-lg bg-slate-900 px-2.5 py-2 font-mono text-[11px] leading-snug text-slate-100" aria-label="คำสั่งสร้างกุญแจ">$ {KEYGEN_COMMAND}</p>
      <Action primary={next === "keygen"} icon={<KeyRound size={14} />} disabled={!writable} onClick={() => run({ type: "keygen", machine: "a" })}>สร้างกุญแจ</Action>
    </StepCard>
    <StepCard number={3} title="ลงทะเบียน .pub" description="ทำครั้งเดียว" active={next === "register"}>
      <Action primary={next === "register"} icon={<Fingerprint size={14} />} disabled={!writable} onClick={() => run({ type: "register", machine: "a" })}>ใส่ .pub ใน GitHub</Action>
    </StepCard>
    <StepCard number={4} title="เชื่อมต่อ" description="แตะนิ้ว → ประตูเปิด" active={next === "connect"}>
      <Action primary={next === "connect"} icon={<ShieldCheck size={14} />} disabled={!writable} onClick={() => run({ type: "test", machine: "a" })}>ssh -T git@github.com</Action>
      <Action icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>git push</Action>
    </StepCard>
  </ol>;
}

function OthersControls({ writable, run }: Props) {
  return <>
    <Section title="เครื่องอื่น">
      <div className="space-y-1.5">
        <Action primary icon={<LaptopMinimal size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "b" })}>เครื่อง B ส่งโค้ด</Action>
        <Action icon={<UserRoundX size={14} />} disabled={!writable} onClick={() => run({ type: "thief.try" })}>คนคัดลอก .pub ลองเข้า</Action>
      </div>
    </Section>
    <Section title="เครื่องหาย / เครื่องใหม่">
      <div className="space-y-1.5">
        <Action danger icon={<Trash2 size={14} />} disabled={!writable} onClick={() => run({ type: "revoke", machine: "a" })}>A หาย → ลบกุญแจ A</Action>
        <Action icon={<GitPullRequestArrow size={14} />} disabled={!writable} onClick={() => run({ type: "push", machine: "a" })}>เครื่อง A ส่งโค้ด</Action>
        <Action icon={<KeyRound size={14} />} disabled={!writable} onClick={() => run({ type: "b.setup" })}>B ลงกุญแจของตัวเอง</Action>
      </div>
    </Section>
  </>;
}
