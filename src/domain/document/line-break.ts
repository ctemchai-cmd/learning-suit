// Display line breaking (plan 03 §text): the stored text never changes, only where it is wrapped on the board.
// Thai has no spaces between words, so Konva's own wrapping (spaces and dashes only) cuts Thai mid-word. Here the
// break opportunities come from a word segmenter (Intl.Segmenter "th"), the width of each piece from the real font.

export type Measure = (text: string) => number;
export type Segment = (paragraph: string) => string[];

/** Word pieces of a paragraph (spaces are pieces of their own). Falls back to splitting at spaces when there is no segmenter. */
export const defaultSegment: Segment = (() => {
  let segmenter: Intl.Segmenter | null | undefined;
  return (paragraph: string) => {
    if (segmenter === undefined) {
      try { segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("th", { granularity: "word" }) : null; } catch { segmenter = null; }
    }
    if (segmenter) return Array.from(segmenter.segment(paragraph), (part) => part.segment);
    return paragraph.split(/(\s+)/).filter(Boolean);
  };
})();

/** Characters of a word that may be cut apart (a mark stays with the letter before it). */
export const clusters = (word: string): string[] => {
  const out: string[] = [];
  for (const char of word) {
    if (out.length && /^\p{M}$/u.test(char)) out[out.length - 1] += char; else out.push(char);
  }
  return out;
};
export const blank = (text: string) => /^\s+$/.test(text);

/** Breaks `text` into lines no wider than `maxWidth`: at word boundaries, a single word wider than that by character. Explicit "\n" kept. */
export function breakLines(text: string, maxWidth: number, measure: Measure, segment: Segment = defaultSegment): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const flush = () => { lines.push(line.replace(/\s+$/, "")); line = ""; };
    for (const piece of paragraph ? segment(paragraph) : []) {
      if (!line ? blank(piece) || measure(piece) <= maxWidth : measure(line + piece) <= maxWidth) { line += piece; continue; }
      if (blank(piece)) { line += piece; continue; } // trailing spaces hang off the line end
      if (line) flush();
      if (measure(piece) <= maxWidth) { line = piece; continue; }
      // a word wider than the line: by character
      for (const part of clusters(piece)) {
        if (line && measure(line + part) > maxWidth) flush();
        line += part;
      }
    }
    flush();
  }
  return lines;
}

/** At most `maxLines` lines; when lines are cut the last one ends with "…" (shortened to fit). */
export function clampLines(lines: string[], maxLines: number, maxWidth: number, measure: Measure): string[] {
  const keep = Math.max(1, Math.floor(maxLines));
  if (lines.length <= keep) return lines;
  const cut = lines.slice(0, keep);
  let last = cut[keep - 1];
  const parts = clusters(last);
  while (parts.length && measure(parts.join("") + "…") > maxWidth) parts.pop();
  last = parts.join("").replace(/\s+$/, "") + "…";
  cut[keep - 1] = last;
  return cut;
}
