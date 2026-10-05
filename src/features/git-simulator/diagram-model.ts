import { aheadBehind, branchNames, branchTip, commitNumber, currentBranch, headCommitId, headSnapshot, knownCommitsNewestFirst, repositoryKnownIds, snapshotsEqual } from "../../domain/git/selectors";
import type { GitSimulationState, MachineId, RepositoryId } from "../../domain/git/model";
import { previewLines, truncateCodePoints, type PreviewText } from "./view-model";

// Pure model of the simplified Git diagram (plan 04 §5): one pipeline per machine
// (working → stage → commits) and commit circles whose colour identifies the same commit everywhere.

/** Same commit ID → same colour on every card, so learners see where a commit exists. */
export const COMMIT_COLORS = ["#2563EB", "#EA580C", "#16A34A", "#9333EA", "#DB2777", "#0891B2", "#CA8A04", "#DC2626"] as const;
export function commitColor(id: string): string {
  const number = commitNumber(id);
  return COMMIT_COLORS[(Number.isFinite(number) && number > 0 ? number - 1 : 0) % COMMIT_COLORS.length];
}

/** "main", "origin/main", or the name of another branch. */
export type CommitTag = string;
export type GraphRow = {
  id: string;
  message: string;
  color: string;
  /**
   * 0 = the straight line of `main` (first parents); 1.. = one lane per other branch that owns commits (creation order);
   * the last extra lane holds other commits this repository knows: fetched before a diverged Pull, the GitHub side
   * a merge commit joined in, or the commits of a deleted branch.
   */
  lane: number;
  parentId: string | null;
  /** Second parent of a merge commit. */
  mergeParentId: string | null;
  tags: CommitTag[];
  /** The current branch when HEAD points at this commit (its tag is drawn as "HEAD → name"). */
  headTag: string | null;
};
export const GRAPH_ROWS = 6;

/** Lane of every commit this repository knows: `main`'s first-parent line is lane 0, each other branch gets the next lane. */
export function commitLanes(state: GitSimulationState, repository: RepositoryId): { lanes: Map<string, number>; count: number } {
  const known = new Set(repositoryKnownIds(state, repository));
  const tips: [string, string | null][] = repository === "remote"
    ? [["main", state.remote.mainHead]]
    : branchNames(state.machines[repository]).map((name) => [name, branchTip(state.machines[repository], name)]);
  const lanes = new Map<string, number>();
  let next = 1;
  for (const [name, tip] of tips) {
    let lane: number | null = null;
    for (let current = tip; current !== null && known.has(current) && !lanes.has(current); current = state.commits[current]?.parentId ?? null) {
      lane ??= name === "main" ? 0 : next++;
      lanes.set(current, lane);
    }
  }
  let used = next;
  for (const id of known) if (!lanes.has(id)) { lanes.set(id, next); used = next + 1; }
  return { lanes, count: Math.max(1, used) };
}

export function commitGraph(state: GitSimulationState, repository: RepositoryId, limit = GRAPH_ROWS): { rows: GraphRow[]; hiddenCount: number; laneCount: number } {
  const repo = repository === "remote" ? null : state.machines[repository];
  const main = repo ? repo.mainHead : state.remote.mainHead;
  const origin = repo ? repo.originMainHead : null;
  const head = repo && repo.initialized ? headCommitId(repo) : null;
  const headBranch = repo ? currentBranch(repo) : null;
  const { lanes } = commitLanes(state, repository);
  const tipTags = new Map<string, string[]>();
  for (const name of repo ? branchNames(repo) : ["main"]) {
    const tip = repo ? branchTip(repo, name) : main;
    if (tip) tipTags.set(tip, [...tipTags.get(tip) ?? [], name]);
  }
  const commits = knownCommitsNewestFirst(state, repository);
  const rows = commits.slice(0, limit).map((commit): GraphRow => {
    const tags: CommitTag[] = tipTags.get(commit.id) ?? [];
    if (commit.id === origin) tags.push("origin/main");
    return {
      id: commit.id,
      message: truncateCodePoints(commit.message, 24),
      color: commitColor(commit.id),
      lane: lanes.get(commit.id) ?? (main === null ? 0 : 1),
      parentId: commit.parentId,
      mergeParentId: commit.mergeParentId ?? null,
      tags,
      headTag: head === commit.id && headBranch && tags.includes(headBranch) ? headBranch : null,
    };
  });
  return { rows, hiddenCount: Math.max(0, commits.length - limit), laneCount: Math.max(1, ...rows.map((row) => row.lane + 1)) };
}

