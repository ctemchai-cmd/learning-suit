import { applyGitAction } from "../../domain/git/reducer";
import {
  MAIN_BRANCH, aheadBehind, currentRequest, openRequestFor, requestInfo, branchNames, branchTip, currentBranch, headCommitId, headSnapshot, isAncestor, isClean, planBranchMerge, snapshotsEqual,
  validateBranchName, validateCommitMessage, validateFileSnapshot, type BranchMergePlan, type FileValidation,
} from "../../domain/git/selectors";
import { hasConflictMarkers } from "../../domain/git/merge3";
import { hostOf, type HostId } from "../../domain/hosting";
import {
  DIRTY_SWITCH_MESSAGE, DIRTY_WORKTREE_MESSAGE, MERGING_BLOCKED_MESSAGE, NEED_COMMIT_FOR_BRANCH_MESSAGE, NOT_ON_MAIN_MESSAGE, UNRESOLVED_CONFLICT_MESSAGE,
  describeBranchNameError, describeGitTransition, describeFileValidationError, describeMessageValidationError, repositoryLabel,
} from "../../domain/git/messages";
import { GIT_LIMITS, type FileSnapshot, type GitAction, type GitSimulationState, type MachineId } from "../../domain/git/model";

/** Pure helpers shared by the Canvas widget, the board editor and the DOM panel (no React/Konva). */

export const PREVIEW_LINE_COUNT = 3;
export const PREVIEW_LINE_CODE_POINTS = 28;

/** Cuts to at most `max` Unicode code points, using "…" as the last one when truncated. */
export function truncateCodePoints(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  if (max <= 0) return "";
  return `${points.slice(0, max - 1).join("")}…`;
}

export type PreviewText = { lines: string[]; totalLines: number };

/** First `count` lines of a file for Canvas preview; tabs become two spaces, CR is dropped, each line ≤ `max` code points. */
export function previewLines(content: string, count = PREVIEW_LINE_COUNT, max = PREVIEW_LINE_CODE_POINTS): PreviewText {
  if (content === "") return { lines: [], totalLines: 0 };
  const all = content.replace(/\r/g, "").replace(/\t/g, "  ").split("\n");
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  return { lines: all.slice(0, count).map((line) => truncateCodePoints(line, max)), totalLines: all.length };
}

/**
 * Lines of the file for the drawn code editor: every line including a trailing empty one (like an editor,
 * and like the textarea on top of it), tabs as 4 spaces, each line ≤ `max` code points. When the file
 * has more than `rows` lines the last row is kept for "… อีก N บรรทัด".
 */
export function codeLines(content: string, rows: number, max: number): { lines: string[]; more: number } {
  const all = content.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");
  const shown = all.length <= rows ? all : all.slice(0, Math.max(1, rows - 1));
  return { lines: shown.map((line) => truncateCodePoints(line, max)), more: all.length - shown.length };
}

// ---------------------------------------------------------------------------
// Panel enablement from the projected state
// ---------------------------------------------------------------------------

export type Projection =
  | { ok: true; state: GitSimulationState; draft: FileSnapshot | null }
  | { ok: false; state: GitSimulationState; validation: Extract<FileValidation, { ok: false }> };

/** Replaces the machine's working copy with a valid draft without touching the document. */
export function projectState(state: GitSimulationState, machine: MachineId, draft: FileSnapshot | null): Projection {
  if (!draft || !state.machines[machine].initialized) return { ok: true, state, draft: null };
  const validation = validateFileSnapshot(draft);
  if (!validation.ok) return { ok: false, state, validation };
  return { ok: true, state: applyGitAction(state, { type: "edit", machine, file: validation.file }).nextState, draft: validation.file };
}

export type GitPanelAction = "stage" | "commit" | "push" | "pull" | "clone" | "mergeTake" | "mergeAbort" | "resetToRemote" | "reset";
export type Availability = { enabled: boolean; reasons: string[] };
export type ActionAvailabilityInput = {
  state: GitSimulationState;
  machine: MachineId;
  draft: FileSnapshot | null;
  message: string;
  writable: boolean;
  /** Which site the remote is (names in reasons). Missing = GitHub. */
  host?: HostId;
  /** The Merge Request lesson: Push / Pull also work on a branch. */
  review?: boolean;
};

export const READ_ONLY_REASON = "โปรเจกต์นี้เปิดแบบอ่านอย่างเดียว";
export const INVALID_DRAFT_REASON = "แก้ชื่อไฟล์หรือโค้ดบนกระดานให้ถูกต้อง หรือกด “ยกเลิกการแก้” ในกล่องไฟล์";

function availability(reasons: string[]): Availability {
  return { enabled: reasons.length === 0, reasons };
}

/**
 * Button enablement for one machine tab. Stage/Pull read the projected working copy (valid draft applied);
 * Commit reads the real index. The reducer still validates every action on dispatch.
 */
