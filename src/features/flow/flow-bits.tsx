"use client";

import { useEffect, useRef } from "react";
import { Arc, Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { FlowTone, MarkTone } from "@/domain/data/model";

// Shared Konva pieces of the flow simulators (plan 07 §2): text that never overflows, pipes,
// gates, the moving packet and the caption bar. Deterministic for export (the packet only animates
// imperatively and is never drawn when there is no play).

export type Pt = { x: number; y: number };

export const TONE_COLOR: Record<FlowTone, string> = {
  data: "#2563EB", request: "#7C3AED", ok: "#16A34A", blocked: "#DC2626", leak: "#DC2626", lost: "#94A3B8",
};
export const MARK_STYLE: Record<MarkTone, { fill: string; stroke: string; text: string }> = {
  new: { fill: "#DCFCE7", stroke: "#16A34A", text: "#166534" },
  changed: { fill: "#DBEAFE", stroke: "#2563EB", text: "#1E40AF" },
  stale: { fill: "#FEE2E2", stroke: "#DC2626", text: "#991B1B" },
  blocked: { fill: "#FEE2E2", stroke: "#DC2626", text: "#991B1B" },
  allowed: { fill: "#DCFCE7", stroke: "#16A34A", text: "#166534" },
  leak: { fill: "#FEE2E2", stroke: "#DC2626", text: "#991B1B" },
  removed: { fill: "#F1F5F9", stroke: "#94A3B8", text: "#64748B" },
  read: { fill: "#FEF3C7", stroke: "#F59E0B", text: "#92400E" },
  refresh: { fill: "#F8FAFC", stroke: "#94A3B8", text: "#475569" },
};

type LabelProps = { x: number; y: number; width: number; text: string; size: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; font: string; lineHeight?: number };
/** Single-line, fixed-width text that can never overflow its box. `lineHeight` (px) centres it vertically. */
export function Label({ x, y, width, text, size, color = "#1E293B", bold = false, align = "left", font, lineHeight }: LabelProps) {
  return <Text x={x} y={y} width={width} text={text} fontSize={size} fontFamily={font} fontStyle={bold ? "bold" : "normal"}
    fill={color} align={align} wrap="none" ellipsis listening={false} lineHeight={lineHeight ? lineHeight / size : 1} />;
}

/** A pipe between two places; `active` draws it in the colour of what is travelling. */
export function Pipe({ from, to, active, label, font }: { from: Pt; to: Pt; active?: FlowTone | null; label?: string; font: string }) {
  const color = active ? TONE_COLOR[active] : "#CBD5E1";
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return <Group listening={false}>
    <Line points={[from.x, from.y, to.x, to.y]} stroke="#F1F5F9" strokeWidth={14} lineCap="round" />
    <Line points={[from.x, from.y, to.x, to.y]} stroke={color} strokeWidth={active ? 4 : 3} lineCap="round" dash={active ? undefined : [8, 7]} />
    {label && <Label x={mid.x - 70} y={mid.y - 26} width={140} text={label} size={12} color="#64748B" align="center" font={font} />}
  </Group>;
}

/** A checkpoint on a pipe (type check, access rule, build …). */
export function Gate({ at, label, tone, sub, labelColor = "#334155", font }: {
  at: Pt; label?: string; tone: "idle" | "ok" | "blocked" | "leak" | "off"; sub?: string; labelColor?: string; font: string;
}) {
  const color = tone === "ok" ? "#16A34A" : tone === "blocked" || tone === "leak" ? "#DC2626" : tone === "off" ? "#94A3B8" : "#475569";
  const fill = tone === "ok" ? "#DCFCE7" : tone === "blocked" || tone === "leak" ? "#FEE2E2" : "#FFFFFF";
  const icon = tone === "ok" ? "✓" : tone === "blocked" ? "✗" : tone === "leak" ? "!" : tone === "off" ? "–" : "?";
  return <Group x={at.x} y={at.y} listening={false}>
    <Rect width={40} height={40} offsetX={20} offsetY={20} rotation={45} cornerRadius={8} fill={fill} stroke={color} strokeWidth={3}
      shadowColor="#0F172A" shadowOpacity={0.12} shadowBlur={8} />
    <Label x={-20} y={-10} width={40} text={icon} size={20} bold color={color} align="center" font={font} />
    {label && <Label x={-80} y={34} width={160} text={label} size={13} bold color={labelColor} align="center" font={font} />}
    {sub && <Label x={-80} y={52} width={160} text={sub} size={11} color="#64748B" align="center" font={font} />}
  </Group>;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Point at `share` (0–1) of the way along a polyline. */
export function pointAlong(path: Pt[], share: number): Pt {
  if (path.length === 1) return path[0];
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index].x, point.y - path[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let distance = Math.max(0, Math.min(1, share)) * total;
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? Math.min(1, distance / lengths[index]) : 1;
      return { x: path[index].x + (path[index + 1].x - path[index].x) * t, y: path[index].y + (path[index + 1].y - path[index].y) * t };
    }
    distance -= lengths[index];
  }
  return path[path.length - 1];
}

