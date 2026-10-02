"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { ArrowNode, CanvasNode, ConnectorBinding, ConnectorSide, Point } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { screenToWorld, worldToScreen } from "@/domain/document/camera";
import { ANCHORS, anchorPoint, connectableAt, connectionPoint, connectionPoints, nearestConnectionPoint, withLiveConnectors } from "@/domain/document/connectors";
import { connectorPath } from "@/domain/document/connector-route";
import { getNodeFrame } from "@/domain/document/transform";
import { useEditorStore } from "@/features/editor/store";
import { konvaFontMetrics } from "./font-metrics";

// Connection points (plan 03 §connectors), draw.io style. A selected object shows
// - a dot outside each side: dragging one draws an arrow that keeps facing the other end;
// - small × just outside its outline at its other connection points: dragging one starts the arrow exactly there.
//   They stay off the outline itself, which is where an unfilled shape is grabbed to move it;
// - released on another object, the arrow attaches to the connection point near the pointer (it lights up) or,
//   anywhere else on the object, to the side facing it; released on empty board it ends there.
// New arrows are right-angled (elbow); the quick bar switches them to straight or curved. One drag = one Undo step.

/** Screen distance of the side points from the sides; the top one sits above the rotation handle (28 px). */
const OUTSIDE_PX: Record<ConnectorSide, number> = { n: 52, e: 24, s: 24, w: 24 };
/** Screen distance of the × points from the outline (clear of the outline's grab area). */
const POINT_OUT_PX = 12;
const GAP = 6;
/** Screen distance within which a drop snaps to a connection point. */
export const SNAP_PX = 14;
const LABELS: Record<ConnectorSide, string> = { n: "ด้านบน", e: "ด้านขวา", s: "ด้านล่าง", w: "ด้านซ้าย" };

type Drag = { pointerId: number; from: ConnectorBinding; key: string; start: Point; current: Point; target: CanvasNode | null; at: Point | null };

/** Where a dragged connector end lands: an object (and its connection point when near one), or nothing. */
export function dropTarget(nodes: CanvasNode[], world: Point, zoom: number, except?: string): { target: CanvasNode | null; at: Point | null } {
  const target = connectableAt(nodes, world, konvaFontMetrics, except);
  return { target, at: target ? nearestConnectionPoint(target, world, konvaFontMetrics, SNAP_PX / zoom) : null };
}

