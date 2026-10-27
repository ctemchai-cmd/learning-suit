import { blank, clusters, defaultSegment, type Segment } from "./line-break";

// Bold for some words (plan 03 §text): the text stays a plain string; a bold run is wrapped in Markdown-style
// `**…**` markers. The board, the measuring and the export hide the markers and draw the run in bold.
//
// What counts as a marker pair (so a text typed before this feature, with a literal "**", keeps rendering as typed
// unless it really looks like `**bold**`): both markers on the same line; the opening one is followed, and the closing
// one preceded, by a character that is neither a space nor "*"; the run is not empty. Anything else is literal text.
// A pair never spans a line break: bolding several lines marks each line separately.

export type Run = { text: string; bold: boolean };
export type RichLine = Run[];
export type RunMeasure = (text: string, bold: boolean) => number;

const MARK = "**";
const space = (ch: string | undefined) => ch === undefined || /^\s$/u.test(ch);
const solid = (ch: string | undefined) => ch !== undefined && !space(ch) && ch !== "*";

type Seg = { text: string; bold: boolean; at: number };
/** Pieces of one line (no "\n") with their offset in the line's raw text; markers are not part of any piece. */
function scanLine(line: string): Seg[] {
  const out: Seg[] = [];
  let plainFrom = 0, i = 0;
  const flushPlain = (to: number) => { if (to > plainFrom) out.push({ text: line.slice(plainFrom, to), bold: false, at: plainFrom }); };
  while (i < line.length) {
    if (line.startsWith(MARK, i) && solid(line[i + 2])) {
      let close = line.indexOf(MARK, i + 3);
      while (close >= 0 && !solid(line[close - 1])) close = line.indexOf(MARK, close + 1);
      if (close >= 0) {
        flushPlain(i);
        out.push({ text: line.slice(i + 2, close), bold: true, at: i + 2 });
        i = close + 2; plainFrom = i;
        continue;
      }
    }
    i++;
  }
  flushPlain(line.length);
  return out;
}

/** The runs of every line of a text (an empty line has no runs). Adjacent runs of the same weight are merged. */
export function parseRichText(text: string): RichLine[] {
  return text.split("\n").map((line) => {
    const runs: Run[] = [];
    for (const seg of scanLine(line)) {
      const last = runs[runs.length - 1];
      if (last && last.bold === seg.bold) last.text += seg.text; else runs.push({ text: seg.text, bold: seg.bold });
    }
    return runs;
  });
}

/** Does the text hold at least one bold run? (cheap test first: most texts have no "**") */
export const hasBoldRuns = (text: string): boolean => text.includes(MARK) && text.split("\n").some((line) => scanLine(line).some((seg) => seg.bold));
/** The text as read, without the markers of its bold runs. A text without bold runs is returned unchanged. */
export const plainText = (text: string): string => hasBoldRuns(text) ? parseRichText(text).map((line) => line.map((run) => run.text).join("")).join("\n") : text;

// ---- line breaking with mixed weights -------------------------------------------------------------------------

