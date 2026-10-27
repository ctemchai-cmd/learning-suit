import type { Bounds, Point } from "./model";

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

type SnapOptions = { threshold: number; grid: number | null };

/**
 * Snaps one point being placed (a shape's corner, a line end): its x/y go onto an edge/centre of another box within
 * `threshold` (pink guides), else onto the grid. `lockX`/`lockY` leave an axis alone.
 */
export function snapPoint(point: Point, others: Bounds[], options: SnapOptions & { lockX?: boolean; lockY?: boolean }): { point: Point; guides: Guide[] } {
  const result = snapMove({ x: point.x, y: point.y, width: 0, height: 0 }, others, 0, 0, options);
  return { point: { x: point.x + result.dx, y: point.y + result.dy }, guides: result.guides };
}

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/**
 * Snaps the pointer of an unrotated box resize so the edge(s) the handle moves land on an edge/centre of another box
 * (guide) or on the grid. `resulting(pointer)` returns the box the resize produces for a pointer (minimum sizes and
 * aspect lock applied by the caller's transform): a guide is only reported when the real edge ends up on the line.
 * With `keepAspect` on a corner only one axis can be honoured (the other follows), so each axis is tried alone and the
 * nearer one that really lands wins.
 */
export function snapResize(
  handle: ResizeHandle, pointer: Point, others: Bounds[],
  options: SnapOptions & { keepAspect?: boolean; resulting: (pointer: Point) => Bounds },
): { pointer: Point; guides: Guide[] } {
  const movesX = handle.includes("e") || handle.includes("w");
  const movesY = handle.includes("n") || handle.includes("s");
  const grid = options.grid && options.grid > 0 ? options.grid : null;
  const edgeOf = (box: Bounds, axis: "x" | "y") => axis === "x" ? (handle.includes("w") ? box.x : box.x + box.width) : (handle.includes("n") ? box.y : box.y + box.height);
  const find = (axis: "x" | "y"): { delta: number; at: number | null } | null => {
    if (axis === "x" ? !movesX : !movesY) return null;
    const value = axis === "x" ? pointer.x : pointer.y;
    const line = nearestLine(axis, axis === "x" ? { x: value, y: 0, width: 0, height: 0 } : { x: 0, y: value, width: 0, height: 0 }, others, options.threshold);
    if (line) return { delta: line.delta, at: line.at };
    return grid ? { delta: Math.round(value / grid) * grid - value, at: null } : null;
  };
  const found = { x: find("x"), y: find("y") };
  const shift = (x: boolean, y: boolean): Point => ({ x: pointer.x + (x && found.x ? found.x.delta : 0), y: pointer.y + (y && found.y ? found.y.delta : 0) });
  const guidesFor = (snapped: Point, axes: ("x" | "y")[]): Guide[] => {
    const box = options.resulting(snapped);
    const guides: Guide[] = [];
    for (const axis of axes) {
      const hit = found[axis];
      if (hit?.at != null && Math.abs(edgeOf(box, axis) - hit.at) < 0.5) guides.push(guideFor(axis, hit.at, box, others));
    }
    return guides;
  };
  if (options.keepAspect && movesX && movesY) {
    const tries = (["x", "y"] as const)
      .filter((axis) => found[axis])
      .sort((a, b) => Math.abs(found[a]!.delta) - Math.abs(found[b]!.delta));
    for (const axis of tries) {
      const snapped = shift(axis === "x", axis === "y");
      const target = (found[axis]!.at ?? (axis === "x" ? snapped.x : snapped.y));
      if (Math.abs(edgeOf(options.resulting(snapped), axis) - target) < 0.5) return { pointer: snapped, guides: guidesFor(snapped, [axis]) };
    }
    return { pointer, guides: [] };
  }
  const snapped = shift(true, true);
  return { pointer: snapped, guides: guidesFor(snapped, ["x", "y"]) };
}

/** Holding ⌘/Ctrl during a gesture turns snapping off (moving, drawing and resizing alike). */
export const snappingBypassed = (event: { metaKey: boolean; ctrlKey: boolean }): boolean => event.metaKey || event.ctrlKey;
