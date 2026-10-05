import { getContentBounds, type FontMetrics } from "./geometry";
import { LIMITS } from "./limits";
import { isWidgetNode, widgetNodeSize, type CanvasNode, type CodeNode, type Point, type TableNode, type WidgetNode } from "./model";
import { setTableWidth, tableLayout } from "./table";
import { codeLayout } from "./code";

/**
 * Pure transform geometry for the selection overlay (plan 03 §5, plan 02 §2 invariants).
 * world = R(rotation)·local + (x, y). Handles are computed in world units; the UI converts them to
 * screen with the camera and draws fixed-size DOM/Konva handles on top.
 */

export type TransformHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "start" | "end" | "rotate";
export type TransformHandle = { id: TransformHandleId; world: Point };
/** Oriented box in world units (rotation in degrees about `center`). */
export type Frame = { center: Point; width: number; height: number; rotation: number };
export type CornerHandleId = "nw" | "ne" | "se" | "sw";

/** Default screen-space distance between the frame's top edge and the rotation handle. */
export const ROTATE_HANDLE_OFFSET_PX = 28;
export const ROTATION_SNAP_DEGREES = 15;

// Product limits (plan 02 §6). Kept local because limits.ts does not export them yet.
const MIN_SIZE = 1;
const MIN_TEXT_WIDTH = 24;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 160;
const MIN_GIT_SCALE = 0.5;
const MAX_GIT_SCALE = 4;
const MAX_COORDINATE = LIMITS.coordinate;

type BoxHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const BOX_HANDLES: BoxHandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CORNER_HANDLES: CornerHandleId[] = ["nw", "ne", "se", "sw"];
const OPPOSITE_CORNER: Record<CornerHandleId, CornerHandleId> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };

type LocalBox = { minX: number; minY: number; maxX: number; maxY: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampCoordinate = (value: number) => clamp(value, -MAX_COORDINATE, MAX_COORDINATE);
const clampPoint = (point: Point): Point => ({ x: clampCoordinate(point.x), y: clampCoordinate(point.y) });
const isFinitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y);
const isBoxHandle = (id: TransformHandleId): id is BoxHandleId => (BOX_HANDLES as TransformHandleId[]).includes(id);
const isCornerHandle = (id: TransformHandleId): id is CornerHandleId => (CORNER_HANDLES as TransformHandleId[]).includes(id);
/** Scale `value` by `factor` but keep it inside [min, max]; a value already outside the range may stay where it is. */
const scaleWithin = (value: number, factor: number, min: number, max: number) =>
  clamp(value * factor, Math.min(min, value), Math.max(max, value));

/** Normalizes degrees to (-180, 180]; never returns -0. */
export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  let result = ((degrees % 360) + 360) % 360;
  if (result > 180) result -= 360;
  return result === 0 ? 0 : result;
}

/** cos/sin of an angle in degrees, exact for multiples of 90° so axis-aligned results carry no float noise. */
function cosSin(degrees: number): [number, number] {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) return [1, 0];
  if (normalized === 90) return [0, 1];
  if (normalized === 180) return [-1, 0];
  if (normalized === 270) return [0, -1];
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

