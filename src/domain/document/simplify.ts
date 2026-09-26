import { distancePointToSegment } from "./hit-test";
import { LIMITS } from "./limits";
import type { Point } from "./model";

/** World-unit RDP tolerance at zoom 1 (plan 03 §3: `0.35 / zoomAtStart`). */
export const FREEHAND_SIMPLIFY_TOLERANCE = 0.35;

const clampCoordinate = (value: number) => Math.max(-LIMITS.coordinate, Math.min(LIMITS.coordinate, value));

/**
 * Ramer–Douglas–Peucker; always keeps first and last point; never returns an empty array
 * for non-empty input; 1-point input returns it unchanged (as a new array).
 *
 * Distances are measured to the *segment* (not the infinite line) so strokes that double
 * back on themselves or close into a loop (first === last) keep their shape.
 * Iterative (explicit stack) so very long strokes cannot overflow the call stack.
 */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.map((point) => ({ x: point.x, y: point.y }));
  const epsilon = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDistance = -1;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = distancePointToSegment(points[i], points[first], points[last]);
      if (distance > maxDistance) { maxDistance = distance; index = i; }
    }
    if (index !== -1 && maxDistance > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) result.push({ x: points[i].x, y: points[i].y });
  return result;
}

/**
 * Build a FreehandNode geometry from world-space samples: simplifies with
 * `tolerance = 0.35 / zoomAtStart`, then normalizes the local origin to the min x/y of the
 * simplified points and returns `{ x, y, points(local) }` (rotation is assumed 0).
 *
 * - Non-finite samples are ignored; throws RangeError if no finite sample remains
 *   (a FreehandNode needs at least one point).
 * - If every remaining point coincides (a click without drag) the result is a single point (a dot).
 * - `zoomAtStart` is clamped to the camera range 0.1–8 (non-finite/≤0 falls back to 1).
 */
export function freehandFromWorld(samples: Point[], zoomAtStart: number): { x: number; y: number; points: Point[] } {
  const finite = samples
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clampCoordinate(point.x), y: clampCoordinate(point.y) }));
  if (!finite.length) throw new RangeError("freehandFromWorld needs at least one finite sample");
  const zoom = Number.isFinite(zoomAtStart) && zoomAtStart > 0
    ? Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, zoomAtStart))
    : 1;
  let simplified = simplifyPolyline(finite, FREEHAND_SIMPLIFY_TOLERANCE / zoom);
  const [head] = simplified;
  if (simplified.every((point) => point.x === head.x && point.y === head.y)) simplified = [head];
  let minX = Infinity, minY = Infinity;
  for (const point of simplified) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); }
  return { x: minX, y: minY, points: simplified.map((point) => ({ x: point.x - minX, y: point.y - minY })) };
}
