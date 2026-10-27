"use client";

import { Group, Rect, Text } from "react-konva";
import type { RichLine } from "@/domain/document/rich-text";
import { CANVAS_FONT, richLineWidth } from "./font-metrics";

/**
 * Text with bold words (plan 03 §text): every line is drawn run by run — one Konva Text per run, in its own weight —
 * placed left / centre / right inside `width` from the measured width of the line. Plain text keeps using one Konva
 * Text; this body is only for lines that hold a bold run (see `usesRichLines`). `hit` adds an invisible box so the
 * whole text box is clickable like a plain text node.
 */
export function RichTextBody({ lines, x = 0, y = 0, width, fontSize, lineHeight, color, align, hit = false }: {
  lines: RichLine[];
  x?: number;
  y?: number;
  width: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  align: "left" | "center" | "right";
  hit?: boolean;
}) {
  const step = fontSize * lineHeight;
  return <Group x={x} y={y}>
    {hit && <Rect width={width} height={Math.max(1, lines.length) * step} fill="rgba(0,0,0,0)" />}
    {lines.map((line, row) => {
      const lineWidth = richLineWidth(line, fontSize);
      let at = align === "left" ? 0 : align === "right" ? width - lineWidth : (width - lineWidth) / 2;
      return line.map((run, index) => {
        const left = at;
        at += richLineWidth([run], fontSize);
        return <Text key={`${row}-${index}`} x={left} y={row * step} text={run.text} fontSize={fontSize} fontFamily={CANVAS_FONT} fontStyle={run.bold ? "bold" : "normal"}
          lineHeight={lineHeight} fill={color} wrap="none" listening={false} />;
      });
    })}
  </Group>;
}
