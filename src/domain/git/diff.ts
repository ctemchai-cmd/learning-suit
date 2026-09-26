// Line diff for “what did this commit change?” (plan 04 §5 commit preview). Pure and deterministic.

export type DiffLine = { kind: "same" | "add" | "del"; text: string; /** line number in the new file (same/add) */ line: number | null };

/** Lines of a file; a final newline does not count as an extra empty line. */
function linesOf(content: string): string[] {
  if (content === "") return [];
  const lines = content.replace(/\r/g, "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Above this many cells the middle part falls back to “all removed, then all added”. */
const MAX_CELLS = 2_000_000;

/**
 * Longest-common-subsequence diff of two texts, line by line. Common prefix/suffix are matched first,
 * so typical small edits stay cheap even for long files.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before), b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);

  const middle: Omit<DiffLine, "line">[] = [];
  if (midA.length * midB.length > MAX_CELLS) {
    midA.forEach((text) => middle.push({ kind: "del", text }));
    midB.forEach((text) => middle.push({ kind: "add", text }));
  } else {
    // table[i][j] = LCS length of midA[i..] and midB[j..]
    const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) { middle.push({ kind: "same", text: midA[i] }); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) middle.push({ kind: "del", text: midA[i++] });
      else middle.push({ kind: "add", text: midB[j++] });
    }
    while (i < midA.length) middle.push({ kind: "del", text: midA[i++] });
    while (j < midB.length) middle.push({ kind: "add", text: midB[j++] });
  }

  const all = [
    ...a.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ kind: "same" as const, text })),
  ];
  let line = 0;
  return all.map((item) => ({ ...item, line: item.kind === "del" ? null : ++line }));
}

export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((line) => line.kind === "add").length, removed: lines.filter((line) => line.kind === "del").length };
}

/**
 * The part of a diff that fits `rows` lines, starting a little above the first change so the change is
 * always on screen. `before`/`after` = hidden lines above/below.
 */
export function diffWindow(lines: DiffLine[], rows: number): { lines: DiffLine[]; before: number; after: number } {
  if (lines.length <= rows) return { lines, before: 0, after: 0 };
  const first = Math.max(0, lines.findIndex((line) => line.kind !== "same"));
  const room = Math.max(1, rows - 1); // one row stays for “… อีก N บรรทัด”
  const start = Math.min(Math.max(0, first - 2), Math.max(0, lines.length - room));
  const shown = lines.slice(start, start + room);
  return { lines: shown, before: start, after: lines.length - start - shown.length };
}