export function getActionAvailability({ state, machine, draft, message, writable, host: hostId, review = false }: ActionAvailabilityInput): Record<GitPanelAction, Availability> {
  const projection = projectState(state, machine, draft);
  const blockers: string[] = [];
  if (!writable) blockers.push(READ_ONLY_REASON);
  if (!projection.ok) blockers.push(INVALID_DRAFT_REASON);
  const projected = projection.state;
  const repo = projected.machines[machine];
  const realRepo = state.machines[machine];
  const remoteEmpty = state.remote.mainHead === null;
  const host = hostOf(hostId).name;
  const notCloned = `${repositoryLabel(machine)} ยังไม่ได้ Clone`;

  const stage: string[] = [...blockers];
  const commit: string[] = [...blockers];
  const push: string[] = [...blockers];
  const pull: string[] = [...blockers];
  const clone: string[] = [...blockers];
  const mergeTake: string[] = [...blockers];
  const mergeAbort: string[] = [...blockers];
  const resetToRemote: string[] = [...blockers];

  if (!repo.initialized) {
    stage.push(notCloned); commit.push(notCloned); push.push(notCloned); pull.push(notCloned); mergeTake.push(notCloned); mergeAbort.push(notCloned); resetToRemote.push(notCloned);
    if (remoteEmpty) clone.push(`${host} ยังไม่มี commit ให้ Clone ให้เครื่อง A Push ก่อน`);
  } else {
    clone.push(`${repositoryLabel(machine)} มี repository แล้ว`);
    // While the file still has conflict markers, "already added" would mislead: the file simply is not fixed yet.
    if (projection.ok && snapshotsEqual(repo.working, repo.index)) stage.push(realRepo.merging && repo.working && hasConflictMarkers(repo.working.content) ? "ยังมีเครื่องหมาย conflict: แก้ไฟล์ก่อน แล้วค่อย Add" : "ไฟล์ตรงกับที่ Add ไว้แล้ว");

    const messageCheck = validateCommitMessage(message);
    if (!messageCheck.ok) commit.push(describeMessageValidationError(messageCheck.error));
    const merging = realRepo.merging !== undefined;
    if (merging) {
      // Commit finishes the merge: the Staging file must be resolved (no marker lines left).
      const staged = realRepo.index?.content ?? "";
      if (realRepo.index !== null && hasConflictMarkers(staged)) {
        commit.push(projection.ok && repo.working && !hasConflictMarkers(repo.working.content) ? "แก้ไฟล์เสร็จแล้ว ให้กด Add ก่อน Commit" : UNRESOLVED_CONFLICT_MESSAGE);
      }
    } else if (realRepo.index === null || snapshotsEqual(realRepo.index, headSnapshot(state, realRepo))) commit.push("ยังไม่มีการเปลี่ยนแปลงที่ Add ไว้ ให้กด Add ก่อน");
    if (Object.keys(state.commits).length >= GIT_LIMITS.commits) commit.push("ครบ 200 commit แล้ว ให้กด Reset demo หรือเพิ่มตัวจำลองใหม่");

    if ((review ? headCommitId(repo) : repo.mainHead) === null) push.push(`${repositoryLabel(machine)} ยังไม่มี commit ให้ Push`);
    if (currentBranch(repo) !== MAIN_BRANCH) {
      if (!review) { push.push(NOT_ON_MAIN_MESSAGE); pull.push(NOT_ON_MAIN_MESSAGE); }
      resetToRemote.push(NOT_ON_MAIN_MESSAGE);
    }
    if (merging) { push.push(MERGING_BLOCKED_MESSAGE); pull.push(MERGING_BLOCKED_MESSAGE); }
    else { mergeTake.push("ตอนนี้ไม่ได้อยู่ระหว่าง merge"); mergeAbort.push("ตอนนี้ไม่ได้อยู่ระหว่าง merge"); }

    if (!merging && projection.ok && !isClean(projected, machine)) pull.push(DIRTY_WORKTREE_MESSAGE);
    if (remoteEmpty) pull.push(`${host} ยังไม่มี commit ให้ Pull`);
    if (realRepo.originMainHead === null) resetToRemote.push(`ยังไม่รู้เวอร์ชันของ ${host} ให้ Pull ก่อน`);
  }

  return {
    stage: availability(stage),
    commit: availability(commit),
    push: availability(push),
    pull: availability(pull),
    clone: availability(clone),
    mergeTake: availability(mergeTake),
    mergeAbort: availability(mergeAbort),
    resetToRemote: availability(resetToRemote),
    reset: availability([...blockers]),
  };
}

export function draftErrorMessage(validation: Extract<FileValidation, { ok: false }>): string {
  return describeFileValidationError(validation.error);
}

export type GitStep = "stage" | "commit" | "push" | "pull" | "resolve";

