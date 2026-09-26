import type { CanvasNode, FreehandNode, Point } from "./model";

/** Euclidean distance from `p` to the closed segment `a–b` (a zero-length segment is the point `a`). */
export function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Minimum distance between the closed segments `a–b` and `c–d` (0 when they cross). */
function distanceSegmentToSegment(a: Point, b: Point, c: Point, d: Point): number {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  // Proper crossing. Touching/collinear overlaps are caught below because an endpoint then lies on the other segment.
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    distancePointToSegment(a, c, d), distancePointToSegment(b, c, d),
    distancePointToSegment(c, a, b), distancePointToSegment(d, a, b),
  );
}

/** Inverse of `world = R(rotation)·local + (x, y)`. Rigid, so distances are preserved. */
function worldToLocal(node: CanvasNode, world: Point): Point {
  const radians = -node.rotation * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  const dx = world.x - node.x, dy = world.y - node.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };
function boxOf(points: Point[], pad: number): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
const boxesOverlap = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * World-space: does the eraser path (polyline of world points, radius in world units) touch this
 * freehand stroke? The eraser is mapped into the stroke's local frame (x/y/rotation), then the
 * polyline-to-polyline distance is compared with `eraserRadius + strokeWidth / 2` (round caps and
 * joins). A 1-point stroke is a dot of diameter strokeWidth; a 1-point eraser path is a disc.
 */
export function eraserHitsFreehand(node: FreehandNode, eraserPath: Point[], eraserRadius: number): boolean {
  if (!eraserPath.length || !node.points.length) return false;
  const threshold = Math.max(0, Number.isFinite(eraserRadius) ? eraserRadius : 0) + Math.max(0, node.strokeWidth) / 2;
  const eraser = eraserPath.map((point) => worldToLocal(node, point));
  const stroke = node.points;
  if (!boxesOverlap(boxOf(stroke, threshold), boxOf(eraser, 0))) return false;

  const eraserSegments = Math.max(1, eraser.length - 1);
  const strokeSegments = Math.max(1, stroke.length - 1);
  for (let i = 0; i < eraserSegments; i += 1) {
    const a = eraser[i], b = eraser[Math.min(i + 1, eraser.length - 1)];
    const segmentBox = boxOf([a, b], threshold);
    for (let j = 0; j < strokeSegments; j += 1) {
      const c = stroke[j], d = stroke[Math.min(j + 1, stroke.length - 1)];
      if (Math.max(c.x, d.x) < segmentBox.minX || Math.min(c.x, d.x) > segmentBox.maxX
        || Math.max(c.y, d.y) < segmentBox.minY || Math.min(c.y, d.y) > segmentBox.maxY) continue;
      if (distanceSegmentToSegment(a, b, c, d) <= threshold) return true;
    }
  }
  return false;
}

/** IDs (in document order) of unlocked pen/highlighter nodes hit by the eraser path. */
export function freehandHitsForEraser(nodes: CanvasNode[], eraserPath: Point[], eraserRadius: number): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if ((node.type === "pen" || node.type === "highlighter") && !node.locked && eraserHitsFreehand(node, eraserPath, eraserRadius)) {
      ids.push(node.id);
    }
  }
  return ids;
}