/**
 * The packet of the current frame: travels along `path` once in `duration` ms, then calls `onLanded`.
 * Animated imperatively so React output stays the same; with reduced motion it lands immediately.
 */
export function Packet({ path, label, tone, duration, onLanded, runKey, font }: {
  path: Pt[]; label: string; tone: FlowTone; duration: number; onLanded: () => void; runKey: string; font: string;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const landed = useRef(onLanded);
  useEffect(() => { landed.current = onLanded; });
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (prefersReducedMotion()) { landed.current(); return; }
    let frame = 0;
    let start: number | null = null;
    const place = (t: number) => {
      // Ease in-out so the packet is easy to follow on a projector.
      group.position(pointAlong(path, t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2));
    };
    const tick = (time: number) => {
      start ??= time;
      const t = Math.min(1, (time - start) / duration);
      place(t);
      group.getLayer()?.batchDraw();
      if (t < 1) frame = requestAnimationFrame(tick);
      else landed.current();
    };
    place(0);
    group.visible(true);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // runKey identifies one journey; positions are read once per journey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);
  const color = TONE_COLOR[tone];
  const width = Math.min(220, Math.max(60, [...label].length * 9 + 28));
  return <Group ref={groupRef} visible={false} listening={false}>
    <Circle radius={13} fill={color} stroke="#FFFFFF" strokeWidth={3} shadowColor={color} shadowOpacity={0.45} shadowBlur={12} />
    <Group x={-width / 2} y={-44}>
      <Rect width={width} height={26} cornerRadius={13} fill={color} shadowColor="#0F172A" shadowOpacity={0.2} shadowBlur={6} />
      <Label x={8} y={0} width={width - 16} text={label} size={13} bold color="#FFFFFF" align="center" font={font} lineHeight={26} />
    </Group>
  </Group>;
}

/**
 * Spinner over an app screen while it waits for the travelling packet (editor only; export has no play).
 * `refresh` covers the screen completely: the app restarted and shows nothing yet.
 */
export function AppSpinner({ box, kind, font }: { box: { x: number; y: number; w: number; h: number }; kind: "load" | "save" | "refresh"; font: string }) {
  const arcRef = useRef<Konva.Arc>(null);
  useEffect(() => {
    const arc = arcRef.current;
    if (!arc || prefersReducedMotion()) return;
    let frame = 0;
    let start: number | null = null;
    const tick = (time: number) => {
      start ??= time;
      arc.rotation(((time - start) * 0.4) % 360);
      arc.getLayer()?.batchDraw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const text = kind === "save" ? "กำลังบันทึก…" : kind === "refresh" ? "↻ กำลังรีเฟรช…" : "กำลังโหลด…";
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2 - 12;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={10} fill={kind === "refresh" ? "#F1F5F9" : "#F8FAFC"} opacity={kind === "refresh" ? 1 : 0.86} />
    <Circle x={cx} y={cy} radius={18} stroke="#E2E8F0" strokeWidth={5} />
    <Arc ref={arcRef} x={cx} y={cy} innerRadius={15.5} outerRadius={20.5} angle={110} fill={kind === "refresh" ? "#64748B" : "#2563EB"} />
    <Label x={box.x + 6} y={cy + 28} width={box.w - 12} text={text} size={13} bold color="#334155" align="center" font={font} />
  </Group>;
}

/** Dark bar under the board: the current frame's sentence (or the step's hint when idle). */
export function CaptionBar({ box, text, step, font }: { box: { x: number; y: number; w: number; h: number }; text: string; step: string | null; font: string }) {
  return <Group x={box.x} y={box.y} listening={false}>
    <Rect width={box.w} height={box.h} cornerRadius={12} fill="#0F172A" />
    {step && <>
      <Rect x={10} y={(box.h - 28) / 2} width={62} height={28} cornerRadius={14} fill="#2563EB" />
      <Label x={10} y={(box.h - 28) / 2} width={62} text={step} size={14} bold color="#FFFFFF" align="center" font={font} lineHeight={28} />
    </>}
    <Label x={step ? 84 : 18} y={0} width={box.w - (step ? 100 : 36)} text={text} size={17} bold={Boolean(step)} color="#F8FAFC" font={font} lineHeight={box.h} />
  </Group>;
}
