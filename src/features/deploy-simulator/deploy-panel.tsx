"use client";

import { useId, type JSX } from "react";
import { Bug, Coffee, Globe, History, KeyRound, Pencil, Power, Rocket, Send, Smartphone, Wand2 } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import type { DeploySimulatorNode } from "@/domain/document/model";
import type { DeployAction, DeployState, DeployView } from "@/domain/deploy/model";
import { applyDeployAction, deploymentOf } from "@/domain/deploy/reducer";
import { useEditorStore } from "@/features/editor/store";
import { Action, PanelHeader, PlaybackControls, ResetLink, ResultMessage, Section, Segmented, StepSelect } from "@/features/flow/flow-panel-parts";
import { useFlowSession } from "@/features/flow/flow-session";
import { DEPLOY_VIEWS } from "./deploy-layout";

/** The node as currently stored, so actions never start from a stale render. */
function latestNode(slideId: string, nodeId: string): DeploySimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "deploy-simulator" ? node : null;
}

const ACTION_LABEL: Record<DeployAction["type"], string> = {
  "local.start": "เปิดเว็บในเครื่อง", "local.stop": "ปิดเว็บในเครื่อง", "code.edit": "แก้โค้ด", "friend.localhost": "เพื่อนเปิด localhost",
  push: "ส่งโค้ดขึ้น", "friend.visit": "เพื่อนเปิดเว็บ", rollback: "ย้อนรุ่น", "env.setVercel": "กุญแจบน Vercel", "env.setLocal": "กุญแจใน .env.local",
  redeploy: "Deploy ใหม่", "friend.order": "เพื่อนสั่งกาแฟ", "local.order": "สั่งกาแฟในเครื่อง", "overall.prepare": "เตรียมเว็บให้พร้อม", reset: "เริ่มใหม่",
};
/** Page titles for “แก้โค้ด” (never a revision number: the board shows “รุ่น N” separately). */
const HEADLINES = ["ร้านกาแฟ เปิดแล้ว", "ร้านกาแฟ เมนูใหม่", "ร้านกาแฟ ลด 10%", "ร้านกาแฟ"];
const MENU = ["ลาเต้", "อเมริกาโน่", "ชาเขียว", "มอคค่า"];

