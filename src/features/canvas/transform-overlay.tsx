"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Bounds, CanvasNode, Point } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { screenToWorld, worldToScreen } from "@/domain/document/camera";
import { getNodeBounds, type FontMetrics } from "@/domain/document/geometry";
import { snapPoint, snapResize, snappingBypassed, type Guide, type ResizeHandle } from "@/domain/document/snap";
import {
  getMultiHandles, getSingleHandles, rotateSelection, rotateSingle, scaleSelection, transformSingle, type TransformHandleId,
} from "@/domain/document/transform";

const LABELS: Record<TransformHandleId, string> = {
  nw: "ปรับขนาด มุมซ้ายบน", n: "ปรับขนาด ด้านบน", ne: "ปรับขนาด มุมขวาบน", e: "ปรับขนาด ด้านขวา",
  se: "ปรับขนาด มุมขวาล่าง", s: "ปรับขนาด ด้านล่าง", sw: "ปรับขนาด มุมซ้ายล่าง", w: "ปรับขนาด ด้านซ้าย",
  start: "ขยับ จุดเริ่ม", end: "ขยับ จุดปลาย", rotate: "หมุนวัตถุ",
};
const CURSORS: Record<TransformHandleId, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize", se: "nwse-resize", s: "ns-resize",
  sw: "nesw-resize", w: "ew-resize", start: "move", end: "move", rotate: "grab",
};

type Active = {
  pointerId: number;
  handle: TransformHandleId;
  start: CanvasNode[];
  startPointer: Point;
  latest: CanvasNode[];
  target: HTMLElement;
  /** Snapping targets (other objects in view), taken when the gesture starts. */
  others: Bounds[];
  /** Guides of the latest pointer, read when the frame is drawn (kept here, not in React state, so frames never see stale ones). */
  guides: Guide[];
};

/** What can snap while resized (plan 03 §snap): unrotated single objects with a box (not pen strokes) and line/arrow ends. */
const SNAPPABLE = new Set<CanvasNode["type"]>(["rectangle", "ellipse", "stencil", "image", "text", "table", "code", "line", "arrow",
  "git-simulator", "data-simulator", "deploy-simulator", "ai-simulator", "ssh-simulator"]);

/** The box whose edges follow the pointer: the shape's geometry (no stroke), a table without its half border. */
function edgeBox(node: CanvasNode, metrics: FontMetrics): Bounds {
  if (node.type === "rectangle" || node.type === "ellipse") return { x: node.x, y: node.y, width: node.width, height: node.height };
  const bounds = getNodeBounds(node, metrics);
  return node.type === "table" ? { x: bounds.x + 1, y: bounds.y + 1, width: bounds.width - 2, height: bounds.height - 2 } : bounds;
}

/**
 * DOM handles in screen space (constant 14 CSS px regardless of zoom). Pure geometry maps the
 * pointer back to world and normalizes into the model; one gesture = one transaction.
 */
