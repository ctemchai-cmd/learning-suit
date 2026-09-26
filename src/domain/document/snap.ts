import type { Bounds } from "./model";

// Snapping while dragging objects (plan 03 §snap): edges and centres line up with nearby objects
// (pink guides show which), otherwise the selection's top-left follows the visible grid.

export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };
export type SnapResult = { dx: number; dy: number; guides: Guide[] };

const linesOf = (box: Bounds, axis: "x" | "y") => axis === "x"
  ? [box.x, box.x + box.width / 2, box.x + box.width]
  : [box.y, box.y + box.height / 2, box.y + box.height];
const shifted = (box: Bounds, dx: number, dy: number): Bounds => ({ ...box, x: box.x + dx, y: box.y + dy });

/** The smallest move (within `threshold`) that puts an edge/centre of `moved` on one of another box. */
function nearestLine(axis: "x" | "y", moved: Bounds, others: Bounds[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  const mine = linesOf(moved, axis);
  for (const other of others) {
    for (const target of linesOf(other, axis)) {
      for (const value of mine) {
        const delta = target - value;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = { delta, at: target };
      }
    }
  }
  return best;
}

/** Guide line through `at`, long enough to cover the moved box and every box that shares the line. */
function guideFor(axis: "x" | "y", at: number, moved: Bounds, others: Bounds[]): Guide {
  const across = (box: Bounds) => (axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width]);
  const aligned = others.filter((other) => linesOf(other, axis).some((line) => Math.abs(line - at) < 0.5));
  const spans = [moved, ...aligned].map(across);
  return { axis, at, from: Math.min(...spans.map((span) => span[0])), to: Math.max(...spans.map((span) => span[1])) };
}

/**
 * Adjusts a drag (`dx`, `dy`) of the box `moving`. Object alignment wins over the grid; an axis locked by
 * Shift (`lockX`/`lockY`) is left alone. `threshold` is in board units (a few screen pixels / zoom).
 */
export function snapMove(moving: Bounds, others: Bounds[], dx: number, dy: number, options: { threshold: number; grid: number | null; lockX?: boolean; lockY?: boolean }): SnapResult {
  const moved = shifted(moving, dx, dy);
  const alignX = options.lockX ? null : nearestLine("x", moved, others, options.threshold);
  const alignY = options.lockY ? null : nearestLine("y", moved, others, options.threshold);
  const grid = options.grid && options.grid > 0 ? options.grid : null;
  const snapX = alignX ? alignX.delta : !options.lockX && grid ? Math.round(moved.x / grid) * grid - moved.x : 0;
  const snapY = alignY ? alignY.delta : !options.lockY && grid ? Math.round(moved.y / grid) * grid - moved.y : 0;
  const final = shifted(moving, dx + snapX, dy + snapY);
  const guides: Guide[] = [];
  if (alignX) guides.push(guideFor("x", alignX.at, final, others));
  if (alignY) guides.push(guideFor("y", alignY.at, final, others));
  return { dx: dx + snapX, dy: dy + snapY, guides };
}
