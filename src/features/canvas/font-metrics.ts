"use client";

import Konva from "konva";
import type { FontMetrics } from "@/domain/document/geometry";
import type { TextNode } from "@/domain/document/model";

export const CANVAS_FONT = "Noto Sans Thai";

let fontsReady: Promise<void> | null = null;
/** Loads the self-hosted Noto Sans Thai (Thai + Latin subsets) before measuring or exporting. */
export function ensureCanvasFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  fontsReady ??= Promise.all([
    document.fonts.load(`400 28px "${CANVAS_FONT}"`, "กขคABCabc123"),
    document.fonts.load(`700 28px "${CANVAS_FONT}"`, "กขคABCabc123"),
  ]).then(() => document.fonts.ready).then(() => undefined).catch(() => undefined);
  return fontsReady;
}

let measurer: Konva.Text | null = null;
const cache = new Map<string, { width: number; height: number }>();

/** Measures wrapped text exactly like the Konva renderer (same font, width, lineHeight, wrap). */
export const konvaFontMetrics: FontMetrics = {
  measureText(node: TextNode) {
    const key = `${node.fontSize}|${node.lineHeight}|${node.width}|${node.align}|${node.text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    measurer ??= new Konva.Text({ fontFamily: CANVAS_FONT, wrap: "word" });
    measurer.setAttrs({ text: node.text || " ", width: node.width, fontSize: node.fontSize, lineHeight: node.lineHeight, align: node.align, fontFamily: node.fontFamily });
    const result = { width: node.width, height: Math.max(node.fontSize * node.lineHeight, measurer.height()) };
    if (cache.size > 2000) cache.clear();
    cache.set(key, result);
    return result;
  },
};

/** Clears cached measurements after fonts finish loading (metrics change once the webfont is active). */
export function resetFontMetricsCache() { cache.clear(); }