/** Horizontal geometry of the lane columns of a commit list (x of lane 0, gap between lanes, circle radius, x of the message). */
export function laneMetrics(laneCount: number, twoLine: boolean): { x0: number; gap: number; radius: number; textX: number } {
  const x0 = twoLine ? 20 : 22;
  const base = twoLine ? 28 : 30;
  const gap = laneCount <= 4 ? base : Math.max(12, Math.floor((base * 3) / (laneCount - 1)));
  const radius = gap >= 26 ? (twoLine ? 13 : 14) : 10;
  const last = x0 + (laneCount - 1) * gap;
  // Two lanes keep the old text position (76 / 68); more lanes push the text right.
  return { x0, gap, radius, textX: laneCount <= 1 ? (twoLine ? 42 : 46) : Math.max(twoLine ? 68 : 76, last + radius + 12) };
}

export type Tone = "pending" | "ready" | "clean" | "empty" | "info";
export type ZoneLine = { tone: Tone; text: string };
export type MachineDiagram = {
  initialized: boolean;
  sync: ZoneLine;
  fileName: string;
  working: ZoneLine & { preview: PreviewText };
  staged: ZoneLine;
};

/** Short status texts (symbol + words, never colour alone). */
export function machineDiagram(state: GitSimulationState, machine: MachineId): MachineDiagram {
  const repo = state.machines[machine];
  if (!repo.initialized) {
    return {
      initialized: false, sync: { tone: "empty", text: "ยังไม่มี repository" }, fileName: "",
      working: { tone: "empty", text: "", preview: { lines: [], totalLines: 0 } }, staged: { tone: "empty", text: "" },
    };
  }
  const head = headSnapshot(state, repo);
  const counts = aheadBehind(state, machine);
  let sync: ZoneLine;
  if (repo.mainHead === null) sync = { tone: "empty", text: "ยังไม่มี commit" };
  else if (!counts) sync = { tone: "info", text: "? ยังไม่รู้สถานะ GitHub" };
  else if (counts.ahead && counts.behind) sync = { tone: "pending", text: "↕ ประวัติแยกกับ GitHub" };
  else if (counts.ahead) sync = { tone: "ready", text: `↑ ${counts.ahead} commit ยังไม่ Push` };
  else if (counts.behind) sync = { tone: "pending", text: `↓ ตามหลัง GitHub ${counts.behind} commit` };
  else sync = { tone: "clean", text: "✓ ตรงกับ GitHub" };

  const workingChanged = !snapshotsEqual(repo.working, repo.index ?? head);
  const working: ZoneLine = repo.index === null && repo.mainHead === null
    ? { tone: "pending", text: "✎ ไฟล์ใหม่ ยังไม่ Add" }
    : workingChanged ? { tone: "pending", text: "✎ แก้แล้ว ยังไม่ Add" } : { tone: "clean", text: "✓ ไม่มีการแก้ใหม่" };
  const staged: ZoneLine = repo.index === null
    ? { tone: "empty", text: "○ ยังว่าง" }
    : !snapshotsEqual(repo.index, head) ? { tone: "ready", text: "● มีไฟล์รอ Commit" } : { tone: "clean", text: "✓ ตรงกับ commit ล่าสุด" };
  return {
    initialized: true, sync, fileName: repo.working?.name ?? "",
    working: { ...working, preview: previewLines(repo.working?.content ?? "", 2, 26) },
    staged,
  };
}

/** Branch step: the pill that says which branch HEAD is on. */
export function branchPill(state: GitSimulationState, machine: MachineId): ZoneLine {
  const name = currentBranch(state.machines[machine]);
  return { tone: name === "main" ? "info" : "ready", text: `คุณอยู่ที่ branch: ${name} (HEAD)` };
}

export function remoteDiagram(state: GitSimulationState): { sync: ZoneLine; fileLabel: string; fileName: string; preview: PreviewText } {
  const head = state.remote.mainHead;
  const snapshot = head ? state.commits[head]?.snapshot ?? null : null;
  const count = state.remote.knownCommitIds.length;
  return {
    sync: head ? { tone: "info", text: `มี ${count} commit` } : { tone: "empty", text: "ยังว่าง" },
    fileLabel: head ? `ไฟล์ใน main (${head})` : "ไฟล์ใน main",
    fileName: snapshot?.name ?? "",
    preview: previewLines(snapshot?.content ?? "", 2, 26),
  };
}

/** Narrow columns use the short form of the sync status so it never gets cut. */
export function shortSyncText(text: string): string {
  return text
    .replace(/^↑ (\d+) commit ยังไม่ Push$/, "↑ $1 ยังไม่ Push")
    .replace(/^↓ ตามหลัง GitHub (\d+) commit$/, "↓ ตามหลัง $1")
    .replace("↕ ประวัติแยกกับ GitHub", "↕ ประวัติแยก")
    .replace("? ยังไม่รู้สถานะ GitHub", "? ยังไม่รู้สถานะ");
}