/** Small DOM panel of a deploy widget (plan 07 §4). Render with `key={node.id}`. */
export function DeployPanel({ node, slideId, writable, transact }: {
  node: DeploySimulatorNode;
  slideId: string;
  writable: boolean;
  transact: (tx: DocumentTransaction) => boolean;
}): JSX.Element {
  const ids = useId();
  const nodeId = node.id;
  const { state, view } = node;
  const result = useFlowSession((s) => s.results[nodeId]);
  const flow = useFlowSession.getState();

  const run = (action: DeployAction) => {
    if (!writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    const transition = applyDeployAction(latest.state, action, latest.view);
    if (transition.changed && !transact({
      label: `Deploy (จำลอง): ${ACTION_LABEL[action.type]}`,
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

  const changeView = (next: DeployView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = latestNode(slideId, nodeId) ?? node;
    // Screens show the answer of the last action; a new step starts with empty screens.
    const cleared: DeployState = { ...latest.state, friend: { title: "", lines: [], tone: "empty" }, laptop: { lines: [] } };
    if (transact({ label: "Deploy (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, view: next, state: cleared }] }] })) {
      flow.stop(nodeId);
      flow.setResult(nodeId, undefined);
    }
  };

  const props = { state, writable, run };
  return <section className="space-y-4 p-4 text-sm" aria-label="ตัวจำลอง Deploy">
    <PanelHeader icon={<Rocket size={16} />} color="bg-slate-900" title="การ Deploy" />
    <StepSelect id={ids} value={view} steps={DEPLOY_VIEWS} disabled={!writable} onChange={changeView} />
    {view === "local" && <LocalControls {...props} />}
    {view === "localEnv" && <LocalEnvControls {...props} />}
    {view === "vercel" && <VercelControls {...props} />}
    {view === "env" && <EnvControls {...props} />}
    {view === "overall" && <OverallControls {...props} />}
    <PlaybackControls nodeId={nodeId} />
    <ResultMessage result={result} />
    <ResetLink title="กลับไปก่อน Deploy ครั้งแรก (เลิกทำได้)" disabled={!writable} onClick={() => run({ type: "reset" })} />
  </section>;
}

// ---------------------------------------------------------------------------
// Controls per lesson step: short labels with icons; the board's caption explains each beat.
// ---------------------------------------------------------------------------

type Props = { state: DeployState; writable: boolean; run: (action: DeployAction) => void };

const nextHeadline = (state: DeployState) => HEADLINES.find((item) => item !== state.code.title) ?? HEADLINES[0];
const nextItem = (state: DeployState) => MENU[state.orders.length % MENU.length];

function ServerToggle({ state, writable, run }: Props) {
  return state.local.running
    ? <Action icon={<Power size={14} />} disabled={!writable} onClick={() => run({ type: "local.stop" })}>ปิดเว็บในเครื่อง</Action>
    : <Action primary icon={<Power size={14} />} disabled={!writable} onClick={() => run({ type: "local.start" })}>เปิดเว็บในเครื่อง</Action>;
}

function LocalControls(props: Props) {
  const { state, writable, run } = props;
  return <Section title="ลองกด">
    <div className="space-y-1.5">
      <ServerToggle {...props} />
      <Action icon={<Pencil size={14} />} disabled={!writable} onClick={() => run({ type: "code.edit", title: nextHeadline(state), broken: false })}>แก้โค้ด</Action>
      <Action icon={<Smartphone size={14} />} disabled={!writable} onClick={() => run({ type: "friend.localhost" })}>เพื่อนเปิด localhost</Action>
    </div>
  </Section>;
}

function LocalEnvControls(props: Props) {
  const { state, writable, run } = props;
  const item = nextItem(state);
  return <>
    <Section title="กุญแจใน .env.local">
      <Segmented label="กุญแจใน .env.local" value={state.keys.local} disabled={!writable} onChange={(on: boolean) => run({ type: "env.setLocal", on })}
        options={[{ value: true, label: "มีกุญแจ", icon: <KeyRound size={13} />, tone: "good" }, { value: false, label: "ไม่มี", tone: "bad" }]} />
    </Section>
    <Section title="ลองกด">
      <div className="space-y-1.5">
        {!state.local.running && <ServerToggle {...props} />}
        <Action primary={state.local.running} icon={<Coffee size={14} />} disabled={!writable || !state.local.running} onClick={() => run({ type: "local.order", item })}>สั่ง{item}บนเว็บในเครื่อง</Action>
      </div>
    </Section>
  </>;
}

function ShipActions({ state, writable, run }: Props) {
  const pending = state.github.rev !== state.code.rev;
  return <>
    <Action icon={<Pencil size={14} />} disabled={!writable} onClick={() => run({ type: "code.edit", title: nextHeadline(state), broken: false })}>แก้โค้ด</Action>
    <Action primary={pending} icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push" })}>ส่งโค้ดขึ้น (Deploy)</Action>
  </>;
}

function VercelControls(props: Props) {
  const { state, writable, run } = props;
  const live = deploymentOf(state, state.production);
  const canRollback = Boolean(live && state.deployments.some((item) => item.ok && item.id < live.id));
  return <>
    <Section title="ส่งโค้ด">
      <div className="space-y-1.5">
        <ShipActions {...props} />
        <Action icon={<Bug size={14} />} disabled={!writable} onClick={() => run({ type: "code.edit", title: nextHeadline(state), broken: true })}>แก้โค้ดแบบพิมพ์ผิด</Action>
      </div>
    </Section>
    <Section title="เว็บจริง">
      <div className="space-y-1.5">
        <Action icon={<Globe size={14} />} disabled={!writable} onClick={() => run({ type: "friend.visit" })}>เพื่อนเปิดเว็บจริง</Action>
        <Action icon={<History size={14} />} disabled={!writable || !canRollback} onClick={() => run({ type: "rollback" })}>ย้อนไปรุ่นก่อน</Action>
      </div>
    </Section>
  </>;
}

function EnvControls(props: Props) {
  const { state, writable, run } = props;
  const item = nextItem(state);
  return <>
    <Section title="กุญแจบน Vercel">
      <Segmented label="กุญแจบน Vercel" value={state.keys.vercel} disabled={!writable} onChange={(on: boolean) => run({ type: "env.setVercel", on })}
        options={[{ value: true, label: "ใส่แล้ว", icon: <KeyRound size={13} />, tone: "good" }, { value: false, label: "ยังไม่ใส่", tone: "bad" }]} />
    </Section>
    <Section title="ลองกด">
      <div className="space-y-1.5">
        {state.code.broken && <Action icon={<Pencil size={14} />} disabled={!writable} onClick={() => run({ type: "code.edit", title: state.code.title, broken: false })}>แก้โค้ดให้ถูก</Action>}
        {state.github.rev === null || state.github.rev !== state.code.rev
          ? <Action primary icon={<Send size={14} />} disabled={!writable} onClick={() => run({ type: "push" })}>ส่งโค้ดขึ้น (Deploy)</Action>
          : <Action icon={<Rocket size={14} />} disabled={!writable} onClick={() => run({ type: "redeploy" })}>Deploy ใหม่</Action>}
        <Action primary={state.github.rev !== null} icon={<Coffee size={14} />} disabled={!writable} onClick={() => run({ type: "friend.order", item })}>เพื่อนสั่ง{item}บนเว็บจริง</Action>
        {state.local.running && <Action icon={<KeyRound size={14} />} disabled={!writable} onClick={() => run({ type: "local.order", item })}>สั่งบนเว็บในเครื่อง</Action>}
      </div>
    </Section>
  </>;
}

function OverallControls(props: Props) {
  const { state, writable, run } = props;
  const live = deploymentOf(state, state.production);
  const ready = Boolean(live?.hasKey) && !state.code.broken && state.github.rev === state.code.rev;
  const item = nextItem(state);
  return <>
    <Section title="ลองกด">
      <div className="space-y-1.5">
        {!ready && <Action icon={<Wand2 size={14} />} disabled={!writable} onClick={() => run({ type: "overall.prepare" })}>เตรียมเว็บให้พร้อม</Action>}
        <Action primary icon={<Coffee size={14} />} disabled={!writable} onClick={() => run({ type: "friend.order", item })}>เพื่อนสั่ง{item}บนเว็บจริง</Action>
      </div>
    </Section>
    <Section title="อัปเดตเว็บ">
      <div className="space-y-1.5"><ShipActions {...props} /></div>
    </Section>
  </>;
}
