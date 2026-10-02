import type { ArrowNode, ConnectorSide, LineNode, Point } from "./model";

// The drawn path of a line/arrow (plan 03 §connectors): straight, right-angled (draw.io “elbow”) or curved.
// Computed from the two stored ends plus the direction each end leaves its object, in the node's local frame —
// pure, so the board, the exports and the drawing room all draw the same thing.

type Connector = LineNode | ArrowNode;
/** Straight run out of an object before the first turn of an elbow. */
export const ELBOW_STUB = 20;

const DIRECTION: Record<ConnectorSide, Point> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };
const horizontal = (direction: Point) => direction.y === 0;

/** Direction each end leaves from: its object's side when attached, else along the main axis between the ends. */
function directions(node: Connector): [Point, Point] {
  const [start, end] = node.points;
  const dx = end.x - start.x, dy = end.y - start.y;
  const along = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
  // A stored side is in world axes; it matches the local frame because attached connectors are never rotated.
  const usable = (side: ConnectorSide | undefined) => side && node.rotation === 0 ? DIRECTION[side] : null;
  return [usable(node.startBinding?.side) ?? along, usable(node.endBinding?.side) ?? { x: -along.x, y: -along.y }];
}

/** Drops repeated and collinear middle points (a clean polyline, and an arrow head on the true last segment). */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - point.x) < 1e-6 && Math.abs(last.y - point.y) < 1e-6) continue;
    const before = out[out.length - 2];
    if (before && last && Math.abs((last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x)) < 1e-6
      && (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y) > 0) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

export type ElbowLayout = { points: Point[]; middle: { from: Point; to: Point; axis: "x" | "y" } | null };

/** The right-angled path and its movable middle segment (null for an L shape, which has none). */
export function elbowLayout(node: Connector): ElbowLayout {
  const [start, end] = node.points;
  const [out, into] = directions(node);
  const a = { x: start.x + out.x * ELBOW_STUB, y: start.y + out.y * ELBOW_STUB };
  const b = { x: end.x + into.x * ELBOW_STUB, y: end.y + into.y * ELBOW_STUB };
  const bend = node.bend ?? 0;
  if (horizontal(out) !== horizontal(into)) {
    // One horizontal, one vertical: a single corner.
    const corner = horizontal(out) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return { points: simplify([start, a, corner, b, end]), middle: null };
  }
  // Both the same way: a middle segment across, placed halfway (plus the hand-made `bend`).
  // Leaving away from the other end turns the middle segment the other way round.
  const forward = horizontal(out) ? (b.x - a.x) * out.x >= 0 : (b.y - a.y) * out.y >= 0;
  const acrossX = horizontal(out) === forward;
  if (acrossX) {
    const x = (a.x + b.x) / 2 + bend;
    const from = { x, y: a.y }, to = { x, y: b.y };
    return { points: simplify([start, a, from, to, b, end]), middle: { from, to, axis: "x" } };
  }
  const y = (a.y + b.y) / 2 + bend;
  const from = { x: a.x, y }, to = { x: b.x, y };
  return { points: simplify([start, a, from, to, b, end]), middle: { from, to, axis: "y" } };
}

/** Points to draw (local frame) and whether they are Bézier control points (curved). */
export function connectorPath(node: Connector): { points: Point[]; bezier: boolean } {
  const route = node.route ?? "straight";
  if (route === "elbow") return { points: elbowLayout(node).points, bezier: false };
  if (route === "curved") {
    const [start, end] = node.points;
    const [out, into] = directions(node);
    const reach = Math.max(30, Math.hypot(end.x - start.x, end.y - start.y) * 0.4);
    return { points: [start, { x: start.x + out.x * reach, y: start.y + out.y * reach }, { x: end.x + into.x * reach, y: end.y + into.y * reach }, end], bezier: true };
  }
  return { points: node.points, bezier: false };
}
