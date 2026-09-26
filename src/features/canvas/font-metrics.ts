"use client";

import Konva from "konva";
import type { FontMetrics } from "@/domain/document/geometry";
import type { TextNode } from "@/domain/document/model";

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

/** Measures wrapped text exactly like the Konva renderer (same font, width, lineHeight, wrap). */
export const konvaFontMetrics: FontMetrics = {
  measureText(node: TextNode) {
    const key = `${node.fontSize}|${node.lineHeight}|${node.width}|${node.align}|${node.bold ? "b" : ""}|${node.text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    measurer ??= new Konva.Text({ fontFamily: CANVAS_FONT, wrap: "word" });
    measurer.setAttrs({ text: node.text || " ", width: node.width, fontSize: node.fontSize, lineHeight: node.lineHeight, align: node.align, fontFamily: node.fontFamily, fontStyle: node.bold ? "bold" : "normal" });
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
export function resetFontMetricsCache() { cache.clear(); monoCache.clear(); }