/**
 * The step the panel highlights as "next": Add while the (projected) file has unadded changes, then Commit
 * while something is added, then — from step 2 — Push when ahead, Pull when behind or diverged (Pull merges).
 * While merging: edit the file until no marker is left, then Add, then Commit.
 */
export function nextGitStep(state: GitSimulationState, machine: MachineId, availability: Record<GitPanelAction, Availability>, withRemote: boolean): GitStep | null {
  const repo = state.machines[machine];
  if (!repo.initialized) return null;
  if (repo.merging) {
    if (repo.working && hasConflictMarkers(repo.working.content)) return "resolve";
    return snapshotsEqual(repo.working, repo.index) ? "commit" : "stage";
  }
  if (availability.stage.enabled) return "stage";
  if (repo.index && !snapshotsEqual(repo.index, headSnapshot(state, repo))) return "commit";
  if (!withRemote) return null;
  const counts = aheadBehind(state, machine);
  if (!counts) return availability.push.enabled ? "push" : null;
  if (counts.ahead && !counts.behind) return "push";
  if (counts.behind) return "pull";
  return null;
}

// ---------------------------------------------------------------------------
// Branch step
// ---------------------------------------------------------------------------

export type BranchRow = {
  name: string;
  plan: BranchMergePlan;
  /** `git switch <name>` */
  switch: Availability;
  /** `git merge <name>` into the current branch. */
  merge: Availability;
  /** `git branch -d <name>` */
  delete: Availability;
};
export type BranchAvailability = {
  current: string;
  create: Availability;
  /** Why the typed name is not usable (null when it is fine). */
  nameError: string | null;
  /** Every branch except the current one, `main` first. */
  others: BranchRow[];
};

export type BranchAvailabilityInput = { state: GitSimulationState; machine: MachineId; draft: FileSnapshot | null; name: string; writable: boolean };

/** Enablement of the Branch card. The dirty check reads the projected working copy (a valid draft counts as an edit). */
export function getBranchAvailability({ state, machine, draft, name, writable }: BranchAvailabilityInput): BranchAvailability {
  const projection = projectState(state, machine, draft);
  const blockers: string[] = [];
  if (!writable) blockers.push(READ_ONLY_REASON);
  if (!projection.ok) blockers.push(INVALID_DRAFT_REASON);
  const repo = state.machines[machine];
  const current = currentBranch(repo);
  const merging = repo.merging !== undefined;
  const dirty = !merging && projection.ok && !isClean(projection.state, machine);
  const full = Object.keys(state.commits).length >= GIT_LIMITS.commits;
  const limit = "ครบ 200 commit แล้ว ให้กด Reset demo หรือเพิ่มตัวจำลองใหม่";

  const check = validateBranchName(repo, name);
  const nameError = check.ok ? null : describeBranchNameError(check.error);
  const create = [...blockers];
  if (nameError) create.push(nameError);
  if (headCommitId(repo) === null) create.push(NEED_COMMIT_FOR_BRANCH_MESSAGE);
  if (merging) create.push(MERGING_BLOCKED_MESSAGE);
  if (Object.keys(repo.branches ?? {}).length >= GIT_LIMITS.branches) create.push("สร้าง branch ได้ไม่เกิน 20 อัน ลบอันที่รวมแล้วก่อน");

  const others = branchNames(repo).filter((branch) => branch !== current).map((branch): BranchRow => {
    const plan = planBranchMerge(state, machine, branch);
    const sw = [...blockers];
    if (dirty) sw.push(DIRTY_SWITCH_MESSAGE);
    const merge = [...blockers];
    if (dirty) merge.push("Commit งานที่ค้างก่อน Merge");
    if (merging) { sw.push(MERGING_BLOCKED_MESSAGE); merge.push(MERGING_BLOCKED_MESSAGE); }
    if (plan === "up-to-date") merge.push(`Already up to date: ${current} มีงานของ ${branch} ครบแล้ว`);
    if (plan === "unavailable") merge.push("ยังไม่มี commit ให้ Merge");
    if ((plan === "merge" || plan === "conflict") && full) merge.push(limit);
    const remove = [...blockers];
    if (branch === MAIN_BRANCH) remove.push("main ลบไม่ได้");
    else if (plan !== "up-to-date") remove.push(`ยังมีงานที่ยังไม่ได้ Merge เข้า ${current}`);
    return { name: branch, plan, switch: availability(sw), merge: availability(merge), delete: availability(remove) };
  });
  return { current, create: availability(create), nameError, others };
}

export type BranchStepTarget = { step: GitStep | "create" | "switch" | "mergeBranch"; branch: string | null };

/**
 * The Branch step's "next": Add / Commit first; then — on main — create a branch (none yet) or merge one that has
 * work main lacks; on a branch that has its own commits, switch back to main.
 */
