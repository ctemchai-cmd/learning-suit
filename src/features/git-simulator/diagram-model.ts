import { aheadBehind, commitNumber, firstParentChain, headSnapshot, knownCommitsNewestFirst, repositoryKnownIds, snapshotsEqual } from "../../domain/git/selectors";
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

export type CommitTag = "main" | "origin/main";
export type GraphRow = {
  id: string;
  message: string;
  color: string;
  /**
   * 0 = the straight line of `main` (first parents); 1 = other commits this repository knows: fetched before a
   * diverged Pull, or the GitHub side that a merge commit joined in.
   */
  lane: 0 | 1;
  parentId: string | null;
  /** Second parent of a merge commit. */
  mergeParentId: string | null;
  tags: CommitTag[];
};
export const GRAPH_ROWS = 6;

export function commitGraph(state: GitSimulationState, repository: RepositoryId, limit = GRAPH_ROWS): { rows: GraphRow[]; hiddenCount: number } {
  const known = repositoryKnownIds(state, repository);
  const main = repository === "remote" ? state.remote.mainHead : state.machines[repository].mainHead;
  const origin = repository === "remote" ? null : state.machines[repository].originMainHead;
  const mainChain = new Set(firstParentChain(main, known, state.commits));
  const commits = knownCommitsNewestFirst(state, repository);
  const rows = commits.slice(0, limit).map((commit): GraphRow => {
    const tags: CommitTag[] = [];
    if (commit.id === main) tags.push("main");
    if (commit.id === origin) tags.push("origin/main");
    return {
      id: commit.id,
      message: truncateCodePoints(commit.message, 24),
      color: commitColor(commit.id),
      lane: mainChain.has(commit.id) || main === null ? 0 : 1,
      parentId: commit.parentId,
      mergeParentId: commit.mergeParentId ?? null,
      tags,
    };
  });
  return { rows, hiddenCount: Math.max(0, commits.length - limit) };
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