/** Connection points of a drop target, the snapped one highlighted (screen overlay). */
export function TargetPoints({ node, at, camera }: { node: CanvasNode; at: Point | null; camera: Camera }) {
  const frame = getNodeFrame(node, konvaFontMetrics);
  const center = worldToScreen(frame.center, camera);
  return <svg aria-hidden className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
    {!at && <rect x={center.x - frame.width * camera.zoom / 2 - 4} y={center.y - frame.height * camera.zoom / 2 - 4}
      width={frame.width * camera.zoom + 8} height={frame.height * camera.zoom + 8} rx={6}
      transform={`rotate(${frame.rotation} ${center.x} ${center.y})`} fill="rgba(14,165,233,0.08)" stroke="#0EA5E9" strokeWidth={2} />}
    {connectionPoints(node).map((point, index) => {
      const screen = worldToScreen(connectionPoint(node, point, konvaFontMetrics), camera);
      const on = at && Math.abs(at.x - point.x) < 1e-9 && Math.abs(at.y - point.y) < 1e-9;
      return on
        ? <circle key={index} cx={screen.x} cy={screen.y} r={6} fill="rgba(14,165,233,0.25)" stroke="#0EA5E9" strokeWidth={2} />
        : <path key={index} d={`M${screen.x - 3} ${screen.y - 3}l6 6m0 -6l-6 6`} stroke="#0284C7" strokeWidth={1.5} />;
    })}
  </svg>;
}

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

  /** The arrow this drag makes, attached and placed like the real one (also the preview). */
  const arrowOf = (state: Drag): ArrowNode => {
    const style = useEditorStore.getState().toolDefaults.line;
    const endBinding: ConnectorBinding | undefined = state.target ? (state.at ? { nodeId: state.target.id, anchor: "fixed", at: state.at } : { nodeId: state.target.id, anchor: "auto" }) : undefined;
    const arrow: ArrowNode = {
      id: crypto.randomUUID(), type: "arrow", x: state.start.x, y: state.start.y, rotation: 0, opacity: 1, locked: false,
      points: [{ x: 0, y: 0 }, { x: state.current.x - state.start.x, y: state.current.y - state.start.y }],
      stroke: style.stroke, strokeWidth: style.strokeWidth, strokeStyle: style.strokeStyle, headLength: style.headLength, headWidth: style.headWidth,
      route: "elbow", startBinding: state.from, ...(endBinding ? { endBinding } : {}),
    };
    return withLiveConnectors([...nodes, arrow], konvaFontMetrics, new Set()).find((item) => item.id === arrow.id) as ArrowNode;
  };

  const begin = (event: PointerEvent<HTMLButtonElement>, from: ConnectorBinding, key: string, start: Point) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    useEditorStore.getState().setGestureActive(true);
    update({ pointerId: event.pointerId, from, key, start, current: toWorld(event), target: null, at: null });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const current = toWorld(event);
    update({ ...state, current, ...dropTarget(nodes, current, camera.zoom, node.id) });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    update(null);
    useEditorStore.getState().setGestureActive(false);
    if (!commit) return;
    const store = useEditorStore.getState();
    const arrow = arrowOf(state);
    const [a, b] = arrow.points;
    if (Math.hypot(b.x - a.x, b.y - a.y) * camera.zoom < 12) return;
    if (store.transact({ label: "ลากลูกศรเชื่อม", affectedSlideId: slideId, commands: [{ type: "nodes.insert", slideId, nodes: [arrow] }] })) store.setSelectedIds([arrow.id]);
  };
  const handlers = { onPointerMove: move, onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, false), onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, false) };

  const toScreen = (point: Point) => worldToScreen(point, camera);
  const preview = drag ? arrowOf(drag) : null;
  return <>
    {ANCHORS.map((anchor) => {
      const at = toScreen(anchorPoint(node, anchor, konvaFontMetrics, OUTSIDE_PX[anchor] / camera.zoom));
      const key = `side-${anchor}`;
      return <button key={key} type="button" data-board-chrome aria-label={`ลากลูกศรเชื่อมจาก${LABELS[anchor]}`} title="ลากไปที่วัตถุอื่นเพื่อเชื่อมด้วยลูกศร"
        className={`group absolute z-30 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none place-items-center rounded-full ${drag && drag.key !== key ? "invisible" : ""}`}
        style={{ left: at.x, top: at.y }}
        onPointerDown={(event) => begin(event, { nodeId: node.id, anchor: "auto" }, key, anchorPoint(node, anchor, konvaFontMetrics, GAP))} {...handlers}>
        <span aria-hidden className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500 shadow ring-1 ring-sky-600/40 transition-transform group-hover:scale-150" />
      </button>;
    })}
    {connectionPoints(node).map((point, index) => {
      // Corners and side middles: the resize handles and the side dots are there.
      const middle = Math.abs(point.x - 0.5) < 1e-9 || Math.abs(point.y - 0.5) < 1e-9;
      const corner = (point.x === 0 || point.x === 1) && (point.y === 0 || point.y === 1);
      if (middle || (node.type !== "ellipse" && corner)) return null;
      const at = toScreen(connectionPoint(node, point, konvaFontMetrics, POINT_OUT_PX / camera.zoom));
      const key = `point-${index}`;
      return <button key={key} type="button" data-board-chrome aria-label={`ลากลูกศรเชื่อมจากจุดเชื่อม ${index + 1}`} title="ลากจากจุดนี้เพื่อเชื่อมด้วยลูกศร"
        className={`group absolute z-20 grid h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none place-items-center ${drag && drag.key !== key ? "invisible" : ""}`}
        style={{ left: at.x, top: at.y }}
        onPointerDown={(event) => begin(event, { nodeId: node.id, anchor: "fixed", at: point }, key, connectionPoint(node, point, konvaFontMetrics, GAP))} {...handlers}>
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="transition-transform group-hover:scale-150"><path d="M2 2l6 6m0-6l-6 6" stroke="#0284C7" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>;
    })}
    {drag && preview && <>
      {drag.target && <TargetPoints node={drag.target} at={drag.at} camera={camera} />}
      <svg aria-hidden className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
        {(() => {
          const path = connectorPath(preview);
          const points = path.points.map((point) => toScreen({ x: preview.x + point.x, y: preview.y + point.y }));
          const d = path.bezier
            ? `M${points[0].x} ${points[0].y}C${points[1].x} ${points[1].y} ${points[2].x} ${points[2].y} ${points[3].x} ${points[3].y}`
            : points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join("");
          const tip = points[points.length - 1];
          return <>
            <path d={d} fill="none" stroke="#0EA5E9" strokeWidth={2} strokeDasharray="6 4" />
            <circle cx={tip.x} cy={tip.y} r={4} fill="#0EA5E9" />
          </>;
        })()}
      </svg>
    </>}
  </>;
}