function rotateVector(point: Point, degrees: number): Point {
  const [c, s] = cosSin(degrees);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

function toWorld(node: CanvasNode, local: Point): Point {
  const rotated = rotateVector(local, node.rotation);
  return { x: node.x + rotated.x, y: node.y + rotated.y };
}

function toLocal(node: CanvasNode, world: Point): Point {
  return rotateVector({ x: world.x - node.x, y: world.y - node.y }, -node.rotation);
}

/** Local bounding box of the node's geometry, without stroke padding or arrow heads. */
function localBox(node: CanvasNode, metrics: FontMetrics): LocalBox {
  switch (node.type) {
    case "rectangle":
    case "ellipse":
    case "image":
    case "stencil":
      return { minX: 0, minY: 0, maxX: node.width, maxY: node.height };
    case "text": {
      const height = metrics.measureText(node).height;
      return { minX: 0, minY: 0, maxX: node.width, maxY: Number.isFinite(height) && height > 0 ? height : 0 };
    }
    case "table": {
      const { width, height } = tableLayout(node, metrics);
      return { minX: 0, minY: 0, maxX: width, maxY: height };
    }
    case "code": {
      const { width, height } = codeLayout(node, metrics);
      return { minX: 0, minY: 0, maxX: width, maxY: height };
    }
    case "git-simulator":
    case "data-simulator":
    case "deploy-simulator":
    case "ai-simulator":
    case "ssh-simulator":
      return { minX: 0, minY: 0, maxX: widgetNodeSize(node).width * node.scale, maxY: widgetNodeSize(node).height * node.scale };
    default: {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of node.points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return { minX, minY, maxX, maxY };
    }
  }
}

function boxHandleLocal(box: LocalBox, id: BoxHandleId): Point {
  const x = id.includes("w") ? box.minX : id.includes("e") ? box.maxX : (box.minX + box.maxX) / 2;
  const y = id.includes("n") ? box.minY : id.includes("s") ? box.maxY : (box.minY + box.maxY) / 2;
  return { x, y };
}

const boxCenter = (box: LocalBox): Point => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
const offsetWorld = (rotateOffsetScreenPx: number, zoom: number) => {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safeOffset = Number.isFinite(rotateOffsetScreenPx) ? rotateOffsetScreenPx : ROTATE_HANDLE_OFFSET_PX;
  return safeOffset / safeZoom;
};

/** Oriented frame of a single node (local bounding box of its geometry without stroke padding, rotated). */
export function getNodeFrame(node: CanvasNode, metrics: FontMetrics): Frame {
  const box = localBox(node, metrics);
  return {
    center: toWorld(node, boxCenter(box)),
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    rotation: node.rotation,
  };
}

/** Which transform handles a single selected node exposes (see plan 03 §5 table). */
function singleHandleIds(node: CanvasNode, box: LocalBox): TransformHandleId[] {
  switch (node.type) {
    case "rectangle":
    case "ellipse":
    case "stencil":
      return [...BOX_HANDLES, "rotate"];
    case "line":
    case "arrow":
      return ["start", "end", "rotate"];
    case "text":
    case "table":
      return ["e", "w", "rotate"];
    case "image":
    case "code":
      return [...CORNER_HANDLES, "rotate"];
    case "git-simulator":
    case "data-simulator":
    case "deploy-simulator":
    case "ai-simulator":
    case "ssh-simulator":
      return [...CORNER_HANDLES];
    default: {
      // Freehand: corners + edges, minus handles on a zero-size axis (they would overlap and cannot scale).
      const hasWidth = box.maxX - box.minX > 0, hasHeight = box.maxY - box.minY > 0;
      if (hasWidth && hasHeight) return [...BOX_HANDLES, "rotate"];
      if (hasWidth) return ["e", "w", "rotate"];
      if (hasHeight) return ["n", "s", "rotate"];
      return ["rotate"];
    }
  }
}

/**
 * Handles for a single selected node. rect/ellipse: 8 + rotate; line/arrow: start/end + rotate;
 * pen/highlighter: corners + edges + rotate (edges/corners on a zero-size axis omitted; a dot gets only rotate);
 * text: e/w + rotate; image: 4 corners + rotate; git-simulator: 4 corners only.
 * The rotation handle sits `rotateOffsetScreenPx / zoom` world units above the frame's top-center
 * along the node's rotated up axis.
 */
export function getSingleHandles(
  node: CanvasNode, metrics: FontMetrics, zoom: number, rotateOffsetScreenPx = ROTATE_HANDLE_OFFSET_PX,
): TransformHandle[] {
  const box = localBox(node, metrics);
  return singleHandleIds(node, box).map((id) => {
    if (id === "start" || id === "end") {
      const points = (node as Extract<CanvasNode, { type: "line" | "arrow" }>).points;
      return { id, world: toWorld(node, points[id === "start" ? 0 : 1]) };
    }
    if (id === "rotate") {
      const top = { x: (box.minX + box.maxX) / 2, y: box.minY - offsetWorld(rotateOffsetScreenPx, zoom) };
      return { id, world: toWorld(node, top) };
    }
    return { id, world: toWorld(node, boxHandleLocal(box, id)) };
  });
}

/**
 * Multi-selection: axis-aligned frame = union of getNodeBounds (incl. stroke/arrow padding);
 * handles = 4 corners (uniform scale) + rotate (omitted if any git-simulator is selected).
 * Empty input returns a zero frame and no handles.
 */
export function getMultiHandles(
  nodes: CanvasNode[], metrics: FontMetrics, zoom: number, rotateOffsetScreenPx = ROTATE_HANDLE_OFFSET_PX,
): { frame: Frame; handles: TransformHandle[] } {
  const bounds = getContentBounds(nodes, metrics);
  if (!bounds) return { frame: { center: { x: 0, y: 0 }, width: 0, height: 0, rotation: 0 }, handles: [] };
  const corners = unionCorners(bounds);
  const handles: TransformHandle[] = CORNER_HANDLES.map((id) => ({ id, world: corners[id] }));
  if (!nodes.some(isWidgetNode)) {
    handles.push({ id: "rotate", world: { x: bounds.x + bounds.width / 2, y: bounds.y - offsetWorld(rotateOffsetScreenPx, zoom) } });
  }
  return {
    frame: { center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, width: bounds.width, height: bounds.height, rotation: 0 },
    handles,
  };
}

function unionCorners(bounds: { x: number; y: number; width: number; height: number }): Record<CornerHandleId, Point> {
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
  return {
    nw: { x: bounds.x, y: bounds.y }, ne: { x: right, y: bounds.y },
    se: { x: right, y: bottom }, sw: { x: bounds.x, y: bottom },
  };
}

/**
 * Suggested CSS cursor for a handle, accounting for the frame rotation (degrees).
 * Box handles map to ew/nwse/ns/nesw-resize; endpoints to "crosshair"; rotate to "grab".
 */
export function getHandleCursor(id: TransformHandleId, rotation = 0): string {
  if (id === "rotate") return "grab";
  if (id === "start" || id === "end") return "crosshair";
  // Screen angle of the handle direction from the frame center (y down): e = 0°, se = 45°, s = 90° …
  const base: Record<BoxHandleId, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const angle = ((base[id] + (Number.isFinite(rotation) ? rotation : 0)) % 180 + 180) % 180;
  const bucket = Math.round(angle / 45) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][bucket];
}

