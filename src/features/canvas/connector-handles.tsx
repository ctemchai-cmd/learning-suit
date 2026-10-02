"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { ArrowNode, CanvasNode, ConnectorAnchor, Point } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { screenToWorld, worldToScreen } from "@/domain/document/camera";
import { ANCHORS, anchorPoint, connectableAt, nearestAnchor } from "@/domain/document/connectors";
import { getNodeFrame } from "@/domain/document/transform";
import { useEditorStore } from "@/features/editor/store";
import { konvaFontMetrics } from "./font-metrics";

// Connection points (plan 03 §connectors): with one object selected, a small point outside each side. Dragging one
// draws an arrow from that side; released on another object it attaches to the nearest side there (the object
// lights up), released on empty board it ends there. One drag = one Undo step.

/** Screen distance of the points from the sides; the top one sits above the rotation handle (28 px). */
const OUTSIDE_PX: Record<"n" | "e" | "s" | "w", number> = { n: 52, e: 24, s: 24, w: 24 };
const GAP = 6;
const LABELS: Record<Exclude<ConnectorAnchor, "auto">, string> = { n: "ด้านบน", e: "ด้านขวา", s: "ด้านล่าง", w: "ด้านซ้าย" };

type Drag = { pointerId: number; anchor: Exclude<ConnectorAnchor, "auto">; start: Point; current: Point; target: CanvasNode | null };

export function ConnectorHandles({ node, nodes, slideId, camera, containerRef }: {
  node: CanvasNode;
  nodes: CanvasNode[];
  slideId: string;
  camera: Camera;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const toWorld = (event: { clientX: number; clientY: number }) => {
    const box = containerRef.current?.getBoundingClientRect();
    return screenToWorld({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }, camera);
  };
  const update = (next: Drag | null) => { dragRef.current = next; setDrag(next); };
  const endOf = (state: Drag): Point => state.target ? anchorPoint(state.target, nearestAnchor(state.target, state.start, konvaFontMetrics), konvaFontMetrics, GAP) : state.current;

  const finish = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    update(null);
    useEditorStore.getState().setGestureActive(false);
    if (!commit) return;
    const end = endOf(state);
    if (Math.hypot(end.x - state.start.x, end.y - state.start.y) * camera.zoom < 12) return;
    const store = useEditorStore.getState();
    const style = store.toolDefaults.line;
    const arrow: ArrowNode = {
      id: crypto.randomUUID(), type: "arrow", x: state.start.x, y: state.start.y, rotation: 0, opacity: 1, locked: false,
      points: [{ x: 0, y: 0 }, { x: end.x - state.start.x, y: end.y - state.start.y }],
      stroke: style.stroke, strokeWidth: style.strokeWidth, strokeStyle: style.strokeStyle, headLength: style.headLength, headWidth: style.headWidth,
      // Both ends float ("auto"): they keep facing each other wherever the objects move.
      startBinding: { nodeId: node.id, anchor: "auto" },
      ...(state.target ? { endBinding: { nodeId: state.target.id, anchor: "auto" as const } } : {}),
    };
    if (store.transact({ label: "ลากลูกศรเชื่อม", affectedSlideId: slideId, commands: [{ type: "nodes.insert", slideId, nodes: [arrow] }] })) store.setSelectedIds([arrow.id]);
  };

  const target = drag?.target ? getNodeFrame(drag.target, konvaFontMetrics) : null;
  const toScreen = (point: Point) => worldToScreen(point, camera);
  return <>
    {ANCHORS.map((anchor) => {
      const at = toScreen(anchorPoint(node, anchor, konvaFontMetrics, OUTSIDE_PX[anchor] / camera.zoom));
      const pressed = drag?.anchor === anchor;
      return <button key={anchor} type="button" data-board-chrome aria-label={`ลากลูกศรเชื่อมจาก${LABELS[anchor]}`} title="ลากไปที่วัตถุอื่นเพื่อเชื่อมด้วยลูกศร"
        className={`group absolute z-30 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none place-items-center rounded-full ${drag && !pressed ? "invisible" : ""}`}
        style={{ left: at.x, top: at.y }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = anchorPoint(node, anchor, konvaFontMetrics, GAP);
          useEditorStore.getState().setGestureActive(true);
          update({ pointerId: event.pointerId, anchor, start, current: toWorld(event), target: null });
        }}
        onPointerMove={(event) => {
          const state = dragRef.current;
          if (!state || state.pointerId !== event.pointerId) return;
          const current = toWorld(event);
          update({ ...state, current, target: connectableAt(nodes, current, konvaFontMetrics, node.id) });
        }}
        onPointerUp={(event) => finish(event, true)}
        onPointerCancel={(event) => finish(event, false)}
        onLostPointerCapture={(event) => finish(event, false)}>
        <span aria-hidden className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 shadow ring-1 ring-sky-600/40 transition-transform group-hover:scale-150" />
      </button>;
    })}
    {drag && <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
        {target && (() => {
          const center = toScreen(target.center);
          return <rect x={center.x - target.width * camera.zoom / 2 - 4} y={center.y - target.height * camera.zoom / 2 - 4}
            width={target.width * camera.zoom + 8} height={target.height * camera.zoom + 8} rx={6}
            transform={`rotate(${target.rotation} ${center.x} ${center.y})`} fill="rgba(14,165,233,0.08)" stroke="#0EA5E9" strokeWidth={2} />;
        })()}
        {(() => {
          const from = toScreen(drag.start), to = toScreen(endOf(drag));
          return <>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#0EA5E9" strokeWidth={2} strokeDasharray="6 4" />
            <circle cx={to.x} cy={to.y} r={4} fill="#0EA5E9" />
          </>;
        })()}
      </svg>
    </>}
  </>;
}
