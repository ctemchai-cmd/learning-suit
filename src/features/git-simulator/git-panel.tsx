"use client";

import { useId, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { CONFLICT_FILL } from "./git-widget-view";
import { Eye, GitPullRequest, ArrowDownToLine, ArrowUpFromLine, ChevronDown, CircleCheck, CopyPlus, GitBranch, GitCommitHorizontal, GitMerge, Info, PackagePlus, RotateCcw, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import type { DocumentTransaction } from "@/domain/document/commands";
import { hostOf, HOSTS, type HostId } from "@/domain/hosting";
import { fitBounds } from "@/domain/document/camera";
import { gitHasMachineB, gitNodeSize, gitViewOf, type GitSimulatorNode, type GitView } from "@/domain/document/model";
import { useEditorStore } from "@/features/editor/store";
import { applyGitAction } from "@/domain/git/reducer";
import { MERGE_HINT, RESET_TOOLTIP, describeGitTransition, repositoryLabel } from "@/domain/git/messages";
import { mergeCommitMessage } from "@/domain/git/merge3";
import type { GitAction, MachineId } from "@/domain/git/model";
import { lineDiff, diffCounts, diffWindow } from "@/domain/git/diff";
import { MAIN_BRANCH, currentBranch, currentRequest, mergeBase, requestInfo, suggestBranchName } from "@/domain/git/selectors";
import { findGitNode, gitDraftFor } from "./git-draft";
import { messageKey, nextTransferKey, useGitSessionStore } from "./session-store";
import { READ_ONLY_REASON, getActionAvailability, getBranchAvailability, getRequestAvailability, nextBranchStep, nextGitStep, nextReviewStep, projectState, type Availability, type BranchAvailability, type BranchRow } from "./view-model";
import { RevealControls } from "@/features/flow/flow-panel-parts";
import { revealForParts, revealOnStepChange, withReveal } from "@/domain/document/reveal";
import { gitActionParts, gitParts, gitViewList, viewHasRemote } from "./widget-layout";

const ACTION_NAMES: Record<GitAction["type"], string> = {
  edit: "แก้ไฟล์", stage: "Add", commit: "Commit", push: "Push", clone: "Clone", pull: "Pull",
  mergeTake: "ใส่ไฟล์ตอน merge", mergeAbort: "ยกเลิก merge", resetToRemote: "ใช้เวอร์ชันของ remote", reset: "Reset demo",
  mrOpen: "เปิด MR", mrApprove: "อนุมัติ MR", mrMerge: "Merge MR",
  branchCreate: "สร้าง branch", branchSwitch: "สลับ branch", branchMerge: "Merge branch", branchDelete: "ลบ branch",
};

function transactionLabel(action: GitAction, host: HostId | undefined): string {
  const where = action.type === "reset" ? "" : ` ${repositoryLabel(action.machine, host)}`;
  const mr = hostOf(host).mergeRequestShort;
  const name = action.type === "mrOpen" ? `เปิด ${mr}` : action.type === "mrApprove" ? `อนุมัติ ${mr}` : action.type === "mrMerge" ? `Merge ${mr}` : ACTION_NAMES[action.type];
  return `Git (จำลอง): ${name}${where}`;
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
  const machine: MachineId = gitHasMachineB(view) && storedTab === "B" ? "B" : "A";
  const result = useGitSessionStore((s) => s.results[nodeId]);
  const message = useGitSessionStore((s) => s.messages[messageKey(nodeId, machine)] ?? "");
  const draft = useEditorStore((s) => gitDraftFor(s.pendingEdit, nodeId, machine)?.draft ?? null);
  const { setTab, setResult, startTransfer, setMessage, clearNode } = useGitSessionStore.getState();
  const host = hostOf(node.host);
  const review = view === "review";
  const availability = getActionAvailability({ state, machine, draft, message, writable, host: node.host, review });
  const repo = state.machines[machine];
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const branchName = nameDraft ?? suggestBranchName(repo);
  const branches = getBranchAvailability({ state, machine, draft, name: branchName, writable });

  const runAction = (plain: GitAction) => {
    // In the review lesson Push / Pull also work on a branch and main is protected.
    const action: GitAction = review && (plain.type === "push" || plain.type === "pull") ? { ...plain, review: true } : plain;
    // The file typed on the board is applied first, as its own Edit step.
    if (!useEditorStore.getState().flushPendingEdits()) return;
    const latest = findGitNode(slideId, nodeId) ?? node;
    const transition = applyGitAction(latest.state, action);
    // What the action changes is shown in the same step (no-op while the reveal mode is off).
    const reveal = transition.changed ? revealForParts(gitParts(gitViewOf(latest), latest.host), latest.reveal, gitActionParts(gitViewOf(latest), action)) : latest.reveal;
    if (transition.changed && !transact({
      label: transactionLabel(action, node.host),
      affectedSlideId: slideId,
      commands: [{ type: "nodes.replace", slideId, nodes: [withReveal({ ...latest, state: transition.nextState }, reveal)] }],
    })) {
      setResult(nodeId, { code: transition.code, outcome: "rejected", message: `${ACTION_NAMES[action.type]} ไม่สำเร็จ: โปรเจกต์อ่านอย่างเดียวหรือข้อมูลไม่ผ่านการตรวจ` });
      return;
    }
    if (action.type === "reset" && transition.changed) clearNode(nodeId);
    setResult(nodeId, { code: transition.code, outcome: transition.outcome, message: describeGitTransition(action, transition, node.host) });
    if (transition.transfer) startTransfer(nodeId, { ...transition.transfer, key: nextTransferKey() });
    if (action.type === "commit" && (transition.code === "COMMITTED" || transition.code === "MERGED")) setMessage(nodeId, action.machine, "");
    // Like Git's editor opening with “Merge …”: the message box starts with the merge commit's usual text.
    if (transition.code === "MERGE_CONFLICT" && "machine" in action) {
      const merging = transition.nextState.machines[action.machine].merging;
      if (merging) setMessage(nodeId, action.machine, mergeCommitMessage(merging.label));
    }
    if (action.type === "mergeAbort" && transition.changed) setMessage(nodeId, action.machine, "");
    if (action.type === "branchCreate" && transition.changed) setNameDraft(null);
  };

  const changeView = (next: GitView) => {
    if (next === view || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = findGitNode(slideId, nodeId) ?? node;
    // A new lesson step starts hidden again when the reveal mode is on.
    const changed = withReveal({ ...latest, view: next }, revealOnStepChange(latest.reveal));
    if (transact({ label: "Git (จำลอง): เปลี่ยนขั้นบทเรียน", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [changed] }] })) keepOnScreen(changed);
  };

  /** GitHub ↔ GitLab: only the names change; one undoable step. */
  const changeHost = (next: HostId) => {
    if (next === host.id || !writable || !useEditorStore.getState().flushPendingEdits()) return;
    const latest = findGitNode(slideId, nodeId) ?? node;
    transact({ label: `เปลี่ยนเป็น ${HOSTS[next].name}`, affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...latest, host: next }] }] });
  };

  const onMessageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposing(event)) return;
    event.preventDefault();
    if (availability.commit.enabled) runAction({ type: "commit", machine, message });
  };

  const showRemote = viewHasRemote(view);
  const projected = projectState(state, machine, draft).state;
  const target = view === "branch" ? nextBranchStep(projected, machine, availability) : review ? nextReviewStep(projected, machine, availability) : null;
  const requests = getRequestAvailability({ state, machine, writable, id: currentRequest(state)?.status === "open" ? currentRequest(state)!.id : null, host: node.host });
  const next = target ? target.step : nextGitStep(projected, machine, availability, showRemote);
  const strayBranch = view !== "branch" && !review && repo.initialized && branches.current !== MAIN_BRANCH ? branches.others.find((row) => row.name === MAIN_BRANCH) : undefined;
  const views = gitViewList(host.id);
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

    <div role="group" aria-label="ที่เก็บโค้ดออนไลน์" className="flex items-center gap-2">
      <span className="text-xs font-semibold text-slate-500">ใช้เว็บ</span>
      <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(Object.values(HOSTS)).map((item) => <button key={item.id} type="button" aria-pressed={host.id === item.id} disabled={!writable}
          className={`rounded-lg px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${host.id === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          onClick={() => changeHost(item.id)}>{item.name}</button>)}
      </div>
    </div>

    {!writable && <p id={readOnlyId} className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{READ_ONLY_REASON}: ดูได้อย่างเดียว</p>}

    <div className="space-y-1.5">
      <label htmlFor={`${ids}-view`} className="block text-xs font-semibold text-slate-500">ขั้นของบทเรียน</label>
      <div className="relative">
        <select id={`${ids}-view`} value={view} disabled={!writable} aria-describedby={`${ids}-view-description`}
          onChange={(event) => changeView(event.target.value as GitView)}
          className="w-full appearance-none truncate rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-8 text-[13px] font-semibold text-slate-800 shadow-sm outline-none transition-colors hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30">
          {views.map((item, index) => <option key={item.id} value={item.id}>{index + 1} · {item.label}</option>)}
        </select>
        <ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
      <p id={`${ids}-view-description`} className="text-[11px] leading-snug text-slate-500">{views.find((item) => item.id === view)?.description}</p>
    </div>

    <RevealControls node={node} parts={gitParts(view, node.host)} slideId={slideId} writable={writable} transact={transact} />

    <div className="space-y-2">
      {gitHasMachineB(view) && <div role="group" aria-label="ใช้งานเครื่อง" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
        {(["A", "B"] as const).map((id) => <button key={id} type="button" aria-pressed={machine === id}
          className={`rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors ${machine === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          onClick={() => { if (useEditorStore.getState().flushPendingEdits()) setTab(nodeId, id); }}>{repositoryLabel(id)}</button>)}
      </div>}
      <p className="text-xs font-semibold text-slate-500">ขั้นตอนบน{repositoryLabel(machine)}</p>

      {repo.merging && <section aria-labelledby={`${ids}-merge-title`} className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 shadow-sm shadow-amber-100">
        <h3 id={`${ids}-merge-title`} className="flex items-center gap-1.5 font-semibold leading-6 text-amber-950"><GitMerge size={16} aria-hidden />กำลัง merge: ไฟล์ชนกัน
          {next === "resolve" && <span className="rounded-full bg-blue-600/10 px-1.5 py-px text-[10px] font-semibold text-blue-700">ทำต่อ</span>}</h3>
        <p className="text-xs leading-snug text-amber-900/80">{MERGE_HINT}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-600" aria-label="สีในไฟล์">
          <span className="rounded px-1.5 py-px" style={{ background: CONFLICT_FILL.ours }}>ของเรา (HEAD)</span>
          <span className="rounded px-1.5 py-px" style={{ background: CONFLICT_FILL.theirs }}>ของ {repo.merging.label}</span>
          <span className="rounded px-1.5 py-px" style={{ background: CONFLICT_FILL.marker }}>เครื่องหมาย</span></p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <ActionButton id={`${ids}-take-ours`} label="ใช้ของเรา" icon={null} title="ใส่ไฟล์ของเราทั้งไฟล์ลงในกล่อง (ยังต้อง Add + Commit)"
            availability={availability.mergeTake} readOnlyId={readOnlyId} onRun={() => runAction({ type: "mergeTake", machine, side: "ours" })} />
          <ActionButton id={`${ids}-take-theirs`} label="ใช้ของอีกฝั่ง" icon={null} title={`ใส่ไฟล์ของ ${repo.merging.label} ทั้งไฟล์ลงในกล่อง (ยังต้อง Add + Commit)`}
            availability={availability.mergeTake} readOnlyId={readOnlyId} onRun={() => runAction({ type: "mergeTake", machine, side: "theirs" })} />
        </div>
        <div className="mt-2 space-y-1">
          <ActionButton id={`${ids}-merge-abort`} label="ยกเลิก merge" icon={<Undo2 size={15} />}
            availability={availability.mergeAbort} readOnlyId={readOnlyId} onRun={() => runAction({ type: "mergeAbort", machine })} />
          <Command text="git merge --abort" />
        </div>
        {repo.merging.label === "origin/main" && currentBranch(repo) === MAIN_BRANCH && <div className="mt-1.5 flex justify-end">
          <ActionButton id={`${ids}-reset-remote`} label={`ทิ้งงานของเรา ใช้เวอร์ชัน ${host.name}`} icon={<Undo2 size={13} />} variant="link"
            title="ทิ้ง commit และการแก้ที่ยังไม่ได้ Push ของเครื่องนี้ ย้อนกลับด้วย Undo ได้"
            availability={availability.resetToRemote} readOnlyId={readOnlyId} onRun={() => runAction({ type: "resetToRemote", machine })} />
        </div>}
      </section>}

      {strayBranch && <section aria-labelledby={`${ids}-stray-title`} className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 shadow-sm shadow-amber-100">
        <h3 id={`${ids}-stray-title`} className="flex items-center gap-1.5 font-semibold leading-6 text-amber-950"><GitBranch size={16} aria-hidden />อยู่ที่ branch {branches.current}</h3>
        <p className="text-xs leading-snug text-amber-900/80">Push / Pull ในตัวจำลองนี้ใช้กับ main เท่านั้น สลับกลับไป main ก่อน</p>
        <div className="mt-2.5"><ActionButton id={`${ids}-stray-main`} reasonId={`${ids}-stray-reason`} label="สลับไป main" icon={<GitBranch size={15} />} availability={strayBranch.switch} readOnlyId={readOnlyId}
          onRun={() => runAction({ type: "branchSwitch", machine, name: MAIN_BRANCH })} /></div>
        {visibleReasons(strayBranch.switch).length > 0 && <p id={`${ids}-stray-reason`} className="mt-2 text-[11px] leading-snug text-amber-900/80">{visibleReasons(strayBranch.switch).join(" • ")}</p>}
      </section>}

      {!repo.initialized ? <ol className="space-y-3">
        <StepCard number={1} title="Clone" description={`คัดลอกไฟล์และ commit จาก ${host.name}`} active={availability.clone.enabled}
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
        {review && <StepCard number={3} title="Branch (ทางแยก)" description="main ถูกป้องกัน: แตก branch เพื่อทำงานใหม่"
          active={next === "create" || next === "switch"} reasons={reasonsOf("branch", [])}>
          <BranchCard ids={ids} machine={machine} branches={branches} name={branchName} onName={setNameDraft} next={target} writable={writable} readOnlyId={readOnlyId} run={runAction} compact />
        </StepCard>}
        {showRemote && <StepCard number={review ? 4 : 3} title={host.name} description="Push ส่งขึ้น • Pull รับลงมา" active={next === "push" || next === "pull"}
          reasons={reasonsOf("remote", [["Push", availability.push], ["Pull", availability.pull]])}>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton id={`${ids}-push`} reasonId={`${ids}-remote-reason`} label="Push" icon={<ArrowUpFromLine size={15} />} variant={next === "push" ? "next" : "default"}
              availability={availability.push} readOnlyId={readOnlyId} onRun={() => runAction({ type: "push", machine })} />
            <ActionButton id={`${ids}-pull`} reasonId={`${ids}-remote-reason`} label="Pull" icon={<ArrowDownToLine size={15} />} variant={next === "pull" ? "next" : "default"}
              availability={availability.pull} readOnlyId={readOnlyId} onRun={() => runAction({ type: "pull", machine })} />
          </div>
          {review && <div className="space-y-1">
            <Command text={currentBranch(repo) === MAIN_BRANCH ? "git push origin main" : `git push -u origin ${currentBranch(repo)}`} />
            <Command text={currentBranch(repo) === MAIN_BRANCH ? "git pull" : "git pull origin main"} />
          </div>}
        </StepCard>}
        {review && <StepCard number={5} title={hostOf(node.host).mergeRequest} description={`ขอรวม branch เข้า main ให้เพื่อนตรวจก่อน (${hostOf(node.host).mergeRequestShort})`}
          active={next === "openMr" || next === "approve" || next === "mergeMr"} reasons={reasonsOf("mr", [])}>
          <RequestCard ids={ids} state={state} machine={machine} host={host.id} writable={writable} readOnlyId={readOnlyId} open={requests.open} next={target} branch={currentBranch(repo)} run={runAction} />
        </StepCard>}
        {view === "branch" && <StepCard number={3} title="Branch (ทางแยก)" description="ทางแยกให้ลองของใหม่ โดย main ไม่โดนกระทบ"
          active={next === "create" || next === "switch" || next === "mergeBranch"} reasons={reasonsOf("branch", [])}>
          <BranchCard ids={ids} machine={machine} branches={branches} name={branchName} onName={setNameDraft} next={target} writable={writable} readOnlyId={readOnlyId} run={runAction} />
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

/** The git command a button runs, shown beside it so the click can be matched with the terminal. */
function Command({ text }: { text: string }) {
  return <code className="block truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600" title={text}>$ {text}</code>;
}

const PLAN_HINT: Record<BranchRow["plan"], string> = {
  "fast-forward": "Fast-forward: แค่เลื่อนไปข้างหน้า ไม่สร้าง commit ใหม่",
  merge: "Git รวมให้เอง (แก้คนละบรรทัด) สร้าง merge commit ที่มีสองพ่อแม่",
  conflict: "แก้บรรทัดเดียวกันทั้งสองฝั่ง: Git จะหยุดให้คุณแก้ไฟล์เอง (conflict)",
  "up-to-date": "Already up to date: รวมไว้แล้ว",
  unavailable: "",
};

function BranchCard({ ids, machine, branches, name, onName, next, writable, readOnlyId, run, compact = false }: {
  ids: string;
  machine: MachineId;
  branches: BranchAvailability;
  name: string;
  onName: (value: string) => void;
  next: { step: string; branch: string | null } | null;
  writable: boolean;
  readOnlyId: string;
  run: (action: GitAction) => void;
  /** The review lesson only needs create / switch: merging and deleting happen on the remote there. */
  compact?: boolean;
}) {
  const { current, others } = branches;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposing(event)) return;
    event.preventDefault();
    if (branches.create.enabled) run({ type: "branchCreate", machine, name });
  };
  const reasonFor = (id: string, availability: Availability) => visibleReasons(availability).length > 0
    ? <p id={id} className="text-[11px] leading-snug text-slate-500">{visibleReasons(availability).join(" • ")}</p> : null;
  const merges = compact ? [] : others.filter((row) => row.plan !== "unavailable");
  const deletable = compact ? [] : others.filter((row) => row.name !== MAIN_BRANCH);
  const heading = "text-[11px] font-semibold text-slate-600";
  return <>
    <p className="flex items-center gap-1.5 text-xs text-slate-600">ตอนนี้อยู่ที่
      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">HEAD → {current}</span></p>

    <div className="space-y-1.5">
      <label htmlFor={`${ids}-branch-name`} className={`block ${heading}`}>สร้าง branch ใหม่ (และสลับไปอยู่ที่นั่น)</label>
      <input id={`${ids}-branch-name`} className="field !py-2" value={name} readOnly={!writable} spellCheck={false} maxLength={80} aria-invalid={branches.nameError ? true : undefined}
        aria-describedby={branches.nameError ? `${ids}-branch-name-error` : undefined} onChange={(event) => onName(event.target.value)} onKeyDown={onKeyDown} />
      {branches.nameError && <p id={`${ids}-branch-name-error`} className="text-[11px] leading-snug text-amber-700">{branches.nameError}</p>}
      <ActionButton id={`${ids}-branch-create`} reasonId={branches.nameError ? `${ids}-branch-name-error` : `${ids}-branch-create-reason`} label="สร้าง branch" icon={<GitBranch size={15} />} variant={next?.step === "create" ? "next" : "default"}
        availability={branches.create} readOnlyId={readOnlyId} onRun={() => run({ type: "branchCreate", machine, name })} />
      {!branches.nameError && reasonFor(`${ids}-branch-create-reason`, branches.create)}
      <Command text={`git switch -c ${name.trim() || "<ชื่อ>"}`} />
    </div>

    {others.length > 0 && <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <p className={heading}>สลับ branch</p>
      {others.map((row) => <div key={row.name} className="space-y-1">
        <ActionButton id={`${ids}-switch-${row.name}`} reasonId={`${ids}-switch-${row.name}-reason`} label={`สลับไป ${row.name}`} icon={<GitBranch size={15} />}
          variant={next?.step === "switch" && next.branch === row.name ? "next" : "default"}
          availability={row.switch} readOnlyId={readOnlyId} onRun={() => run({ type: "branchSwitch", machine, name: row.name })} />
        {reasonFor(`${ids}-switch-${row.name}-reason`, row.switch)}
        <Command text={`git switch ${row.name}`} />
      </div>)}
    </div>}

    {merges.length > 0 && <div className="space-y-1.5 border-t border-slate-100 pt-2">
      <p className={heading}>Merge เข้า {current}</p>
      {merges.map((row) => <div key={row.name} className="space-y-1">
        <ActionButton id={`${ids}-merge-${row.name}`} reasonId={`${ids}-merge-${row.name}-reason`} label={`Merge ${row.name} เข้า ${current}`} icon={<GitMerge size={15} />}
          variant={next?.step === "mergeBranch" && next.branch === row.name ? "next" : "default"}
          availability={row.merge} readOnlyId={readOnlyId} onRun={() => run({ type: "branchMerge", machine, name: row.name })} />
        {(row.plan === "fast-forward" || row.plan === "merge" || row.plan === "conflict") && <p className="text-[11px] leading-snug text-slate-500">{row.name}: {PLAN_HINT[row.plan]}</p>}
        {reasonFor(`${ids}-merge-${row.name}-reason`, row.merge)}
        <Command text={`git merge ${row.name}`} />
      </div>)}
    </div>}

    {deletable.length > 0 && <div className="space-y-1 border-t border-slate-100 pt-2">
      <p className={heading}>ลบ branch ที่รวมแล้ว</p>
      {deletable.map((row) => <div key={row.name} className="flex flex-col items-start gap-0.5">
        <ActionButton id={`${ids}-delete-${row.name}`} reasonId={`${ids}-delete-${row.name}-reason`} label={`ลบ branch ${row.name}`} icon={<Trash2 size={13} />} variant="link"
          title={visibleReasons(row.delete).join(" • ") || "ลบ branch (commit ยังอยู่ในประวัติ)"}
          availability={row.delete} readOnlyId={readOnlyId} onRun={() => run({ type: "branchDelete", machine, name: row.name })} />
        <Command text={`git branch -d ${row.name}`} />
      </div>)}
      {deletable.filter((row) => visibleReasons(row.delete).length > 0).map((row) => <p key={row.name} id={`${ids}-delete-${row.name}-reason`} className="text-[11px] leading-snug text-slate-500">{row.name}: {visibleReasons(row.delete).join(" • ")}</p>)}
    </div>}
  </>;
}

