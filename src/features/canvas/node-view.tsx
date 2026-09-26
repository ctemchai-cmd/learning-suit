"use client";

import { memo } from "react";
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import type { CanvasNode, ImageNode } from "@/domain/document/model";
import { DataWidgetView } from "@/features/data-simulator/data-widget-view";
import { DeployWidgetView } from "@/features/deploy-simulator/deploy-widget-view";
import { AiWidgetView } from "@/features/ai-simulator/ai-widget-view";
import type { FlowPlay } from "@/features/flow/flow-session";
import { GitWidgetView } from "@/features/git-simulator/git-widget-view";
import type { GitPreview, GitTab, GitTransferAnimation } from "@/features/git-simulator/session-store";
import { CANVAS_FONT } from "./font-metrics";
import { useAssetImage } from "./image-cache";
import { StencilBody } from "./stencil-view";
import { TableBody } from "./table-view";

// Shared node renderer (ADR 0002): the editor and the offscreen export draw the same views
// from Drawing info. Selection chrome is never drawn here.

export type GitViewOptions = {
  activeTab: GitTab | null;
  transfer: GitTransferAnimation | null;
  /** Commit shown read-only in a file area (editor only; export passes nothing). */
  preview?: GitPreview | null;
};

const dashFor = (strokeStyle: "solid" | "dashed", width: number) =>
  strokeStyle === "dashed" ? [Math.max(6, width * 4), Math.max(4, width * 2.5)] : undefined;
const flat = (points: { x: number; y: number }[]) => points.flatMap((point) => [point.x, point.y]);

function ImageBody({ node, hitWidth }: { node: ImageNode; hitWidth: number }) {
  const entry = useAssetImage(node.assetId);
  if (entry.status === "ready") return <KonvaImage image={entry.image} width={node.width} height={node.height} hitStrokeWidth={hitWidth} />;
  const label = entry.status === "loading" ? "กำลังโหลดรูป…" : entry.status === "missing" ? `ไม่พบรูปในเครื่อง (${node.assetId.slice(0, 8)})` : "เปิดรูปไม่สำเร็จ";
  return <>
    <Rect width={node.width} height={node.height} fill="#F1F5F9" stroke="#94A3B8" strokeWidth={1} dash={[6, 4]} />
    <Text x={8} y={8} width={Math.max(10, node.width - 16)} text={label} fontSize={Math.max(10, Math.min(18, node.width / 12))} fontFamily={CANVAS_FONT} fill="#475569" />
  </>;
}

/** Body of a node in its local coordinate frame (the caller positions/rotates the Group). */
export function NodeBody({ node, hitWidth = 8, git, flow }: { node: CanvasNode; hitWidth?: number; git?: GitViewOptions; flow?: FlowPlay | null }) {
  switch (node.type) {
    case "rectangle":
      return <Rect width={node.width} height={node.height} stroke={node.stroke} strokeWidth={node.strokeWidth}
        dash={dashFor(node.strokeStyle, node.strokeWidth)} fill={node.fill === "transparent" ? undefined : node.fill} hitStrokeWidth={Math.max(node.strokeWidth, hitWidth)} />;
    case "ellipse":
      return <Ellipse x={node.width / 2} y={node.height / 2} radiusX={node.width / 2} radiusY={node.height / 2} stroke={node.stroke} strokeWidth={node.strokeWidth}
        dash={dashFor(node.strokeStyle, node.strokeWidth)} fill={node.fill === "transparent" ? undefined : node.fill} hitStrokeWidth={Math.max(node.strokeWidth, hitWidth)} />;
    case "line":
      return <Line points={flat(node.points)} stroke={node.stroke} strokeWidth={node.strokeWidth} dash={dashFor(node.strokeStyle, node.strokeWidth)}
        lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(node.strokeWidth, hitWidth)} />;
    case "arrow":
      return <Arrow points={flat(node.points)} stroke={node.stroke} fill={node.stroke} strokeWidth={node.strokeWidth} dash={dashFor(node.strokeStyle, node.strokeWidth)}
        pointerLength={node.headLength} pointerWidth={node.headWidth} lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(node.strokeWidth, hitWidth)} />;
    case "pen":
    case "highlighter":
      if (node.points.length === 1) return <Circle x={node.points[0].x} y={node.points[0].y} radius={node.strokeWidth / 2} fill={node.stroke} hitStrokeWidth={hitWidth} />;
      return <Line points={flat(node.points)} stroke={node.stroke} strokeWidth={node.strokeWidth} dash={dashFor(node.strokeStyle, node.strokeWidth)}
        tension={0} lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(node.strokeWidth, hitWidth)} />;
    case "text":
      return <Text text={node.text} width={node.width} fontSize={node.fontSize} fontFamily={CANVAS_FONT} lineHeight={node.lineHeight}
        fill={node.color} align={node.align} wrap="word" />;
    case "image":
      return <ImageBody node={node} hitWidth={hitWidth} />;
    case "stencil":
      return <StencilBody node={node} />;
    case "table":
      return <TableBody node={node} />;
    case "git-simulator":
      return <GitWidgetView node={node} activeTab={git?.activeTab ?? null} transfer={git?.transfer ?? null} preview={git?.preview ?? null} fontFamily={CANVAS_FONT} />;
    case "data-simulator":
      // `flow` (editor only) animates the last action; export draws the stored state.
      return <DataWidgetView node={node} play={flow ?? null} fontFamily={CANVAS_FONT} />;
    case "deploy-simulator":
      return <DeployWidgetView node={node} play={flow ?? null} fontFamily={CANVAS_FONT} />;
    case "ai-simulator":
      return <AiWidgetView node={node} play={flow ?? null} fontFamily={CANVAS_FONT} />;
  }
}

/** Positioned node (x, y, rotation, opacity) without interaction. Used by export and previews. */
export const StaticNodeView = memo(function StaticNodeView({ node, git }: { node: CanvasNode; git?: GitViewOptions }) {
  return <Group x={node.x} y={node.y} rotation={node.rotation} opacity={node.opacity} listening={false}>
    <NodeBody node={node} git={git} />
  </Group>;
});
