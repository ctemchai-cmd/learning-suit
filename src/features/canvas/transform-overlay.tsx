"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { CanvasNode, Point } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { screenToWorld, worldToScreen } from "@/domain/document/camera";
import type { FontMetrics } from "@/domain/document/geometry";
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
};

/**
 * DOM handles in screen space (constant 14 CSS px regardless of zoom). Pure geometry maps the
 * pointer back to world and normalizes into the model; one gesture = one transaction.
 */
export function TransformOverlay({ nodes, camera, metrics, containerRef, onPreview, onCommit, onGesture }: {
  nodes: CanvasNode[];
  camera: Camera;
  metrics: FontMetrics;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPreview: (nodes: CanvasNode[] | null) => void;
  onCommit: (nodes: CanvasNode[]) => void;
  onGesture: (active: boolean) => void;
}) {
  const active = useRef<Active | null>(null);
  const frame = useRef<number | null>(null);
  const cancel = useRef<() => void>(() => undefined);

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
      onGesture(false);
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel.current(); }
    };
    const onBlur = () => cancel.current();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onBlur); };
  }, []);
  useEffect(() => () => cancel.current(), []);

  if (!nodes.length) return null;
  const single = nodes.length === 1;
  const handles = single ? getSingleHandles(nodes[0], metrics, camera.zoom) : getMultiHandles(nodes, metrics, camera.zoom).handles;

  const compute = (current: Active, pointer: Point, shift: boolean): CanvasNode[] => {
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
      return <button key={id} type="button" aria-label={LABELS[id]} title={LABELS[id]}
        className={`absolute z-20 h-3.5 w-3.5 touch-none border-2 border-blue-600 bg-white shadow-sm ${id === "rotate" ? "rounded-full" : "rounded-[3px]"}`}
        style={{ left: screen.x, top: screen.y, transform: "translate(-50%, -50%)", cursor: CURSORS[id] }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = structuredClone(nodes);
          active.current = { pointerId: event.pointerId, handle: id, start, startPointer: toWorld(event), latest: start, target: event.currentTarget };
          onGesture(true);
          onPreview(start);
        }}
        onPointerMove={(event) => {
          const current = active.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.latest = compute(current, toWorld(event), event.shiftKey);
          if (frame.current) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (active.current) onPreview(active.current.latest);
          });
        }}
        onPointerUp={(event) => {
          const current = active.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const result = compute(current, toWorld(event), event.shiftKey);
          active.current = null;
          if (frame.current) cancelAnimationFrame(frame.current);
          frame.current = null;
          if (current.target.hasPointerCapture(event.pointerId)) current.target.releasePointerCapture(event.pointerId);
          onPreview(null);
          if (JSON.stringify(result) !== JSON.stringify(current.start)) onCommit(result);
          onGesture(false);
        }}
        onPointerCancel={() => cancel.current()}
        onLostPointerCapture={(event) => { if (active.current?.pointerId === event.pointerId) cancel.current(); }}
      />;
    })}
  </>;
}
