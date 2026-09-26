import { applyGitAction } from "../../domain/git/reducer";
import {
  aheadBehind, headSnapshot, isClean, isDiverged, snapshotsEqual, validateCommitMessage, validateFileSnapshot, type FileValidation,
} from "../../domain/git/selectors";
import { DIRTY_WORKTREE_MESSAGE, describeFileValidationError, describeMessageValidationError, repositoryLabel } from "../../domain/git/messages";
import { GIT_LIMITS, type FileSnapshot, type GitSimulationState, type MachineId } from "../../domain/git/model";

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

export type GitPanelAction = "stage" | "commit" | "push" | "pull" | "clone" | "merge" | "resetToRemote" | "reset";
export type Availability = { enabled: boolean; reasons: string[] };
export type ActionAvailabilityInput = {
  state: GitSimulationState;
  machine: MachineId;
  draft: FileSnapshot | null;
  message: string;
  writable: boolean;
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
export function getActionAvailability({ state, machine, draft, message, writable }: ActionAvailabilityInput): Record<GitPanelAction, Availability> {
  const projection = projectState(state, machine, draft);
  const blockers: string[] = [];
  if (!writable) blockers.push(READ_ONLY_REASON);
  if (!projection.ok) blockers.push(INVALID_DRAFT_REASON);
  const projected = projection.state;
  const repo = projected.machines[machine];
  const realRepo = state.machines[machine];
  const remoteEmpty = state.remote.mainHead === null;
  const notCloned = `${repositoryLabel(machine)} ยังไม่ได้ Clone`;

  const stage: string[] = [...blockers];
  const commit: string[] = [...blockers];
  const push: string[] = [...blockers];
  const pull: string[] = [...blockers];
  const clone: string[] = [...blockers];
  const merge: string[] = [...blockers];
  const resetToRemote: string[] = [...blockers];

  if (!repo.initialized) {
    stage.push(notCloned); commit.push(notCloned); push.push(notCloned); pull.push(notCloned); merge.push(notCloned); resetToRemote.push(notCloned);
    if (remoteEmpty) clone.push("GitHub ยังไม่มี commit ให้ Clone ให้เครื่อง A Push ก่อน");
  } else {
    clone.push(`${repositoryLabel(machine)} มี repository แล้ว`);
    if (projection.ok && snapshotsEqual(repo.working, repo.index)) stage.push("ไฟล์ตรงกับที่ Add ไว้แล้ว");

    const messageCheck = validateCommitMessage(message);
    if (!messageCheck.ok) commit.push(describeMessageValidationError(messageCheck.error));
    if (realRepo.index === null || snapshotsEqual(realRepo.index, headSnapshot(state, realRepo))) commit.push("ยังไม่มีการเปลี่ยนแปลงที่ Add ไว้ ให้กด Add ก่อน");
    if (Object.keys(state.commits).length >= GIT_LIMITS.commits) commit.push("ครบ 200 commit แล้ว ให้กด Reset demo หรือเพิ่มตัวจำลองใหม่");

    if (repo.mainHead === null) push.push(`${repositoryLabel(machine)} ยังไม่มี commit ให้ Push`);

    if (projection.ok && !isClean(projected, machine)) pull.push(DIRTY_WORKTREE_MESSAGE);
    if (remoteEmpty) pull.push("GitHub ยังไม่มี commit ให้ Pull");

    if (!isDiverged(state, machine)) merge.push(`${repositoryLabel(machine)} ไม่ได้แยกกับ GitHub`);
    if (projection.ok && !isClean(projected, machine)) merge.push("Commit งานที่ค้างก่อน Merge");
    if (Object.keys(state.commits).length >= GIT_LIMITS.commits) merge.push("ครบ 200 commit แล้ว ให้กด Reset demo หรือเพิ่มตัวจำลองใหม่");
    if (realRepo.originMainHead === null) resetToRemote.push("ยังไม่รู้เวอร์ชันของ GitHub ให้ Pull ก่อน");
  }

  return {
    stage: availability(stage),
    commit: availability(commit),
    push: availability(push),
    pull: availability(pull),
    clone: availability(clone),
    merge: availability(merge),
    resetToRemote: availability(resetToRemote),
    reset: availability([...blockers]),
  };
}

export function draftErrorMessage(validation: Extract<FileValidation, { ok: false }>): string {
  return describeFileValidationError(validation.error);
}

export type GitStep = "stage" | "commit" | "push" | "pull" | "merge";

/**
 * The step the panel highlights as "next": Add while the (projected) file has unadded changes, then Commit
 * while something is added, then — from step 2 — Push when ahead, Pull when behind, Merge when diverged.
 */
export function nextGitStep(state: GitSimulationState, machine: MachineId, availability: Record<GitPanelAction, Availability>, withRemote: boolean): GitStep | null {
  const repo = state.machines[machine];
  if (!repo.initialized) return null;
  if (availability.stage.enabled) return "stage";
  if (repo.index && !snapshotsEqual(repo.index, headSnapshot(state, repo))) return "commit";
  if (!withRemote) return null;
  const counts = aheadBehind(state, machine);
  if (!counts) return availability.push.enabled ? "push" : null;
  if (counts.ahead && !counts.behind) return "push";
  if (counts.behind && !counts.ahead) return "pull";
  if (counts.behind && counts.ahead) return "merge";
  return null;
}
