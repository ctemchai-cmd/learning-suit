import type { CanvasNode, Point } from "@/domain/document/model";
import { freehandFromWorld } from "@/domain/document/simplify";
import type { ToolDefaults } from "@/features/editor/tool-defaults";
import { DEFAULTS } from "@/domain/document/limits";

export type StepTool = "rectangle" | "ellipse" | "line" | "arrow";
export const isStepTool = (tool: string): tool is StepTool => tool === "rectangle" || tool === "ellipse" || tool === "line" || tool === "arrow";

/** Shift constraint: square/circle for boxes, 45° snapping for lines/arrows. */
export function constrainPoint(tool: StepTool, start: Point, current: Point): Point {
  const dx = current.x - start.x, dy = current.y - start.y;
  if (tool === "rectangle" || tool === "ellipse") {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx || 1) * size, y: start.y + Math.sign(dy || 1) * size };
  }
  const distance = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + distance * Math.cos(angle), y: start.y + distance * Math.sin(angle) };
}

/** Two-click shapes; returns null when the points are closer than 3 CSS px (keep waiting for point two). */
export function stepNode(tool: StepTool, start: Point, current: Point, zoom: number, id: string, defaults: ToolDefaults): CanvasNode | null {
  const dx = current.x - start.x, dy = current.y - start.y;
  if (Math.hypot(dx, dy) * zoom < DEFAULTS.cloneThresholdPx) return null;
  const x = Math.min(start.x, current.x), y = Math.min(start.y, current.y);
  const base = { id, x, y, rotation: 0, opacity: 1, locked: false };
  if (tool === "rectangle" || tool === "ellipse") {
    const shape = defaults.shape;
    return { ...base, type: tool, width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)), stroke: shape.stroke, strokeWidth: shape.strokeWidth, strokeStyle: shape.strokeStyle, fill: shape.fill };
  }
  const line = defaults.line;
  const points: [Point, Point] = [{ x: start.x - x, y: start.y - y }, { x: current.x - x, y: current.y - y }];
  if (tool === "arrow") return { ...base, type: "arrow", points, stroke: line.stroke, strokeWidth: line.strokeWidth, strokeStyle: line.strokeStyle, headLength: line.headLength, headWidth: line.headWidth };
  return { ...base, type: "line", points, stroke: line.stroke, strokeWidth: line.strokeWidth, strokeStyle: line.strokeStyle };
}

/** Pen/Highlighter stroke from world samples (RDP with tolerance 0.35 / zoomAtStart). */
export function freehandNode(tool: "pen" | "highlighter", samples: Point[], zoomAtStart: number, id: string, defaults: ToolDefaults): CanvasNode {
  const geometry = freehandFromWorld(samples, zoomAtStart);
  const style = tool === "pen" ? defaults.pen : defaults.highlighter;
  return {
    id, type: tool, x: geometry.x, y: geometry.y, points: geometry.points, rotation: 0, locked: false,
    opacity: tool === "pen" ? DEFAULTS.penOpacity : DEFAULTS.highlighterOpacity,
    stroke: style.stroke, strokeWidth: style.strokeWidth, strokeStyle: "solid",
  };
}