export function nextBranchStep(state: GitSimulationState, machine: MachineId, availability: Record<GitPanelAction, Availability>): BranchStepTarget | null {
  const base = nextGitStep(state, machine, availability, false);
  if (base) return { step: base, branch: null };
  if (state.machines[machine].merging) return null;
  const repo = state.machines[machine];
  const head = headCommitId(repo);
  if (!repo.initialized || head === null) return null;
  if (currentBranch(repo) === MAIN_BRANCH) {
    const names = branchNames(repo).filter((name) => name !== MAIN_BRANCH);
    if (names.length === 0) return { step: "create", branch: null };
    const pending = names.find((name) => ["fast-forward", "merge", "conflict"].includes(planBranchMerge(state, machine, name)));
    return pending ? { step: "mergeBranch", branch: pending } : null;
  }
  const hasOwnWork = !isAncestor(head, branchTip(repo, MAIN_BRANCH), repo.knownCommitIds, state.commits);
  return hasOwnWork ? { step: "switch", branch: MAIN_BRANCH } : null;
}

// ---------------------------------------------------------------------------
// Merge Request lesson
// ---------------------------------------------------------------------------

export type RequestAvailability = { open: Availability; approve: Availability; merge: Availability };

/**
 * Enablement of the Merge Request buttons. The reducer is the single source of the rules, so each button is tried
 * on the real state and its refusal message becomes the reason shown under the button.
 */
export function getRequestAvailability({ state, machine, writable, id, host }: { state: GitSimulationState; machine: MachineId; writable: boolean; id: number | null; host?: HostId }): RequestAvailability {
  const blockers = writable ? [] : [READ_ONLY_REASON];
  const trial = (action: GitAction): Availability => {
    const transition = applyGitAction(state, action);
    return availability(transition.outcome === "success" ? blockers : [...blockers, describeGitTransition(action, transition, host)]);
  };
  const none = availability([...blockers, `ยังไม่มี ${hostOf(host).mergeRequest}ที่เปิดอยู่`]);
  return {
    open: trial({ type: "mrOpen", machine }),
    approve: id === null ? none : trial({ type: "mrApprove", machine, id }),
    merge: id === null ? none : trial({ type: "mrMerge", machine, id }),
  };
}

export type ReviewStepTarget = { step: GitStep | "create" | "switch" | "openMr" | "approve" | "mergeMr"; branch: string | null; id?: number };

/**
 * "ทำต่อ" for the whole loop, from the point of view of the machine shown: edit → Add → Commit, then
 * (main is protected) branch → push branch → open the request → the OTHER machine approves → merge → both
 * `git switch main` + `git pull`. A request that conflicts with main sends its author back to the branch to pull main in.
 */
export function nextReviewStep(state: GitSimulationState, machine: MachineId, availability: Record<GitPanelAction, Availability>): ReviewStepTarget | null {
  const repo = state.machines[machine];
  if (!repo.initialized) return null;
  const base = nextGitStep(state, machine, availability, false);
  if (base) return { step: base, branch: null };
  const head = headCommitId(repo);
  if (repo.merging || head === null) return null;
  const { remote } = state;
  if (remote.mainHead === null) return machine === "A" ? { step: "push", branch: null } : null;
  const branch = currentBranch(repo);
  const request = currentRequest(state);
  const info = request ? requestInfo(state, request) : null;
  if (request && info?.mergeable) return { step: "mergeMr", branch: null, id: request.id };
  if (request?.status === "open" && info) {
    if (info.conflict) {
      if (machine !== request.author) return null;
      return branch === request.source ? { step: "pull", branch: null } : { step: "switch", branch: request.source };
    }
    if (!info.approved) return machine === request.author ? null : { step: "approve", branch: null, id: request.id };
  }
  if (branch === MAIN_BRANCH) {
    // The simulator sees the remote directly: main has moved on even before this machine has fetched.
    const seen = new Set([...repo.knownCommitIds, ...remote.knownCommitIds]);
    if (repo.mainHead !== remote.mainHead && !isAncestor(remote.mainHead, repo.mainHead, seen, state.commits)) return { step: "pull", branch: null };
    const pending = branchNames(repo).find((name) => name !== MAIN_BRANCH && !isAncestor(branchTip(repo, name), repo.mainHead, seen, state.commits));
    return pending ? { step: "switch", branch: pending } : { step: "create", branch: null };
  }
  const pushed = remote.branches?.[branch];
  if (pushed === undefined && request?.status === "merged" && request.source === branch) return { step: "switch", branch: MAIN_BRANCH };
  if (isAncestor(head, remote.mainHead, repo.knownCommitIds, state.commits)) return null; // nothing of its own yet: edit the file
  if (pushed !== head) return { step: "push", branch: null };
  return openRequestFor(state, branch) ? null : { step: "openMr", branch: null };
}
