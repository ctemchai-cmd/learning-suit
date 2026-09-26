"use client";

import { useId, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, CircleCheck, CopyPlus, GitBranch, GitCommitHorizontal, GitMerge, Info, PackagePlus, RotateCcw, TriangleAlert, Undo2 } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import { fitBounds } from "@/domain/document/camera";
import { gitNodeSize, gitViewOf, type GitSimulatorNode, type GitView } from "@/domain/document/model";
import { useEditorStore } from "@/features/editor/store";
import { applyGitAction } from "@/domain/git/reducer";
import { RESET_TOOLTIP, describeGitTransition, repositoryLabel } from "@/domain/git/messages";
import type { GitAction, MachineId } from "@/domain/git/model";
import { isDiverged } from "@/domain/git/selectors";
import { findGitNode, gitDraftFor } from "./git-draft";
import { messageKey, nextTransferKey, useGitSessionStore } from "./session-store";
import { READ_ONLY_REASON, getActionAvailability, nextGitStep, projectState, type Availability } from "./view-model";
import { GIT_VIEWS } from "./widget-layout";

const ACTION_NAMES: Record<GitAction["type"], string> = {
  edit: "แก้ไฟล์", stage: "Add", commit: "Commit", push: "Push", clone: "Clone", pull: "Pull",
  merge: "Merge", resetToRemote: "ใช้เวอร์ชัน GitHub", reset: "Reset demo",
};

function transactionLabel(action: GitAction): string {
  const where = action.type === "reset" ? "" : ` ${repositoryLabel(action.machine)}`;
  return `Git (จำลอง): ${ACTION_NAMES[action.type]}${where}`;
}

/** Step 3 is wider: after a step change, zoom out (never in) or pan so the whole widget stays on screen. */
function keepOnScreen(node: GitSimulatorNode) {
  const state = useEditorStore.getState();
  const slideId = state.activeSlideId;
  const { width: viewportWidth, height: viewportHeight } = state.viewport;
  if (!slideId || viewportWidth <= 0) return;
  const size = gitNodeSize(node);
  const bounds = { x: node.x, y: node.y, width: size.width * node.scale, height: size.height * node.scale };
  const camera = state.cameras[slideId] ?? { x: viewportWidth / 2, y: viewportHeight / 2, zoom: 1 };
  const fit = fitBounds(bounds, state.viewport, 24);
  if (fit.zoom < camera.zoom) { state.setCamera(slideId, fit); return; }
  const left = bounds.x * camera.zoom + camera.x, top = bounds.y * camera.zoom + camera.y;
  const inside = left >= 0 && top >= 0 && left + bounds.width * camera.zoom <= viewportWidth && top + bounds.height * camera.zoom <= viewportHeight;
  if (!inside) state.setCamera(slideId, { ...fit, zoom: camera.zoom, x: viewportWidth / 2 - (bounds.x + bounds.width / 2) * camera.zoom, y: viewportHeight / 2 - (bounds.y + bounds.height / 2) * camera.zoom });
}

function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Small DOM panel of one Git simulator widget (plan 04 §5): lesson step, Add, Commit and — from step 2 —
 * Push / Pull / Clone. The file itself is edited on the board and commits are previewed by clicking them there.
 * Render with `key={node.id}`.
 */