const lineWidth = (line: RichLine, measure: RunMeasure) => line.reduce((sum, run) => sum + measure(run.text, run.bold), 0);
const push = (line: RichLine, run: Run) => {
  if (!run.text) return;
  const last = line[line.length - 1];
  if (last && last.bold === run.bold) last.text += run.text; else line.push({ ...run });
};
const trimEnd = (line: RichLine): RichLine => {
  const out = line.map((run) => ({ ...run }));
  while (out.length) {
    const last = out[out.length - 1];
    last.text = last.text.replace(/\s+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
};

/**
 * `breakLines` for a text with bold runs: the same word-aware breaking (Thai words by segmenter, a too-wide word by
 * character), each piece measured in the weight it is drawn in. Returns the lines as runs; the markers are gone.
 */
export function breakRichLines(text: string, maxWidth: number, measure: RunMeasure, segment: Segment = defaultSegment): RichLine[] {
  const lines: RichLine[] = [];
  for (const runs of parseRichText(text)) {
    const plain = runs.map((run) => run.text).join("");
    const boldAt: boolean[] = [];
    for (const run of runs) for (let k = 0; k < run.text.length; k++) boldAt.push(run.bold);
    const slice = (from: number, to: number): RichLine => {
      const out: RichLine = [];
      for (let k = from; k < to; k++) push(out, { text: plain[k], bold: boldAt[k] });
      return out;
    };
    let line: RichLine = [], width = 0, at = 0;
    const append = (part: RichLine, partWidth: number) => { for (const run of part) push(line, run); width += partWidth; };
    const flush = () => { lines.push(trimEnd(line)); line = []; width = 0; };
    for (const piece of plain ? segment(plain) : []) {
      const part = slice(at, at + piece.length);
      at += piece.length;
      const partWidth = lineWidth(part, measure);
      if (!line.length ? blank(piece) || partWidth <= maxWidth : width + partWidth <= maxWidth) { append(part, partWidth); continue; }
      if (blank(piece)) { append(part, partWidth); continue; }
      if (line.length) flush();
      if (partWidth <= maxWidth) { append(part, partWidth); continue; }
      let offset = at - piece.length;
      for (const cluster of clusters(piece)) {
        const cell = slice(offset, offset + cluster.length), cellWidth = lineWidth(cell, measure);
        offset += cluster.length;
        if (line.length && width + cellWidth > maxWidth) flush();
        append(cell, cellWidth);
      }
    }
    flush();
  }
  return lines;
}

/** `clampLines` for runs: at most `maxLines`; when lines are cut the last one ends with "…" (in the weight of what it follows). */
export function clampRichLines(lines: RichLine[], maxLines: number, maxWidth: number, measure: RunMeasure): RichLine[] {
  const keep = Math.max(1, Math.floor(maxLines));
  if (lines.length <= keep) return lines;
  const cut = lines.slice(0, keep);
  const cells: Run[] = [];
  for (const run of cut[keep - 1]) for (const cluster of clusters(run.text)) cells.push({ text: cluster, bold: run.bold });
  const build = (): RichLine => { const out: RichLine = []; for (const cell of cells) push(out, cell); return out; };
  const withDots = (): RichLine => { const out = trimEnd(build()); push(out, { text: "…", bold: cells.length ? cells[cells.length - 1].bold : false }); return out; };
  while (cells.length && lineWidth(withDots(), measure) > maxWidth) cells.pop();
  cut[keep - 1] = withDots();
  return cut;
}

// ---- editing: ⌘B on a selection -------------------------------------------------------------------------------

type Cell = { ch: string; bold: boolean; raw: number };
const isMark = (ch: string) => /^\p{M}$/u.test(ch);

/**
 * ⌘B on the selected part [start, end) of the raw text (UTF-16 offsets, as a textarea reports them): the words in it
 * become bold, or — when all of them already are — normal again. Spaces at the ends of the selection and line breaks
 * are left out, a Thai mark stays with its letter, adjacent runs merge. Returns the new raw text and the selection
 * on the same words; null when there is nothing to change (empty selection, only spaces, or over the length limit).
 */
export function toggleBoldRange(text: string, start: number, end: number, maxCodePoints = Infinity): { text: string; start: number; end: number } | null {
  const cells: Cell[] = [];
  let lineStart = 0;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const seg of scanLine(line)) {
      let at = seg.at;
      for (const ch of seg.text) { cells.push({ ch, bold: seg.bold, raw: lineStart + at }); at += ch.length; }
    }
    if (index < lines.length - 1) cells.push({ ch: "\n", bold: false, raw: lineStart + line.length });
    lineStart += line.length + 1;
  });
  let a = cells.findIndex((cell) => cell.raw >= start), b = cells.findIndex((cell) => cell.raw >= end);
  if (a < 0) return null;
  if (b < 0) b = cells.length;
  while (a > 0 && a < b && isMark(cells[a].ch)) a--;
  while (b < cells.length && b > a && isMark(cells[b].ch)) b++;
  while (a < b && space(cells[a].ch)) a++;
  while (b > a && space(cells[b - 1].ch)) b--;
  if (a >= b) return null;
  const targets = cells.slice(a, b).filter((cell) => cell.ch !== "\n");
  const bold = !targets.every((cell) => cell.bold);
  for (const cell of targets) cell.bold = bold;

  // write it back, line by line: a bold run keeps no space at its ends and needs a solid first and last character
  let out = "";
  const position: number[] = new Array(cells.length);
  let index = 0;
  while (index < cells.length) {
    if (cells[index].ch === "\n") { position[index] = out.length; out += "\n"; index++; continue; }
    let to = index;
    while (to < cells.length && cells[to].ch !== "\n" && cells[to].bold === cells[index].bold) to++;
    let from = index, upto = to;
    if (cells[index].bold) {
      while (from < upto && space(cells[from].ch)) from++;
      while (upto > from && space(cells[upto - 1].ch)) upto--;
    }
    const marked = cells[index].bold && from < upto && solid(cells[from].ch) && solid(cells[upto - 1].ch);
    const emit = (k: number) => { position[k] = out.length; out += cells[k].ch; };
    if (!marked) for (let k = index; k < to; k++) emit(k);
    else {
      for (let k = index; k < from; k++) emit(k);
      out += MARK;
      for (let k = from; k < upto; k++) emit(k);
      out += MARK;
      for (let k = upto; k < to; k++) emit(k);
    }
    index = to;
  }
  if ([...out].length > maxCodePoints) return null;
  return { text: out, start: position[a], end: position[b - 1] + cells[b - 1].ch.length };
}
