"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// Laser pointer for live teaching (screen share / projector): a glowing dot that follows the pointer and a
// short trail that fades by itself. Session-only visuals: nothing is saved, nothing enters Undo or export.

export type LaserHandle = { move: (point: { x: number; y: number }) => void; hide: () => void };
type TrailPoint = { x: number; y: number; t: number };

export const LASER_TRAIL_MS = 700;

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

  const { points, now, dot: head } = view;
  return <svg aria-hidden data-testid="laser-pointer" className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
    {points.slice(1).map((point, index) => {
      const previous = points[index];
      const life = Math.max(0, 1 - (now - point.t) / LASER_TRAIL_MS);
      return <line key={point.t + index} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y}
        stroke="#EF4444" strokeWidth={2 + life * 6} strokeLinecap="round" opacity={life * 0.85} />;
    })}
    {head && <>
      <circle cx={head.x} cy={head.y} r={16} fill="#EF4444" opacity={0.18} />
      <circle cx={head.x} cy={head.y} r={7} fill="#EF4444" stroke="#FFFFFF" strokeWidth={2} />
    </>}
  </svg>;
}