export function GitPanel({ node, slideId, writable, transact }: {
  node: GitSimulatorNode;
  slideId: string;
  writable: boolean;
  transact: (tx: DocumentTransaction) => boolean;
}): JSX.Element {
  const nodeId = node.id;
  const state = node.state;
  const ids = useId();
  const view = gitViewOf(node);
  const storedTab = useGitSessionStore((s) => s.tabs[nodeId] ?? "A");
  // Only step 3 has a second machine.
  const machine: MachineId = view === "full" && storedTab === "B" ? "B" : "A";
  const result = useGitSessionStore((s) => s.results[nodeId]);
  const message = useGitSessionStore((s) => s.messages[messageKey(nodeId, machine)] ?? "");
  const draft = useEditorStore((s) => gitDraftFor(s.pendingEdit, nodeId, machine)?.draft ?? null);
  const { setTab, setResult, startTransfer, setMessage, clearNode } = useGitSessionStore.getState();
  const availability = getActionAvailability({ state, machine, draft, message, writable });
  const repo = state.machines[machine];

  const runAction = (action: GitAction) => {
    // The file typed on the board is applied first, as its own Edit step.
    if (!useEditorStore.getState().flushPendingEdits()) return;
    const latest = findGitNode(slideId, nodeId) ?? node;
    const transition = applyGitAction(latest.state, action);
    if (transition.changed && !transact({
      label: transactionLabel(action),
      affectedSlideId: slideId,
      commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, state: transition.nextState }] }],
    })) {
      setResult(nodeId, { code: transition.code, outcome: "rejected", message: `${ACTION_NAMES[action.type]} ไม่สำเร็จ: โปรเจกต์อ่านอย่างเดียวหรือข้อมูลไม่ผ่านการตรวจ` });
      return;
    }
    if (action.type === "reset" && transition.changed) clearNode(nodeId);
    setResult(nodeId, { code: transition.code, outcome: transition.outcome, message: describeGitTransition(action, transition) });
    if (transition.transfer) startTransfer(nodeId, { ...transition.transfer, key: nextTransferKey() });
    if (action.type === "commit" && transition.code === "COMMITTED") setMessage(nodeId, action.machine, "");
  };

  const changeView = (next: GitView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = findGitNode(slideId, nodeId) ?? node;
    const changed = { ...latest, view: next };
    if (transact({ label: "Git (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [changed] }] })) keepOnScreen(changed);
  };

  const onMessageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposing(event)) return;
    event.preventDefault();
    if (availability.commit.enabled) runAction({ type: "commit", machine, message });
  };

  const showRemote = view !== "local";
  const diverged = showRemote && isDiverged(state, machine);
  const projected = projectState(state, machine, draft).state;
  const next = nextGitStep(projected, machine, availability, showRemote);
  const readOnlyId = `${ids}-read-only`;
  const reasonsOf = (key: string, items: [string, Availability][]) => ({ key, items, prefix: ids, readOnlyId });

  return <section className="space-y-5 p-4 text-sm" aria-label="ตัวจำลอง Git">
    <header className="flex items-start gap-3">
      <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white"><GitBranch size={18} /></span>
      <div className="min-w-0">
        <h2 className="font-semibold leading-5 text-slate-900">Git <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-slate-500">จำลอง</span></h2>
        <p className="mt-1 text-xs leading-snug text-slate-500">พิมพ์โค้ดในกล่องไฟล์บนกระดาน • คลิกวง commit เพื่อดูโค้ดรุ่นนั้น</p>
      </div>
    </header>

    {!writable && <p id={readOnlyId} className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{READ_ONLY_REASON}: ดูได้อย่างเดียว</p>}

    <div className="space-y-1.5">
      <label htmlFor={`${ids}-view`} className="block text-xs font-semibold text-slate-500">ขั้นของบทเรียน</label>
      <div className="relative">
        <select id={`${ids}-view`} value={view} disabled={!writable} aria-describedby={`${ids}-view-description`}
          onChange={(event) => changeView(event.target.value as GitView)}
          className="w-full appearance-none truncate rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-[13px] font-semibold text-slate-800 shadow-sm outline-none transition-colors hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30">
          {GIT_VIEWS.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.label}</option>)}
        </select>
        <ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
      <p id={`${ids}-view-description`} className="text-[11px] leading-snug text-slate-500">{GIT_VIEWS.find((item) => item.id === view)?.description}</p>
    </div>

    <div className="space-y-2">
      {view === "full" && <div role="group" aria-label="ใช้งานเครื่อง" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["A", "B"] as const).map((id) => <button key={id} type="button" aria-pressed={machine === id}
          className={`rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors ${machine === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          onClick={() => { if (useEditorStore.getState().flushPendingEdits()) setTab(nodeId, id); }}>{repositoryLabel(id)}</button>)}
      </div>}
      <p className="text-xs font-semibold text-slate-500">ขั้นตอนบน{repositoryLabel(machine)}</p>

      {diverged && <section aria-labelledby={`${ids}-merge-title`} className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 shadow-sm shadow-amber-100">
        <h3 id={`${ids}-merge-title`} className="flex items-center gap-1.5 font-semibold leading-6 text-amber-950"><GitMerge size={16} aria-hidden />ประวัติแยกกัน</h3>
        <p className="text-xs leading-snug text-amber-900/80">ต่างคนต่าง Commit ไฟล์เดียวกัน Merge แล้วจะเก็บไฟล์ของใคร? (คลิกวง commit บนกระดานเพื่อดูแต่ละฝั่ง)</p>
        <div className="mt-2.5 space-y-2">
          <ActionButton id={`${ids}-merge-ours`} reasonId={`${ids}-merge-reason`} label="Merge: เก็บไฟล์ของเรา" icon={<GitMerge size={15} />} variant={next === "merge" ? "next" : "default"}
            availability={availability.merge} readOnlyId={readOnlyId} onRun={() => runAction({ type: "merge", machine, keep: "ours" })} />
          <ActionButton id={`${ids}-merge-theirs`} reasonId={`${ids}-merge-reason`} label="Merge: ใช้ไฟล์จาก GitHub" icon={<GitMerge size={15} />}
            availability={availability.merge} readOnlyId={readOnlyId} onRun={() => runAction({ type: "merge", machine, keep: "theirs" })} />
        </div>
        {visibleReasons(availability.merge).length > 0 && <p id={`${ids}-merge-reason`} className="mt-2 text-[11px] leading-snug text-amber-900/80">{visibleReasons(availability.merge).join(" • ")}</p>}
        <div className="mt-1.5 flex justify-end">
          <ActionButton id={`${ids}-reset-remote`} label="ทิ้งงานของเรา ใช้เวอร์ชัน GitHub" icon={<Undo2 size={13} />} variant="link"
            title="ทิ้ง commit และการแก้ที่ยังไม่ได้ Push ของเครื่องนี้ ย้อนกลับด้วย Undo ได้"
            availability={availability.resetToRemote} readOnlyId={readOnlyId} onRun={() => runAction({ type: "resetToRemote", machine })} />
        </div>
      </section>}

      {!repo.initialized ? <ol className="space-y-3">
        <StepCard number={1} title="Clone" description="คัดลอกไฟล์และ commit จาก GitHub" active={availability.clone.enabled}
          reasons={reasonsOf("clone", [["", availability.clone]])}>
          <ActionButton id={`${ids}-clone`} label="Clone" icon={<CopyPlus size={15} />} variant={availability.clone.enabled ? "next" : "default"}
            availability={availability.clone} readOnlyId={readOnlyId} onRun={() => runAction({ type: "clone", machine: "B" })} />
        </StepCard>
      </ol> : <ol className="space-y-3">
        <StepCard number={1} title="Add" description="เก็บไฟล์ที่แก้ลง Staging" active={next === "stage"}
          reasons={reasonsOf("stage", [["", availability.stage]])}>
          <ActionButton id={`${ids}-stage`} label="Add" icon={<PackagePlus size={15} />} variant={next === "stage" ? "next" : "default"}
            availability={availability.stage} readOnlyId={readOnlyId} onRun={() => runAction({ type: "stage", machine })} />
        </StepCard>
        <StepCard number={2} title="Commit" description="บันทึกสิ่งที่ Add เป็น commit" active={next === "commit"}
          reasons={reasonsOf("commit", [["", availability.commit]])}>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">ข้อความ Commit</span>
            <input className="field !py-2" value={message} readOnly={!writable} placeholder="เช่น แก้คำทักทาย"
              onChange={(event) => setMessage(nodeId, machine, event.target.value)} onKeyDown={onMessageKeyDown} />
          </label>
          <ActionButton id={`${ids}-commit`} label="Commit" icon={<GitCommitHorizontal size={15} />} variant={next === "commit" ? "next" : "default"}
            availability={availability.commit} readOnlyId={readOnlyId} onRun={() => runAction({ type: "commit", machine, message })} />
        </StepCard>
        {showRemote && <StepCard number={3} title="GitHub" description="Push ส่งขึ้น • Pull รับลงมา" active={next === "push" || next === "pull"}
          reasons={reasonsOf("remote", [["Push", availability.push], ["Pull", availability.pull]])}>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton id={`${ids}-push`} reasonId={`${ids}-remote-reason`} label="Push" icon={<ArrowUpFromLine size={15} />} variant={next === "push" ? "next" : "default"}
              availability={availability.push} readOnlyId={readOnlyId} onRun={() => runAction({ type: "push", machine })} />
            <ActionButton id={`${ids}-pull`} reasonId={`${ids}-remote-reason`} label="Pull" icon={<ArrowDownToLine size={15} />} variant={next === "pull" ? "next" : "default"}
              availability={availability.pull} readOnlyId={readOnlyId} onRun={() => runAction({ type: "pull", machine })} />
          </div>
        </StepCard>}
      </ol>}
    </div>

    <ResultMessage result={result} />

    <footer className="flex justify-end border-t border-slate-100 pt-3">
      <ActionButton id={`${ids}-reset`} label="Reset demo" icon={<RotateCcw size={13} />} title={RESET_TOOLTIP} variant="link"
        availability={availability.reset} readOnlyId={readOnlyId} onRun={() => runAction({ type: "reset" })} />
    </footer>
  </section>;
}

// ---------------------------------------------------------------------------

type ReasonList = { key: string; items: [string, Availability][]; prefix: string; readOnlyId: string };
/** Reasons shown inside a card; the read-only reason is shown once at the top of the panel instead. */
const visibleReasons = (availability: Availability) => availability.reasons.filter((reason) => reason !== READ_ONLY_REASON);

/** One numbered step of the workflow. Highlighted when it is the next thing to do. */
function StepCard({ number, title, description, active, reasons, children }: {
  number: number;
  title: string;
  description: string;
  active: boolean;
  reasons: ReasonList;
  children: ReactNode;
}) {
  const disabled = reasons.items.filter(([, availability]) => !availability.enabled && visibleReasons(availability).length);
  return <li className={`rounded-xl border p-3 transition-colors ${active ? "border-blue-300 bg-blue-50/70 shadow-sm shadow-blue-100" : "border-slate-200 bg-white"}`}>
    <div className="flex items-start gap-2.5">
      <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{number}</span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-1.5 font-semibold leading-6 text-slate-900">
          {title}{active && <span className="rounded-full bg-blue-600/10 px-1.5 py-px text-[10px] font-semibold text-blue-700">ทำต่อ</span>}
        </h3>
        <p className="text-xs leading-snug text-slate-500">{description}</p>
      </div>
    </div>
    <div className="mt-2.5 space-y-2">{children}</div>
    {disabled.length > 0 && <ul id={`${reasons.prefix}-${reasons.key}-reason`} className="mt-2 space-y-0.5 text-[11px] leading-snug text-slate-500">
      {disabled.map(([label, availability]) => <li key={label || "reason"}>
        {label && <span className="font-semibold text-slate-600">{label}: </span>}{visibleReasons(availability).join(" • ")}
      </li>)}
    </ul>}
  </li>;
}

const VARIANT = {
  default: "app-button w-full",
  next: "app-button w-full !border-blue-600 !bg-blue-600 !text-white hover:!border-blue-700 hover:!bg-blue-700",
  link: "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-700",
} as const;

function ActionButton({ id, label, icon, availability, onRun, variant = "default", title, readOnlyId, reasonId = `${id}-reason` }: {
  id: string;
  label: string;
  icon: ReactNode;
  availability: Availability;
  onRun: () => void;
  variant?: keyof typeof VARIANT;
  title?: string;
  readOnlyId: string;
  /** Element listing why this button is disabled (a StepCard's reason list). */
  reasonId?: string;
}) {
  const own = visibleReasons(availability);
  const describedBy = availability.enabled ? undefined : own.length ? reasonId : readOnlyId;
  // aria-disabled keeps the button focusable so keyboard/screen-reader users can reach the reason.
  return <button id={id} type="button" title={title ?? (availability.enabled ? undefined : availability.reasons.join(" • "))}
    aria-disabled={!availability.enabled} aria-describedby={describedBy}
    className={`${VARIANT[variant]} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
    onClick={() => { if (availability.enabled) onRun(); }}>
    {icon}{label}
  </button>;
}

function ResultMessage({ result }: { result: { outcome: "success" | "noop" | "rejected"; message: string } | undefined }) {
  const icon = !result ? null
    : result.outcome === "success" ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-600" aria-hidden />
      : result.outcome === "rejected" ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
        : <Info size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />;
  const prefix = !result ? "" : result.outcome === "success" ? "สำเร็จ: " : result.outcome === "rejected" ? "ทำไม่ได้: " : "ไม่มีการเปลี่ยนแปลง: ";
  const tone = !result ? "" : result.outcome === "success" ? "border-green-200 bg-green-50 text-green-900"
    : result.outcome === "rejected" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
  // Sticky: the latest result stays visible at the bottom of the panel even when the step cards scroll.
  return <div aria-live="polite" className={result ? "sticky bottom-0 z-10 -mx-4 bg-white/95 px-4 pb-3 pt-2 backdrop-blur-sm" : ""}>
    {result && <p className={`flex gap-2 rounded-xl border px-3 py-2 text-xs leading-snug shadow-sm ${tone}`}>
      {icon}<span><span className="sr-only">{prefix}</span>{result.message}</span>
    </p>}
  </div>;
}
