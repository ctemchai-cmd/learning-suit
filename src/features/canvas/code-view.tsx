"use client";

import { Circle, Group, Rect, Text } from "react-konva";
import type { CodeNode } from "@/domain/document/model";
import { CODE_LABEL, CODE_LINE_HEIGHT, codeLayout, highlightCode, type TokenKind } from "@/domain/document/code";
import { CANVAS_FONT, konvaFontMetrics, MONO_STACK } from "./font-metrics";

// Konva drawing of a code block (plan 03 §code) in its local frame; shared by editor and export.
// Tokens are placed one after another with the same monospace measurement the layout uses.

type Theme = { bg: string; header: string; border: string; label: string; gutter: string; colors: Record<TokenKind, string> };
export const CODE_THEMES: Record<CodeNode["theme"], Theme> = {
  dark: {
    bg: "#0F172A", header: "#1E293B", border: "#1E293B", label: "#94A3B8", gutter: "#475569",
    colors: { plain: "#E2E8F0", keyword: "#C084FC", string: "#86EFAC", comment: "#64748B", number: "#FDBA74", function: "#7DD3FC", builtin: "#67E8F9", tag: "#F87171", attr: "#FCD34D" },
  },
  light: {
    bg: "#F8FAFC", header: "#EEF2F7", border: "#CBD5E1", label: "#64748B", gutter: "#94A3B8",
    colors: { plain: "#0F172A", keyword: "#7C3AED", string: "#15803D", comment: "#94A3B8", number: "#C2410C", function: "#2563EB", builtin: "#0E7490", tag: "#DC2626", attr: "#B45309" },
  },
};

export function CodeBody({ node }: { node: CodeNode }) {
  const layout = codeLayout(node, konvaFontMetrics);
  const theme = CODE_THEMES[node.theme];
  const { fontSize } = node;
  const lines = highlightCode(node.code, node.language);
  const top = layout.header + layout.pad * 0.6;
  const left = layout.pad + layout.gutter;
  const radius = fontSize * 0.6;
  const dot = fontSize * 0.28;
  return <Group>
    <Rect width={layout.width} height={layout.height} cornerRadius={radius} fill={theme.bg} stroke={theme.border} strokeWidth={1} />
    <Rect width={layout.width} height={layout.header} cornerRadius={[radius, radius, 0, 0]} fill={theme.header} listening={false} />
    {["#EF4444", "#F59E0B", "#22C55E"].map((colour, index) => <Circle key={colour} x={layout.pad + dot + index * dot * 3} y={layout.header / 2} radius={dot} fill={colour} listening={false} />)}
    <Text x={layout.pad} y={0} width={layout.width - layout.pad * 2} height={layout.header} text={CODE_LABEL[node.language]} fontSize={fontSize * 0.7}
      fontFamily={CANVAS_FONT} fill={theme.label} align="right" verticalAlign="middle" listening={false} />
    {node.lineNumbers && lines.map((_, index) => <Text key={`n${index}`} x={layout.pad} y={top + index * layout.lineHeight} width={layout.gutter - fontSize * 0.7}
      text={String(index + 1)} fontSize={fontSize} fontFamily={MONO_STACK} lineHeight={CODE_LINE_HEIGHT} fill={theme.gutter} align="right" listening={false} />)}
    {lines.map((tokens, row) => {
      let x = left;
      return tokens.map((token, index) => {
        const at = x;
        x += konvaFontMetrics.measureMono(token.text, fontSize);
        if (!token.text.trim()) return null;
        return <Text key={`${row}:${index}`} x={at} y={top + row * layout.lineHeight} text={token.text} fontSize={fontSize} fontFamily={MONO_STACK}
          fontStyle={token.kind === "comment" ? "italic" : "normal"} lineHeight={CODE_LINE_HEIGHT} fill={theme.colors[token.kind]} wrap="none" listening={false} />;
      });
    })}
  </Group>;
}
