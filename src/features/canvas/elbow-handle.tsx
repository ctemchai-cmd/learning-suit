"use client";

import { useRef, useState } from "react";
import type { ArrowNode, LineNode, Point } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { screenToWorld, worldToScreen } from "@/domain/document/camera";
import { elbowLayout } from "@/domain/document/connector-route";
import { useEditorStore } from "@/features/editor/store";

// The middle segment of a selected right-angled arrow can be dragged sideways (draw.io style); double-click puts
// it back halfway. One drag = one Undo step.

type Connector = LineNode | ArrowNode;

const toWorldPoint = (node: Connector, point: Point): Point => {
  const radians = node.rotation * Math.PI / 180;
  return { x: node.x + point.x * Math.cos(radians) - point.y * Math.sin(radians), y: node.y + point.x * Math.sin(radians) + point.y * Math.cos(radians) };
};

/**
 * The end of a line/arrow that was dragged on its own (not the whole line moved), with where it is now and what
 * the other end is attached to — null when no single end moved.
 */
export function draggedEnd(before: Connector, next: Connector): { key: "startBinding" | "endBinding"; world: Point; otherBinding?: string } | null {
  const moved = ([0, 1] as const).filter((index) => {
    const was = toWorldPoint(before, before.points[index]), now = toWorldPoint(next, next.points[index]);
    return Math.hypot(was.x - now.x, was.y - now.y) > 0.5;
  });
  if (moved.length !== 1) return null;
  const index = moved[0];
  return {
    key: index === 0 ? "startBinding" : "endBinding",
    world: toWorldPoint(next, next.points[index]),
    otherBinding: (index === 0 ? next.endBinding : next.startBinding)?.nodeId,
  };
}

export function ElbowHandle({ node, slideId, camera, containerRef }: {
  node: Connector;
  slideId: string;
  camera: Camera;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const drag = useRef<{ pointerId: number; grab: Point; bend: number } | null>(null);
  const [bend, setBend] = useState<number | null>(null);
  const shown = bend === null ? node : { ...node, bend };
  const middle = elbowLayout(shown).middle;
  if (!middle || node.locked) return null;
  const centre = worldToScreen(toWorldPoint(node, { x: (middle.from.x + middle.to.x) / 2, y: (middle.from.y + middle.to.y) / 2 }), camera);
  const worldOf = (event: { clientX: number; clientY: number }) => {
    const box = containerRef.current?.getBoundingClientRect();
    return screenToWorld({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }, camera);
  };
  const valueAt = (event: { clientX: number; clientY: number }) => {
    const state = drag.current!;
    const world = worldOf(event);
    return Math.round(state.bend + (middle.axis === "x" ? world.x - state.grab.x : world.y - state.grab.y));
  };
  const preview = (value: number | null) => {
    setBend(value);
    useEditorStore.getState().setPropertyPreview(value === null ? null : { slideId, nodes: [{ ...node, bend: value }] });
  };
  const commit = (value: number) => {
    if (value === (node.bend ?? 0)) return;
    const next: Connector = { ...node };
    if (value) next.bend = value; else delete next.bend;
    useEditorStore.getState().transact({ label: "ปรับแนวเส้นหักฉาก", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [next] }] });
  };
  const end = (pointerId: number, value: number | null) => {
    if (drag.current?.pointerId !== pointerId) return;
    drag.current = null;
    preview(null);
    useEditorStore.getState().setGestureActive(false);
    if (value !== null) commit(value);
  };
  return <button type="button" data-board-chrome aria-label="ลากเพื่อเลื่อนแนวเส้นหักฉาก" title="ลากเพื่อเลื่อนแนวเส้น · ดับเบิลคลิกเพื่อกลับไปกึ่งกลาง"
    className={`absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 touch-none rounded-sm border-2 border-amber-500 bg-white shadow ${middle.axis === "x" ? "cursor-ew-resize" : "cursor-ns-resize"}`}
    style={{ left: centre.x, top: centre.y }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, grab: worldOf(event), bend: node.bend ?? 0 };
      useEditorStore.getState().setGestureActive(true);
    }}
    onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) preview(valueAt(event)); }}
    onPointerUp={(event) => end(event.pointerId, drag.current?.pointerId === event.pointerId ? valueAt(event) : null)}
    onPointerCancel={(event) => end(event.pointerId, null)}
    onLostPointerCapture={(event) => end(event.pointerId, bend)}
    onDoubleClick={(event) => { event.stopPropagation(); commit(0); }} />;
}