// ---------------------------------------------------------------------------------------------
// Single-node transforms

/** Raw (unclamped, possibly negative) width/height implied by dragging `handle` to local point `p`. */
function draggedSize(box: LocalBox, handle: BoxHandleId, p: Point): { width: number; height: number } {
  let width = box.maxX - box.minX, height = box.maxY - box.minY;
  if (handle.includes("e")) width = p.x - box.minX;
  else if (handle.includes("w")) width = box.maxX - p.x;
  if (handle.includes("s")) height = p.y - box.minY;
  else if (handle.includes("n")) height = box.maxY - p.y;
  return { width, height };
}

/** Uniform factor for a corner drag: the axis with the larger relative change wins (same rule as resize.ts). */
function dominantFactor(box: LocalBox, handle: BoxHandleId, p: Point): number {
  const w0 = box.maxX - box.minX, h0 = box.maxY - box.minY;
  const { width, height } = draggedSize(box, handle, p);
  const sx = width / w0, sy = height / h0;
  return Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy;
}

/** Places a width×height box so the side/corner opposite `handle` stays where it was. */
function anchorBox(box: LocalBox, handle: BoxHandleId, width: number, height: number): LocalBox {
  const next = { ...box };
  if (handle.includes("w")) next.minX = box.maxX - width;
  else if (handle.includes("e")) next.maxX = box.minX + width;
  if (handle.includes("n")) next.minY = box.maxY - height;
  else if (handle.includes("s")) next.maxY = box.minY + height;
  return next;
}

type BoxLimits = { minWidth: number; minHeight: number; maxWidth: number; maxHeight: number; minFactor: number; maxFactor: number };

