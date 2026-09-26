"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// Laser pointer for live teaching (screen share / projector): a glowing dot that follows the pointer and a
// short trail that fades by itself. Session-only visuals: nothing is saved, nothing enters Undo or export.

export type LaserHandle = { move: (point: { x: number; y: number }) => void; hide: () => void };
type TrailPoint = { x: number; y: number; t: number };

export const LASER_TRAIL_MS = 700;

type Pt = { x: number; y: number };
/** One smooth path through the points (quadratic curves via midpoints): no corners, no overlapping joints. */
export function smoothPath(points: Pt[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const next = points[i + 1];
    d += ` Q ${points[i].x} ${points[i].y} ${(points[i].x + next.x) / 2} ${(points[i].y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Core of the trail, oldest → newest: thin and light at the tail, full red at the head. Opaque, so joints never show. */
const TRAIL_BANDS = [
  { colour: "#FECACA", width: 2 },
  { colour: "#FCA5A5", width: 3 },
  { colour: "#F87171", width: 4 },
  { colour: "#EF4444", width: 5 },
] as const;

export function LaserPointer({ handleRef }: { handleRef: RefObject<LaserHandle | null> }) {
  const trail = useRef<TrailPoint[]>([]);
  // The dot stays where the pointer is, even after the trail behind it has faded.
  const dot = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef(0);
  // One snapshot per animation frame; render reads only this state.
  const [view, setView] = useState<{ points: TrailPoint[]; dot: { x: number; y: number } | null; now: number }>({ points: [], dot: null, now: 0 });

  useEffect(() => {
    const loop = () => {
      const time = performance.now();
      trail.current = trail.current.filter((point) => time - point.t < LASER_TRAIL_MS);
      setView({ points: [...trail.current], dot: dot.current, now: time });
      // Keep animating only while a trail is fading; a still dot needs no frames.
      frame.current = trail.current.length ? requestAnimationFrame(loop) : 0;
    };
    handleRef.current = {
      move(point) {
        dot.current = { x: point.x, y: point.y };
        trail.current.push({ ...point, t: performance.now() });
        if (!frame.current) frame.current = requestAnimationFrame(loop);
      },
      hide() {
        dot.current = null;
        if (!frame.current) frame.current = requestAnimationFrame(loop);
      },
    };
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      handleRef.current = null;
    };
  }, [handleRef]);

  const { points, dot: head } = view;
  // The tail shortens by itself as old points expire; bands share their end points so the curve is continuous.
  const bands = points.length < 2 ? [] : TRAIL_BANDS.map((band, index) => {
    const from = Math.floor((index * (points.length - 1)) / TRAIL_BANDS.length);
    const to = Math.floor(((index + 1) * (points.length - 1)) / TRAIL_BANDS.length);
    return { ...band, d: smoothPath(points.slice(from, to + 1)) };
  }).filter((band) => band.d);
  return <svg aria-hidden data-testid="laser-pointer" className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
    {points.length > 1 && <path d={smoothPath(points)} fill="none" stroke="#EF4444" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" opacity={0.14} />}
    {bands.map((band) => <path key={band.colour} d={band.d} fill="none" stroke={band.colour} strokeWidth={band.width} strokeLinecap="round" strokeLinejoin="round" />)}
    {head && <>
      <circle cx={head.x} cy={head.y} r={16} fill="#EF4444" opacity={0.18} />
      <circle cx={head.x} cy={head.y} r={7} fill="#EF4444" stroke="#FFFFFF" strokeWidth={2} />
    </>}
  </svg>;
}
