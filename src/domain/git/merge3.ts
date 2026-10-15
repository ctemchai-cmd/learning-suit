// Three-way line merge (diff3 style) — what `git merge` does to a file when both sides changed it. Pure and deterministic.
// Changes on one side are taken by themselves; the same change on both sides is no conflict; changes that touch or
// sit next to each other with different results become a conflict hunk that is written into the file as markers.

import type { FileSnapshot } from "./model";

export const MARKER_OURS = "<<<<<<<";
export const MARKER_SEPARATOR = "=======";
export const MARKER_THEIRS = ">>>>>>>";

/** Lines of a file; a final newline does not count as an extra empty line (CR dropped, like the diff view). */
export function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Above this many cells the middle of two files is treated as "nothing in common" (still correct, just a bigger conflict). */
const MAX_CELLS = 2_000_000;

/** For every line of `a`, the index of the line of `b` it is matched with (longest common subsequence), or -1. */
function matchLines(a: string[], b: string[]): number[] {
  const match = new Array<number>(a.length).fill(-1);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) { match[start] = start; start++; }
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; match[endA] = endB; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  if (!midA.length || !midB.length || midA.length * midB.length > MAX_CELLS) return match;
  const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { match[start + i] = start + j; i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return match;
}

export type MergeChunk = { kind: "ok"; lines: string[] } | { kind: "conflict"; ours: string[]; theirs: string[] };

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((line, index) => line === b[index]);

/**
 * Merges `ours` and `theirs` (both derived from `base`) line by line.
 * Lines that `base` shares with both sides anchor the merge; between two anchors a side that did not change takes the
 * other side's text, identical results are kept once, anything else is a conflict. Lines both conflicting sides
 * start or end with are moved out of the hunk, so a hunk shows only what really differs.
 */
export function mergeChunks(base: string[], ours: string[], theirs: string[]): MergeChunk[] {
  const toOurs = matchLines(base, ours);
  const toTheirs = matchLines(base, theirs);
  const chunks: MergeChunk[] = [];
  const push = (kind: "ok", lines: string[]) => {
    if (!lines.length) return;
    const last = chunks.at(-1);
    if (last?.kind === "ok") last.lines.push(...lines); else chunks.push({ kind, lines: [...lines] });
  };
  let b = 0, o = 0, t = 0; // start of the unresolved region in each file
  const resolve = (bEnd: number, oEnd: number, tEnd: number) => {
    const baseText = base.slice(b, bEnd), oursText = ours.slice(o, oEnd), theirsText = theirs.slice(t, tEnd);
    if (sameLines(oursText, baseText)) push("ok", theirsText);
    else if (sameLines(theirsText, baseText) || sameLines(oursText, theirsText)) push("ok", oursText);
    else {
      let head = 0;
      while (head < oursText.length && head < theirsText.length && oursText[head] === theirsText[head]) head++;
      let tail = 0;
      while (tail < oursText.length - head && tail < theirsText.length - head
        && oursText[oursText.length - 1 - tail] === theirsText[theirsText.length - 1 - tail]) tail++;
      push("ok", oursText.slice(0, head));
      chunks.push({ kind: "conflict", ours: oursText.slice(head, oursText.length - tail), theirs: theirsText.slice(head, theirsText.length - tail) });
      push("ok", oursText.slice(oursText.length - tail));
    }
  };
  for (let i = 0; i < base.length; i++) {
    if (toOurs[i] < 0 || toTheirs[i] < 0) continue;
    resolve(i, toOurs[i], toTheirs[i]);
    push("ok", [base[i]]);
    b = i + 1; o = toOurs[i] + 1; t = toTheirs[i] + 1;
  }
  resolve(base.length, ours.length, theirs.length);
  return chunks;
}

export type MergeLabels = { ours: string; theirs: string };
export type MergedText = { content: string; conflicts: number };

/** The merged text of three file contents. Conflict hunks are written as `<<<<<<<` / `=======` / `>>>>>>>` blocks. */
export function mergeText(base: string, ours: string, theirs: string, labels: MergeLabels): MergedText {
  const chunks = mergeChunks(splitLines(base), splitLines(ours), splitLines(theirs));
  const lines: string[] = [];
  let conflicts = 0;
  for (const chunk of chunks) {
    if (chunk.kind === "ok") { lines.push(...chunk.lines); continue; }
    conflicts++;
    lines.push(`${MARKER_OURS} ${labels.ours}`, ...chunk.ours, MARKER_SEPARATOR, ...chunk.theirs, `${MARKER_THEIRS} ${labels.theirs}`);
  }
  // The final newline follows the side that changed it (ours when both did).
  const ending = (text: string) => text.endsWith("\n");
  // An empty file has no ending of its own, so the other side decides.
  const newline = ours === "" ? ending(theirs) : theirs === "" ? ending(ours) : ending(ours) === ending(base) ? ending(theirs) : ending(ours);
  return { content: lines.length ? lines.join("\n") + (newline ? "\n" : "") : "", conflicts };
}

/** Three-way merge of whole files: contents as above; the name follows the side that renamed it (ours when both did). */
export function mergeFiles(base: FileSnapshot | null, ours: FileSnapshot, theirs: FileSnapshot, labels: MergeLabels): { file: FileSnapshot; conflicts: number } {
  const merged = mergeText(base?.content ?? "", ours.content, theirs.content, labels);
  const name = base && ours.name === base.name ? theirs.name : ours.name;
  return { file: { name, content: merged.content }, conflicts: merged.conflicts };
}

// ---------------------------------------------------------------------------
// Markers left in a file
// ---------------------------------------------------------------------------

const isMarkerOurs = (line: string) => line === MARKER_OURS || line.startsWith(`${MARKER_OURS} `);
const isMarkerTheirs = (line: string) => line === MARKER_THEIRS || line.startsWith(`${MARKER_THEIRS} `);
const isMarkerLine = (line: string) => isMarkerOurs(line) || isMarkerTheirs(line) || line === MARKER_SEPARATOR;

/** True while any conflict marker line is still in the file (the learner has not finished resolving). */
export function hasConflictMarkers(content: string): boolean {
  return content.replace(/\r/g, "").split("\n").some(isMarkerLine);
}

export type LineRole = "text" | "marker" | "ours" | "theirs";

/** Role of every line (split on "\n", so it lines up with the editor's rows): marker lines, and the two versions between them. */
export function conflictLineRoles(content: string): LineRole[] {
  let side: "ours" | "theirs" | null = null;
  return content.replace(/\r/g, "").split("\n").map((line): LineRole => {
    if (isMarkerOurs(line)) { side = "ours"; return "marker"; }
    if (line === MARKER_SEPARATOR && side === "ours") { side = "theirs"; return "marker"; }
    if (isMarkerTheirs(line)) { side = null; return "marker"; }
    return side ?? "text";
  });
}

/** Message of the merge commit Git proposes: a branch, or the fetched `origin/main`. */
export function mergeCommitMessage(label: string): string {
  return label.startsWith("origin/") ? `Merge ${label}` : `Merge branch '${label}'`;
}