/**
 * Resize a local box by a handle drag. Free mode clamps each moving axis to [min, max]; aspect mode
 * (corners only, both axes non-zero) applies one factor clamped to [minFactor, maxFactor] and then
 * re-applies the per-axis minimums to absorb float noise (so 49·(1/49) never lands at 0.9999…).
 * A zero-size axis never scales. Values already outside a limit are never forced further.
 */
function resizeBox(box: LocalBox, handle: BoxHandleId, p: Point, keepAspect: boolean, limits: BoxLimits): LocalBox {
  const w0 = box.maxX - box.minX, h0 = box.maxY - box.minY;
  const movesX = handle.includes("e") || handle.includes("w");
  const movesY = handle.includes("n") || handle.includes("s");
  let width = w0, height = h0;
  if (keepAspect && movesX && movesY && w0 > 0 && h0 > 0) {
    const factor = clamp(dominantFactor(box, handle, p), Math.min(limits.minFactor, 1), Math.max(limits.maxFactor, 1));
    width = scaleWithin(w0, factor, limits.minWidth, limits.maxWidth);
    height = scaleWithin(h0, factor, limits.minHeight, limits.maxHeight);
  } else {
    const dragged = draggedSize(box, handle, p);
    if (movesX && w0 > 0) width = clamp(dragged.width, Math.min(limits.minWidth, w0), Math.max(limits.maxWidth, w0));
    if (movesY && h0 > 0) height = clamp(dragged.height, Math.min(limits.minHeight, h0), Math.max(limits.maxHeight, h0));
  }
  return anchorBox(box, handle, width, height);
}

const sizeLimits = (w0: number, h0: number, minWidth: number, minHeight: number): BoxLimits => ({
  minWidth, minHeight, maxWidth: MAX_COORDINATE, maxHeight: MAX_COORDINATE,
  minFactor: Math.max(minWidth / w0, minHeight / h0),
  maxFactor: Math.min(MAX_COORDINATE / w0, MAX_COORDINATE / h0),
});

function withOrigin<T extends CanvasNode>(node: T, world: Point): T {
  return { ...node, x: clampCoordinate(world.x), y: clampCoordinate(world.y) };
}