export function TransformOverlay({ nodes, camera, metrics, containerRef, onPreview, onCommit, onGesture, snap }: {
  nodes: CanvasNode[];
  camera: Camera;
  metrics: FontMetrics;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPreview: (nodes: CanvasNode[] | null) => void;
  onCommit: (nodes: CanvasNode[]) => void;
  onGesture: (active: boolean) => void;
  /**
   * Snapping while resizing: `others()` = the objects to line up with (taken at the start of a gesture), `grid` the
   * minor grid, `attaches` whether a line end dropped at a point would attach to an object (binding wins over snapping),
   * `onGuides` the pink guides to draw (empty when the gesture ends).
   */
  snap?: { others: () => Bounds[]; grid: number | null; attaches: (node: CanvasNode, handle: TransformHandleId, world: Point) => boolean; onGuides: (guides: Guide[]) => void };
}) {
  const active = useRef<Active | null>(null);
  const frame = useRef<number | null>(null);
  const cancel = useRef<() => void>(() => undefined);
  /** Interrupted from outside (window blur, lost capture, pointercancel): keep the size/angle last shown. */
  const interrupt = useRef<() => void>(() => undefined);

  const toWorld = (event: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return screenToWorld({ x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }, camera);
  };

  useLayoutEffect(() => {
    cancel.current = () => {
      const current = active.current;
      if (!current) return;
      active.current = null;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
      onPreview(null);
      snap?.onGuides([]);
      onGesture(false);
    };
    interrupt.current = () => {
      const current = active.current;
      if (!current) return;
      const result = current.latest;
      cancel.current();
      if (JSON.stringify(result) !== JSON.stringify(current.start)) onCommit(result);
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel.current(); }
    };
    // A screen-sharing app or a system dialog taking focus must not throw the resize away (only Escape does).
    const onBlur = () => interrupt.current();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onBlur); };
  }, []);
  useEffect(() => () => cancel.current(), []);

  if (!nodes.length) return null;
  const single = nodes.length === 1;
  const handles = single ? getSingleHandles(nodes[0], metrics, camera.zoom) : getMultiHandles(nodes, metrics, camera.zoom).handles;

  /**
   * Single, unrotated object: the moved edges (or a line end) snap to other objects / the grid unless ⌘/Ctrl is held.
   * Rotated objects, pen strokes and multi-selections are not snapped. Shift on a line end (45°) is not snapped either.
   */
  const snapped = (current: Active, pointer: Point, shift: boolean, free: boolean): Point => {
    current.guides = [];
    const node = current.start[0];
    if (!snap || !single || free || current.handle === "rotate" || node.rotation !== 0 || !SNAPPABLE.has(node.type)) return pointer;
    const options = { threshold: 6 / camera.zoom, grid: snap.grid };
    if (node.type === "line" || node.type === "arrow") {
      if (shift || snap.attaches(node, current.handle, pointer)) return pointer;
      const result = snapPoint(pointer, current.others, options);
      current.guides = result.guides;
      return result.point;
    }
    const handle = current.handle as ResizeHandle;
    const keepAspect = shift || node.type === "image" || node.type === "code" || node.type.endsWith("-simulator");
    const result = snapResize(handle, pointer, current.others, {
      ...options, keepAspect,
      resulting: (at) => edgeBox(transformSingle(node, handle, at, { keepAspect: shift }, metrics), metrics),
    });
    current.guides = result.guides;
    return result.pointer;
  };

  const compute = (current: Active, rawPointer: Point, shift: boolean, free: boolean): CanvasNode[] => {
    const pointer = snapped(current, rawPointer, shift, free);
    if (current.handle === "rotate") {
      return single
        ? [rotateSingle(current.start[0], current.startPointer, pointer, shift, metrics)]
        : rotateSelection(current.start, current.startPointer, pointer, shift, metrics);
    }
    if (single) return [transformSingle(current.start[0], current.handle, pointer, { keepAspect: shift }, metrics)];
    if (current.handle === "nw" || current.handle === "ne" || current.handle === "se" || current.handle === "sw") {
      return scaleSelection(current.start, current.handle, pointer, metrics);
    }
    return current.start;
  };

  return <>
    {handles.map(({ id, world }) => {
      const screen = worldToScreen(world, camera);
      return <button key={id} type="button" aria-label={LABELS[id]} title={LABELS[id]} data-board-chrome
        className={`absolute z-20 h-3.5 w-3.5 touch-none border-2 border-blue-600 bg-white shadow-sm ${id === "rotate" ? "rounded-full" : "rounded-[3px]"}`}
        style={{ left: screen.x, top: screen.y, transform: "translate(-50%, -50%)", cursor: CURSORS[id] }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = structuredClone(nodes);
          active.current = { pointerId: event.pointerId, handle: id, start, startPointer: toWorld(event), latest: start, target: event.currentTarget, others: snap && id !== "rotate" ? snap.others() : [], guides: [] };
          onGesture(true);
          onPreview(start);
        }}
        onPointerMove={(event) => {
          const current = active.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.latest = compute(current, toWorld(event), event.shiftKey, snappingBypassed(event));
          if (frame.current) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (active.current) { onPreview(active.current.latest); snap?.onGuides(active.current.guides); }
          });
        }}
        onPointerUp={(event) => {
          const current = active.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const result = compute(current, toWorld(event), event.shiftKey, snappingBypassed(event));
          active.current = null;
          if (frame.current) cancelAnimationFrame(frame.current);
          frame.current = null;
          if (current.target.hasPointerCapture(event.pointerId)) current.target.releasePointerCapture(event.pointerId);
          onPreview(null);
          snap?.onGuides([]);
          if (JSON.stringify(result) !== JSON.stringify(current.start)) onCommit(result);
          onGesture(false);
        }}
        onPointerCancel={() => interrupt.current()}
        onLostPointerCapture={(event) => { if (active.current?.pointerId === event.pointerId) interrupt.current(); }}
      />;
    })}
  </>;
}