const CHIP = { open: "bg-amber-100 text-amber-800", approved: "bg-blue-100 text-blue-800", merged: "bg-green-100 text-green-800", closed: "bg-slate-100 text-slate-600" } as const;

/** Merge Request step: open one from the current branch, and for each request look at the changes, approve, merge. */
function RequestCard({ ids, state, machine, host, writable, readOnlyId, open, next, branch, run }: {
  ids: string;
  state: GitSimulatorNode["state"];
  machine: MachineId;
  host: HostId;
  writable: boolean;
  readOnlyId: string;
  open: Availability;
  next: { step: string; id?: number } | null;
  branch: string;
  run: (action: GitAction) => void;
}) {
  const term = hostOf(host).mergeRequest;
  const [showing, setShowing] = useState<number | null>(null);
  const requests = [...(state.remote.requests ?? [])].reverse();
  const reason = (availability: Availability, id: string) => visibleReasons(availability).length > 0 && !availability.enabled
    ? <p id={id} className="text-[11px] leading-snug text-slate-500">{visibleReasons(availability).join(" • ")}</p> : null;
  return <>
    <div className="space-y-1">
      <ActionButton id={`${ids}-mr-open`} reasonId={`${ids}-mr-open-reason`} label={branch === MAIN_BRANCH ? `เปิด ${term}` : `เปิด ${term}: ${branch} → main`} icon={<GitPullRequest size={15} />}
        variant={next?.step === "openMr" ? "next" : "default"} availability={open} readOnlyId={readOnlyId} onRun={() => run({ type: "mrOpen", machine })} />
      {reason(open, `${ids}-mr-open-reason`)}
      <Command text={`New ${hostOf(host).mergeRequestShort} (เว็บ ${hostOf(host).name})`} />
    </div>
    {requests.length === 0 && <p className="text-[11px] leading-snug text-slate-500">ยังไม่มี {term}: Push branch แล้วเปิดอันแรก</p>}
    {requests.map((request) => {
      const info = requestInfo(state, request);
      const status = request.status === "open" ? (info?.approved ? "approved" : "open") : request.status;
      const label = { open: "เปิดอยู่", approved: "อนุมัติแล้ว", merged: "รวมแล้ว", closed: "ปิดแล้ว" }[status];
      const mine = getRequestAvailability({ state, machine, writable, id: request.id, host });
      const focus = next?.id === request.id;
      return <div key={request.id} className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2" aria-label={`${term} !${request.id}`} role="group">
        <p className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-800"><span className="truncate">!{request.id} {request.source} → main</span>
          <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ${CHIP[status]}`}>{label}</span></p>
        <p className="text-[11px] leading-snug text-slate-500">เปิดโดยเครื่อง {request.author} • {request.approvedBy.length ? `อนุมัติโดยเครื่อง ${request.approvedBy.join(", ")}` : "ยังไม่มีคนอนุมัติ"}
          {info?.conflict ? " • ชนกับ main" : ""}{request.status === "open" ? " • pipeline ✓ ผ่าน" : ""}</p>
        {request.status === "open" && <>
          <button type="button" aria-pressed={showing === request.id} className="app-button w-full" onClick={() => setShowing(showing === request.id ? null : request.id)}><Eye size={15} />ดูการเปลี่ยนแปลง</button>
          {showing === request.id && <RequestDiff state={state} request={request} />}
          <ActionButton id={`${ids}-mr-approve-${request.id}`} reasonId={`${ids}-mr-approve-${request.id}-reason`} label="อนุมัติ (Approve)" icon={<CircleCheck size={15} />}
            variant={focus && next?.step === "approve" ? "next" : "default"} availability={mine.approve} readOnlyId={readOnlyId} onRun={() => run({ type: "mrApprove", machine, id: request.id })} />
          {reason(mine.approve, `${ids}-mr-approve-${request.id}-reason`)}
          <ActionButton id={`${ids}-mr-merge-${request.id}`} reasonId={`${ids}-mr-merge-${request.id}-reason`} label="Merge เข้า main" icon={<GitMerge size={15} />}
            variant={focus && next?.step === "mergeMr" ? "next" : "default"} availability={mine.merge} readOnlyId={readOnlyId} onRun={() => run({ type: "mrMerge", machine, id: request.id })} />
          {reason(mine.merge, `${ids}-mr-merge-${request.id}-reason`)}
        </>}
      </div>;
    })}
  </>;
}

/** What the request changes: its branch's file against where it left main (reuses the commit diff). */
function RequestDiff({ state, request }: { state: GitSimulatorNode["state"]; request: { source: string } }) {
  const tip = state.remote.branches?.[request.source];
  const after = tip ? state.commits[tip]?.snapshot : null;
  const base = tip && state.remote.mainHead ? mergeBase(state, state.remote, state.remote.mainHead, tip) : null;
  if (!after) return null;
  const diff = lineDiff(base ? state.commits[base]?.snapshot.content ?? "" : "", after.content);
  const counts = diffCounts(diff);
  const shown = diffWindow(diff, 10);
  return <div className="overflow-hidden rounded-md bg-slate-900 font-mono text-[11px] leading-[16px]" role="region" aria-label="การเปลี่ยนแปลงใน Merge Request">
    <p className="px-2 py-1 text-[10px] text-sky-300">{after.name} · +{counts.added} −{counts.removed}</p>
    {shown.lines.map((line, index) => <p key={index} data-diff={line.kind} className={`whitespace-pre px-2 ${line.kind === "add" ? "bg-green-500/20 text-green-200" : line.kind === "del" ? "bg-red-500/20 text-red-200" : "text-slate-300"}`}>
      {line.kind === "add" ? "+ " : line.kind === "del" ? "− " : "  "}{line.text}</p>)}
    {shown.after > 0 && <p className="px-2 text-slate-500">… อีก {shown.after} บรรทัด</p>}
  </div>;
}

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

function ResultMessage({ result }: { result: { code: string; outcome: "success" | "noop" | "rejected"; message: string } | undefined }) {
  // A merge that stopped on conflicts is not an error, but it needs the learner: shown as a warning.
  const warning = result?.code === "MERGE_CONFLICT";
  const icon = !result ? null
    : warning ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
    : result.outcome === "success" ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-600" aria-hidden />
      : result.outcome === "rejected" ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
        : <Info size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />;
  const prefix = !result ? "" : warning ? "ต้องแก้ไฟล์: " : result.outcome === "success" ? "สำเร็จ: " : result.outcome === "rejected" ? "ทำไม่ได้: " : "ไม่มีการเปลี่ยนแปลง: ";
  const tone = !result ? "" : warning ? "border-amber-200 bg-amber-50 text-amber-900" : result.outcome === "success" ? "border-green-200 bg-green-50 text-green-900"
    : result.outcome === "rejected" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
  // Sticky: the latest result stays visible at the bottom of the panel even when the step cards scroll.
  return <div aria-live="polite" className={result ? "sticky bottom-0 z-10 -mx-4 bg-white/95 px-4 pb-3 pt-2 backdrop-blur-sm" : ""}>
    {result && <p className={`flex gap-2 rounded-xl border px-3 py-2 text-xs leading-snug shadow-sm ${tone}`}>
      {icon}<span><span className="sr-only">{prefix}</span>{result.message}</span>
    </p>}
  </div>;
}