const LINE_DIRECTIONS: [number, number][] = [
  [1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * Single-node transform from a handle drag. `start` = node at gesture start, `pointerWorld` = current pointer.
 * rect/ellipse: free resize (Shift keeps aspect on corners), opposite side/corner anchored in rotated axes;
 * line/arrow: move one endpoint (Shift snaps the world direction to 45°; length ≥ 1);
 * pen/highlighter: scale local points into the new box anchored at the opposite handle (Shift keeps aspect
 *   on corners), strokeWidth unchanged, local origin re-normalized to the box's min corner;
 * text: e/w change width (≥ 24, reflow), fontSize unchanged; "w" keeps the right edge anchored;
 * image: corners only, aspect ALWAYS kept, min size 1; git-simulator: corners only, uniform scale 0.5–4, rotation 0.
 * Handles a node type does not expose (e.g. "n" on an image) return an unchanged copy. Never flips or goes negative.
 */
export function transformSingle(
  start: CanvasNode, handle: Exclude<TransformHandleId, "rotate">, pointerWorld: Point,
  opts: { keepAspect: boolean }, metrics: FontMetrics,
): CanvasNode {
  if (!isFinitePoint(pointerWorld)) return { ...start };
  const pointer = clampPoint(pointerWorld);
  switch (start.type) {
    case "rectangle":
    case "ellipse":
    case "stencil": {
      if (!isBoxHandle(handle)) return { ...start };
      const box = localBox(start, metrics);
      const next = resizeBox(box, handle, toLocal(start, pointer), opts.keepAspect && isCornerHandle(handle),
        sizeLimits(start.width, start.height, MIN_SIZE, MIN_SIZE));
      return { ...withOrigin(start, toWorld(start, { x: next.minX, y: next.minY })), width: next.maxX - next.minX, height: next.maxY - next.minY };
    }
    case "image": {
      if (!isCornerHandle(handle)) return { ...start };
      const box = localBox(start, metrics);
      const next = resizeBox(box, handle, toLocal(start, pointer), true, sizeLimits(start.width, start.height, MIN_SIZE, MIN_SIZE));
      return { ...withOrigin(start, toWorld(start, { x: next.minX, y: next.minY })), width: next.maxX - next.minX, height: next.maxY - next.minY };
    }
    case "git-simulator":
    case "data-simulator":
    case "deploy-simulator":
    case "ai-simulator":
    case "ssh-simulator":
      return isCornerHandle(handle) ? scaleWidgetFromCorner(start, handle, pointer, metrics) : { ...start };
    case "code":
      return isCornerHandle(handle) ? scaleCodeFromCorner(start, handle, pointer, metrics) : { ...start };
    case "table": {
      // Width only (rows follow the text); every column keeps its share, "w" keeps the right edge anchored.
      if (handle !== "e" && handle !== "w") return { ...start };
      const box = localBox(start, metrics);
      const next = resizeBox(box, handle, toLocal(start, pointer), false, {
        minWidth: LIMITS.tableColumnMin * start.columns.length, minHeight: 0, maxWidth: MAX_COORDINATE, maxHeight: Infinity, minFactor: 0, maxFactor: Infinity,
      });
      return setTableWidth(withOrigin(start, toWorld(start, { x: next.minX, y: 0 })) as TableNode, next.maxX - next.minX);
    }
    case "text": {
      if (handle !== "e" && handle !== "w") return { ...start };
      const box = localBox(start, metrics);
      const next = resizeBox(box, handle, toLocal(start, pointer), false, {
        minWidth: MIN_TEXT_WIDTH, minHeight: 0, maxWidth: MAX_COORDINATE, maxHeight: Infinity, minFactor: 0, maxFactor: Infinity,
      });
      return { ...withOrigin(start, toWorld(start, { x: next.minX, y: 0 })), width: next.maxX - next.minX };
    }
    case "line":
    case "arrow": {
      if (handle !== "start" && handle !== "end") return { ...start };
      const index = handle === "start" ? 0 : 1;
      const fixed = toWorld(start, start.points[1 - index]);
      let dx = pointer.x - fixed.x, dy = pointer.y - fixed.y;
      let distance = Math.hypot(dx, dy);
      if (opts.keepAspect && distance > 0) {
        const step = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
        [dx, dy] = [distance * LINE_DIRECTIONS[step][0], distance * LINE_DIRECTIONS[step][1]];
      }
      if (distance < MIN_SIZE) {
        // Keep a non-degenerate segment (arrow direction stays defined): push out along the drag or the old direction.
        if (distance === 0) {
          const previous = toWorld(start, start.points[index]);
          dx = previous.x - fixed.x; dy = previous.y - fixed.y; distance = Math.hypot(dx, dy);
          if (distance === 0) { dx = 1; dy = 0; distance = 1; }
        }
        dx = dx / distance * MIN_SIZE; dy = dy / distance * MIN_SIZE;
      }
      const points: [Point, Point] = [{ ...start.points[0] }, { ...start.points[1] }];
      points[index] = clampPoint(toLocal(start, { x: fixed.x + dx, y: fixed.y + dy }));
      return { ...start, points };
    }
    default: {
      if (!isBoxHandle(handle)) return { ...start };
      const box = localBox(start, metrics);
      const local = toLocal(start, pointer);
      const w0 = box.maxX - box.minX, h0 = box.maxY - box.minY;
      let next: LocalBox;
      if (opts.keepAspect && isCornerHandle(handle) && w0 > 0 && h0 > 0) {
        // Uniform scale limited by the larger side (≥ 1) so thin strokes can still shrink with Shift.
        const largest = Math.max(w0, h0);
        const factor = clamp(dominantFactor(box, handle, local), Math.min(MIN_SIZE / largest, 1), Math.max(MAX_COORDINATE / largest, 1));
        next = anchorBox(box, handle, w0 * factor, h0 * factor);
      } else {
        next = resizeBox(box, handle, local, false, {
          minWidth: MIN_SIZE, minHeight: MIN_SIZE, maxWidth: MAX_COORDINATE, maxHeight: MAX_COORDINATE, minFactor: 0, maxFactor: Infinity,
        });
      }
      const sx = w0 > 0 ? (next.maxX - next.minX) / w0 : 1;
      const sy = h0 > 0 ? (next.maxY - next.minY) / h0 : 1;
      const points = start.points.map((point) => clampPoint({ x: (point.x - box.minX) * sx, y: (point.y - box.minY) * sy }));
      return { ...withOrigin(start, toWorld(start, { x: next.minX, y: next.minY })), points };
    }
  }
}

/** Code blocks resize by font size (their box follows the code); the opposite corner stays put. */
function scaleCodeFromCorner(start: CodeNode, handle: CornerHandleId, pointer: Point, metrics: FontMetrics): CodeNode {
  const box = localBox(start, metrics);
  const factor = dominantFactor(box, handle, toLocal(start, pointer));
  const fontSize = scaleWithin(start.fontSize, Number.isFinite(factor) ? factor : 1, LIMITS.codeFontMin, LIMITS.codeFontMax);
  const size = codeLayout({ ...start, fontSize }, metrics);
  const next = anchorBox(box, handle, size.width, size.height);
  return { ...withOrigin(start, toWorld(start, { x: next.minX, y: next.minY })), fontSize };
}

function scaleWidgetFromCorner(start: WidgetNode, handle: CornerHandleId, pointer: Point, metrics: FontMetrics): WidgetNode {
  const box = localBox(start, metrics);
  const factor = dominantFactor(box, handle, toLocal(start, pointer));
  const scale = scaleWithin(start.scale, Number.isFinite(factor) ? factor : 1, MIN_GIT_SCALE, MAX_GIT_SCALE);
  const size = widgetNodeSize(start);
  const next = anchorBox(box, handle, size.width * scale, size.height * scale);
  return { ...withOrigin(start, toWorld(start, { x: next.minX, y: next.minY })), rotation: 0, scale };
}

/** Signed angle (degrees, (-180, 180]) from center→from to center→to; 0 if either vector is degenerate. */
function sweepDegrees(center: Point, from: Point, to: Point): number {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return 0;
  const ax = from.x - center.x, ay = from.y - center.y, bx = to.x - center.x, by = to.y - center.y;
  if (Math.hypot(ax, ay) < 1e-9 || Math.hypot(bx, by) < 1e-9) return 0;
  return normalizeDegrees((Math.atan2(by, bx) - Math.atan2(ay, ax)) * 180 / Math.PI);
}

const snapDegrees = (degrees: number) => Math.round(degrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;

/**
 * Rotate one node about its frame center so the center stays fixed. The angle is the sweep from
 * center→startPointer to center→pointer; snap=true rounds the resulting rotation to 15° steps.
 * Result rotation normalized to (-180, 180]. Git widgets are returned unchanged (as a copy).
 */
export function rotateSingle(start: CanvasNode, startPointerWorld: Point, pointerWorld: Point, snap: boolean, metrics: FontMetrics): CanvasNode {
  if (isWidgetNode(start)) return { ...start };
  const localCenter = boxCenter(localBox(start, metrics));
  const center = toWorld(start, localCenter);
  let rotation = start.rotation + sweepDegrees(center, startPointerWorld, pointerWorld);
  if (snap) rotation = snapDegrees(rotation);
  rotation = normalizeDegrees(rotation);
  const offset = rotateVector(localCenter, rotation);
  return { ...start, rotation, x: clampCoordinate(center.x - offset.x), y: clampCoordinate(center.y - offset.y) };
}

// ---------------------------------------------------------------------------------------------
// Multi-selection transforms

/**
 * Allowed uniform factor range for the whole selection about `anchor`, so no node leaves its limits:
 * rect/ellipse/image sides ≥ 1; text width ≥ 24 and fontSize 8–160; git scale 0.5–4; line/arrow/freehand
 * larger box side ≥ 1 (zero-size boxes such as dots are unconstrained); origins/points within ±10M;
 * union frame larger side ≥ 1. The range always contains 1 so already-out-of-range nodes never force a change.
 */
function selectionFactorRange(nodes: CanvasNode[], anchor: Point, frameSize: number, metrics: FontMetrics): [number, number] {
  let min = frameSize > 0 ? MIN_SIZE / frameSize : 0;
  let max = Infinity;
  const limitCoordinate = (value: number, pivot: number) => {
    const delta = value - pivot;
    if (delta > 0) max = Math.min(max, (MAX_COORDINATE - pivot) / delta);
    else if (delta < 0) max = Math.min(max, (MAX_COORDINATE + pivot) / -delta);
  };
  for (const node of nodes) {
    limitCoordinate(node.x, anchor.x);
    limitCoordinate(node.y, anchor.y);
    switch (node.type) {
      case "rectangle":
      case "ellipse":
      case "image":
      case "stencil":
        min = Math.max(min, MIN_SIZE / node.width, MIN_SIZE / node.height);
        max = Math.min(max, MAX_COORDINATE / node.width, MAX_COORDINATE / node.height);
        break;
      case "code":
        min = Math.max(min, LIMITS.codeFontMin / node.fontSize);
        max = Math.min(max, LIMITS.codeFontMax / node.fontSize);
        break;
      case "table":
        min = Math.max(min, LIMITS.tableColumnMin / Math.min(...node.columns), LIMITS.tableFontMin / node.fontSize);
        max = Math.min(max, LIMITS.tableFontMax / node.fontSize, MAX_COORDINATE / node.columns.reduce((sum, width) => sum + width, 0));
        break;
      case "text":
        min = Math.max(min, MIN_TEXT_WIDTH / node.width, MIN_FONT_SIZE / node.fontSize);
        max = Math.min(max, MAX_COORDINATE / node.width, MAX_FONT_SIZE / node.fontSize);
        break;
      case "git-simulator":
      case "data-simulator":
      case "deploy-simulator":
      case "ai-simulator":
      case "ssh-simulator":
        min = Math.max(min, MIN_GIT_SCALE / node.scale);
        max = Math.min(max, MAX_GIT_SCALE / node.scale);
        break;
      default: {
        const box = localBox(node, metrics);
        const largest = Math.max(box.maxX - box.minX, box.maxY - box.minY);
        if (largest > 0) min = Math.max(min, MIN_SIZE / largest);
        for (const point of node.points) {
          const magnitude = Math.max(Math.abs(point.x), Math.abs(point.y));
          if (magnitude > 0) max = Math.min(max, MAX_COORDINATE / magnitude);
        }
      }
    }
  }
  return [Math.min(min, 1), Math.max(max, 1)];
}

function scaleNodeAbout(node: CanvasNode, anchor: Point, factor: number): CanvasNode {
  const x = clampCoordinate(anchor.x + (node.x - anchor.x) * factor);
  const y = clampCoordinate(anchor.y + (node.y - anchor.y) * factor);
  const scalePoint = (point: Point) => clampPoint({ x: point.x * factor, y: point.y * factor });
  switch (node.type) {
    case "rectangle":
    case "ellipse":
    case "image":
    case "stencil":
      return {
        ...node, x, y,
        width: scaleWithin(node.width, factor, MIN_SIZE, MAX_COORDINATE),
        height: scaleWithin(node.height, factor, MIN_SIZE, MAX_COORDINATE),
      };
    case "code":
      return { ...node, x, y, fontSize: scaleWithin(node.fontSize, factor, LIMITS.codeFontMin, LIMITS.codeFontMax) };
    case "table":
      return {
        ...node, x, y,
        columns: node.columns.map((width) => scaleWithin(width, factor, LIMITS.tableColumnMin, MAX_COORDINATE)),
        fontSize: scaleWithin(node.fontSize, factor, LIMITS.tableFontMin, LIMITS.tableFontMax),
      };
    case "text":
      return {
        ...node, x, y,
        width: scaleWithin(node.width, factor, MIN_TEXT_WIDTH, MAX_COORDINATE),
        fontSize: scaleWithin(node.fontSize, factor, MIN_FONT_SIZE, MAX_FONT_SIZE),
      };
    case "git-simulator":
    case "data-simulator":
    case "deploy-simulator":
    case "ai-simulator":
    case "ssh-simulator":
      return { ...node, x, y, scale: scaleWithin(node.scale, factor, MIN_GIT_SCALE, MAX_GIT_SCALE) };
    case "line":
    case "arrow":
      return { ...node, x, y, points: [scalePoint(node.points[0]), scalePoint(node.points[1])] };
    default:
      return { ...node, x, y, points: node.points.map(scalePoint) };
  }
}

/**
 * Multi-selection uniform scale about the opposite corner of the union frame (getNodeBounds union).
 * factor = projection of (pointer − anchor) onto the frame diagonal, clamped for the WHOLE set (see
 * selectionFactorRange); dragging past the anchor clamps at the minimum instead of flipping.
 * Scales node origins about the anchor, rect/ellipse/image width/height, line/arrow/freehand local points,
 * text width & fontSize, git scale. strokeWidth, headLength/headWidth and rotation are unchanged.
 */
export function scaleSelection(start: CanvasNode[], handle: CornerHandleId, pointerWorld: Point, metrics: FontMetrics): CanvasNode[] {
  const bounds = getContentBounds(start, metrics);
  if (!bounds) return [];
  const corners = unionCorners(bounds);
  const anchor = corners[OPPOSITE_CORNER[handle]], moving = corners[handle];
  const diagonal = { x: moving.x - anchor.x, y: moving.y - anchor.y };
  const lengthSquared = diagonal.x * diagonal.x + diagonal.y * diagonal.y;
  if (!(lengthSquared > 0) || !isFinitePoint(pointerWorld)) return start.map((node) => ({ ...node }));
  const raw = ((pointerWorld.x - anchor.x) * diagonal.x + (pointerWorld.y - anchor.y) * diagonal.y) / lengthSquared;
  const [min, max] = selectionFactorRange(start, anchor, Math.max(bounds.width, bounds.height), metrics);
  const factor = clamp(Number.isFinite(raw) ? raw : 1, min, max);
  return start.map((node) => scaleNodeAbout(node, anchor, factor));
}

/**
 * Multi-selection rotate about the union frame center: each node's origin rotates about the center and
 * its rotation increases by the same delta (snap → delta rounded to 15° steps), normalized to (-180, 180].
 * If any git-simulator is included the input is returned unchanged (as copies); the caller disables rotation.
 */
export function rotateSelection(start: CanvasNode[], startPointerWorld: Point, pointerWorld: Point, snap: boolean, metrics: FontMetrics): CanvasNode[] {
  if (start.some(isWidgetNode)) return start.map((node) => ({ ...node }));
  const bounds = getContentBounds(start, metrics);
  if (!bounds) return [];
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let delta = sweepDegrees(center, startPointerWorld, pointerWorld);
  if (snap) delta = normalizeDegrees(snapDegrees(delta));
  return start.map((node) => {
    if (isWidgetNode(node)) return { ...node };
    const offset = rotateVector({ x: node.x - center.x, y: node.y - center.y }, delta);
    return {
      ...node,
      x: clampCoordinate(center.x + offset.x),
      y: clampCoordinate(center.y + offset.y),
      rotation: normalizeDegrees(node.rotation + delta),
    };
  });
}

/** Shift-move helper: keep only the dominant axis of a drag delta (ties keep x). */
export function lockToDominantAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/**
 * Move by a world delta (the caller applies Shift axis-lock, e.g. via lockToDominantAxis, after its threshold).
 * The delta is clamped for the whole set so every origin stays within ±10,000,000 and the arrangement is kept.
 */
export function translateNodes(nodes: CanvasNode[], dx: number, dy: number): CanvasNode[] {
  const clampDelta = (delta: number, values: number[]) => {
    if (!Number.isFinite(delta)) return 0;
    let low = -Infinity, high = Infinity;
    for (const value of values) {
      low = Math.max(low, -MAX_COORDINATE - value);
      high = Math.min(high, MAX_COORDINATE - value);
    }
    return clamp(delta, Math.min(low, 0), Math.max(high, 0));
  };
  const safeDx = clampDelta(dx, nodes.map((node) => node.x));
  const safeDy = clampDelta(dy, nodes.map((node) => node.y));
  return nodes.map((node) => ({ ...node, x: clampCoordinate(node.x + safeDx), y: clampCoordinate(node.y + safeDy) }));
}
