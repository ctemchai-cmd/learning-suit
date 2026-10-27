"use client";

import Konva from "konva";
import type { FontMetrics } from "@/domain/document/geometry";
import type { TextNode } from "@/domain/document/model";
import { breakLines, clampLines } from "@/domain/document/line-break";

export const CANVAS_FONT = "Noto Sans Thai";
/** Self-hosted monospace font of code blocks; Thai in code falls back to Noto Sans Thai. */
export const MONO_FONT = "JetBrains Mono";
export const MONO_STACK = `"${MONO_FONT}", "${CANVAS_FONT}", monospace`;

let fontsReady: Promise<void> | null = null;
/** Loads the self-hosted Noto Sans Thai (Thai + Latin subsets) before measuring or exporting. */
export function ensureCanvasFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  fontsReady ??= Promise.all([
    document.fonts.load(`400 28px "${CANVAS_FONT}"`, "กขคABCabc123"),
    document.fonts.load(`700 28px "${CANVAS_FONT}"`, "กขคABCabc123"),
    document.fonts.load(`400 16px "${MONO_FONT}"`, "def(){}ABC123"),
    document.fonts.load(`italic 400 16px "${MONO_FONT}"`, "# comment"),
  ]).then(() => document.fonts.ready).then(() => undefined).catch(() => undefined);
  return fontsReady;
}

let measurer: Konva.Text | null = null;
let monoContext: CanvasRenderingContext2D | null = null;
const monoCache = new Map<string, number>();
const cache = new Map<string, { width: number; height: number }>();

let lineContext: CanvasRenderingContext2D | null = null;
const lineCache = new Map<string, string[]>();
/** Width of a string in the canvas font (same font as the board draws with). */
function lineMeasure(fontSize: number, bold: boolean): (text: string) => number {
  lineContext ??= typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const context = lineContext;
  if (!context) return (text) => [...text].length * fontSize * 0.6;
  context.font = `${bold ? "bold " : ""}${fontSize}px "${CANVAS_FONT}"`;
  return (text) => context.measureText(text).width;
}
/**
 * The lines a text is drawn in: broken at word boundaries (Thai words via Intl.Segmenter), a word wider than the
 * width by character, at most `maxLines` (the last ends with "…"). The board, selection/connector measuring and
 * export all draw these same lines; the stored text is not changed. Memoized per text / width / font.
 */
export function displayLines(text: string, width: number, fontSize: number, bold: boolean, maxLines?: number): string[] {
  const key = `${fontSize}|${bold ? "b" : ""}|${width}|${maxLines ?? ""}|${text}`;
  const hit = lineCache.get(key);
  if (hit) return hit;
  const measure = lineMeasure(fontSize, bold);
  let lines = breakLines(text, width, measure);
  if (maxLines !== undefined) lines = clampLines(lines, maxLines, width, measure);
  if (lineCache.size > 2000) lineCache.clear();
  lineCache.set(key, lines);
  return lines;
}

/** Measures wrapped text exactly like the Konva renderer (same font, width, lineHeight, wrap). */
export const konvaFontMetrics: FontMetrics = {
  measureText(node: TextNode) {
    const key = `${node.fontSize}|${node.lineHeight}|${node.width}|${node.align}|${node.bold ? "b" : ""}|${node.text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    measurer ??= new Konva.Text({ fontFamily: CANVAS_FONT, wrap: "none" });
    measurer.setAttrs({ text: displayLines(node.text, node.width, node.fontSize, Boolean(node.bold)).join("\n") || " ", width: node.width, fontSize: node.fontSize, lineHeight: node.lineHeight, align: node.align, fontFamily: node.fontFamily, fontStyle: node.bold ? "bold" : "normal" });
    const result = { width: node.width, height: Math.max(node.fontSize * node.lineHeight, measurer.height()) };
    if (cache.size > 2000) cache.clear();
    cache.set(key, result);
    return result;
  },
  measureMono(text: string, fontSize: number) {
    if (!text) return 0;
    const key = `${fontSize}|${text}`;
    const hit = monoCache.get(key);
    if (hit !== undefined) return hit;
    monoContext ??= typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!monoContext) return [...text].length * fontSize * 0.6;
    monoContext.font = `${fontSize}px ${MONO_STACK}`;
    const width = monoContext.measureText(text).width;
    if (monoCache.size > 5000) monoCache.clear();
    monoCache.set(key, width);
    return width;
  },
};

/** Clears cached measurements after fonts finish loading (metrics change once the webfont is active). */
export function resetFontMetricsCache() { cache.clear(); monoCache.clear(); lineCache.clear(); }
