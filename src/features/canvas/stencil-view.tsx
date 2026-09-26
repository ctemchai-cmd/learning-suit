"use client";

import { Circle, Group, Line, Path, Rect, Text } from "react-konva";
import type { StencilKind, StencilNode } from "@/domain/document/model";
import { ICON_PATHS, type IconName } from "@/features/flow/icon-paths";
import { CANVAS_FONT } from "./font-metrics";

// Konva drawing of the ready-made pictures (plan 03 §stencils), in the node's local frame. Frames stretch
// to any box; icons keep their proportions and show the label underneath. Shared by editor and export.

const MONO = "ui-monospace, Menlo, Consolas, monospace";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const STENCIL_ICON: Partial<Record<StencilKind, IconName>> = {
  server: "server", database: "database", cloud: "cloud", internet: "globe", user: "user", users: "users",
  computer: "monitor", mobile: "phone", file: "file", folder: "folderClosed", code: "code", git: "gitBranch",
  lock: "lock", key: "key", ai: "bot", api: "webhook",
};

/** `#RRGGBB` with an alpha, for the soft tile behind an icon. */
const tint = (hex: string, alpha: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

function OneLine({ x, y, width, height, text, size, color, bold = false, align = "left", mono = false }: {
  x: number; y: number; width: number; height: number; text: string; size: number; color: string; bold?: boolean; align?: "left" | "center"; mono?: boolean;
}) {
  if (!text || width < 8 || height < 4) return null;
  return <Text x={x} y={y} width={width} height={height} text={text} fontSize={size} fontFamily={mono ? MONO : CANVAS_FONT} fontStyle={bold ? "bold" : "normal"}
    fill={color} align={align} verticalAlign="middle" wrap="none" ellipsis listening={false} />;
}

/** Window title bar: traffic lights on the left, then whatever the frame puts in it. */
function TitleBar({ w, bar, radius, fill }: { w: number; bar: number; radius: number; fill: string }) {
  const dot = clamp(bar * 0.14, 2, 6);
  return <Group listening={false}>
    <Rect x={1} y={1} width={Math.max(0, w - 2)} height={Math.max(0, bar - 1)} cornerRadius={[radius, radius, 0, 0]} fill={fill} />
    {["#EF4444", "#F59E0B", "#22C55E"].map((colour, index) => <Circle key={colour} x={bar * 0.45 + index * dot * 3} y={bar / 2} radius={dot} fill={colour} />)}
  </Group>;
}

function Browser({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const bar = clamp(h * 0.12, 16, 40), radius = clamp(Math.min(w, h) * 0.04, 2, 12);
  const pillX = bar * 0.45 + clamp(bar * 0.14, 2, 6) * 8, pillH = bar * 0.62;
  return <>
    <Rect width={w} height={h} cornerRadius={radius} fill="#FFFFFF" stroke={color} strokeWidth={2} />
    <TitleBar w={w} bar={bar} radius={radius} fill="#F1F5F9" />
    <Line points={[1, bar, w - 1, bar]} stroke="#CBD5E1" strokeWidth={1} listening={false} />
    {w - pillX - 12 > 30 && <>
      <Rect x={pillX} y={(bar - pillH) / 2} width={w - pillX - 12} height={pillH} cornerRadius={pillH / 2} fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={1} listening={false} />
      <OneLine x={pillX + pillH / 2} y={(bar - pillH) / 2} width={w - pillX - 12 - pillH} height={pillH} text={label} size={clamp(pillH * 0.55, 8, 15)} color="#475569" />
    </>}
  </>;
}

function Phone({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const radius = Math.min(w, h) * 0.14, pad = clamp(Math.min(w, h) * 0.045, 3, 14);
  const notchW = Math.min(w * 0.32, 90), notchH = clamp(pad * 0.9, 3, 12);
  const top = pad + pad * 0.6 + notchH;
  return <>
    <Rect width={w} height={h} cornerRadius={radius} fill={color} />
    <Rect x={pad} y={pad} width={Math.max(1, w - pad * 2)} height={Math.max(1, h - pad * 2)} cornerRadius={Math.max(2, radius - pad * 0.8)} fill="#FFFFFF" listening={false} />
    <Rect x={(w - notchW) / 2} y={pad + pad * 0.6} width={notchW} height={notchH} cornerRadius={notchH / 2} fill={color} listening={false} />
    <OneLine x={pad + 8} y={top + 6} width={w - pad * 2 - 16} height={clamp(w / 10, 14, 28)} text={label} size={clamp(w / 14, 10, 20)} color="#0F172A" bold align="center" />
    <Rect x={w * 0.35} y={h - pad - 10} width={w * 0.3} height={4} cornerRadius={2} fill="#CBD5E1" listening={false} />
  </>;
}

function Laptop({ w, h, color, label }: { w: number; h: number; color: string; label: string }) {
  const screenH = h * 0.88, x0 = w * 0.07, w0 = w * 0.86, pad = clamp(Math.min(w, h) * 0.03, 3, 12);
  return <>
    <Rect x={x0} width={w0} height={screenH} cornerRadius={clamp(w0 * 0.03, 2, 12)} fill={color} />
    <Rect x={x0 + pad} y={pad} width={Math.max(1, w0 - pad * 2)} height={Math.max(1, screenH - pad * 2)} cornerRadius={3} fill="#FFFFFF" listening={false} />
    <OneLine x={x0 + pad + 8} y={pad + 6} width={w0 - pad * 2 - 16} height={clamp(w / 20, 14, 28)} text={label} size={clamp(w / 28, 10, 20)} color="#0F172A" bold align="center" />
    <Line points={[w * 0.02, screenH, w * 0.98, screenH, w, h, 0, h]} closed fill={color} tension={0} />
    <Rect x={w * 0.42} y={screenH} width={w * 0.16} height={(h - screenH) * 0.35} cornerRadius={[0, 0, 3, 3]} fill="#E2E8F0" listening={false} />
  </>;
}

/** App window (`window`), dark terminal (`terminal`) and code editor with a file tab and line numbers (`editor`). */
function Window({ kind, w, h, color, label }: { kind: "window" | "terminal" | "editor"; w: number; h: number; color: string; label: string }) {
  const bar = clamp(h * 0.12, 16, 36), radius = clamp(Math.min(w, h) * 0.04, 2, 12);
  const dark = kind === "terminal";
  const titleX = bar * 0.45 + clamp(bar * 0.14, 2, 6) * 8;
  const body = <>
    <Rect width={w} height={h} cornerRadius={radius} fill={dark ? "#0F172A" : "#FFFFFF"} stroke={color} strokeWidth={2} />
    <TitleBar w={w} bar={bar} radius={radius} fill={dark ? "#1E293B" : "#F1F5F9"} />
  </>;
  if (kind === "editor") {
    const tabW = Math.min(180, w - titleX - 8), line = clamp(h * 0.07, 10, 22), gutter = clamp(w * 0.08, 18, 44);
    const rows = Math.max(0, Math.floor((h - bar - 10) / line));
    return <>
      {body}
      {tabW > 30 && <>
        <Rect x={titleX} y={bar * 0.2} width={tabW} height={bar * 0.8} cornerRadius={[6, 6, 0, 0]} fill="#FFFFFF" listening={false} />
        <OneLine x={titleX + 10} y={bar * 0.2} width={tabW - 20} height={bar * 0.8} text={label} size={clamp(bar * 0.4, 8, 14)} color="#1E293B" mono />
      </>}
      <Line points={[1, bar, w - 1, bar]} stroke="#E2E8F0" strokeWidth={1} listening={false} />
      {w > 80 && <>
        <Rect x={1} y={bar} width={gutter} height={Math.max(0, h - bar - 1)} cornerRadius={[0, 0, 0, radius]} fill="#F8FAFC" listening={false} />
        {Array.from({ length: rows }, (_, index) => <OneLine key={index} x={2} y={bar + 6 + index * line} width={gutter - 2} height={line} text={String(index + 1)} size={line * 0.6} color="#94A3B8" align="center" mono />)}
      </>}
    </>;
  }
  return <>
    {body}
    {!dark && <Line points={[1, bar, w - 1, bar]} stroke="#E2E8F0" strokeWidth={1} listening={false} />}
    <OneLine x={titleX} y={0} width={w - titleX * 2} height={bar} text={label} size={clamp(bar * 0.42, 8, 15)} color={dark ? "#CBD5E1" : "#1E293B"} bold={!dark} align="center" mono={dark} />
    {dark && <OneLine x={bar * 0.45} y={bar + 8} width={w - bar} height={clamp(h * 0.09, 12, 26)} text="$ _" size={clamp(h * 0.06, 10, 18)} color="#86EFAC" mono />}
  </>;
}

function IconStencil({ w, h, color, label, icon }: { w: number; h: number; color: string; label: string; icon: IconName }) {
  const labelSize = label ? clamp(w * 0.13, 10, 32) : 0;
  const labelH = labelSize * 1.5;
  const tile = Math.max(1, Math.min(w, h - labelH));
  const tileX = (w - tile) / 2, tileY = Math.max(0, (h - labelH - tile) / 2);
  const glyph = tile * 0.62;
  return <>
    {/* Whole box selectable, not only the thin icon lines. */}
    <Rect width={w} height={h} fill="transparent" />
    <Rect x={tileX} y={tileY} width={tile} height={tile} cornerRadius={tile * 0.22} fill={tint(color, 0.1)} listening={false} />
    <Path x={tileX + (tile - glyph) / 2} y={tileY + (tile - glyph) / 2} data={ICON_PATHS[icon]} stroke={color} strokeWidth={1.75}
      lineCap="round" lineJoin="round" scaleX={glyph / 24} scaleY={glyph / 24} listening={false} />
    <OneLine x={0} y={h - labelH} width={w} height={labelH} text={label} size={labelSize} color="#1E293B" bold align="center" />
  </>;
}

/** A stencil node's body in its local frame (the caller positions and rotates the Group). */
export function StencilBody({ node }: { node: StencilNode }) {
  const { kind, width: w, height: h, color, label } = node;
  switch (kind) {
    case "browser": return <Browser w={w} h={h} color={color} label={label} />;
    case "phone": return <Phone w={w} h={h} color={color} label={label} />;
    case "laptop": return <Laptop w={w} h={h} color={color} label={label} />;
    case "window": case "terminal": case "editor": return <Window kind={kind} w={w} h={h} color={color} label={label} />;
    default: return <IconStencil w={w} h={h} color={color} label={label} icon={STENCIL_ICON[kind] ?? "empty"} />;
  }
}
