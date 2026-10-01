import { isWidgetNode, type CanvasNode } from "@/domain/document/model";
import { LIMITS } from "@/domain/document/limits";
import { getNodeFrame } from "@/domain/document/transform";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";

// Which properties each object type has, and how a change is applied — shared by the Properties panel
// and the quick-properties bar on the board.

export type Field = "opacity" | "stroke" | "strokeWidth" | "strokeStyle" | "fill" | "headLength" | "headWidth" | "color" | "fontSize" | "align" | "rotation" | "label" | "headerFill" | "header" | "bold" | "language" | "theme" | "lineNumbers";

const STROKED = new Set(["rectangle", "ellipse", "line", "arrow", "pen", "highlighter"]);
export const supports = (node: CanvasNode, field: Field): boolean => {
  switch (field) {
    case "opacity": return true;
    case "rotation": return !isWidgetNode(node);
    case "stroke": return STROKED.has(node.type) || node.type === "table";
    case "strokeWidth": case "strokeStyle": return STROKED.has(node.type);
    case "fill": return node.type === "rectangle" || node.type === "ellipse";
    case "headLength": case "headWidth": return node.type === "arrow";
    case "color": return node.type === "text" || node.type === "stencil" || node.type === "table";
    case "fontSize": return node.type === "text" || node.type === "table" || node.type === "code";
    case "language": case "theme": case "lineNumbers": return node.type === "code";
    case "align": case "bold": return node.type === "text";
    case "label": return node.type === "stencil";
    case "headerFill": return node.type === "table";
    case "header": return node.type === "table" && node.variant === "grid";
  }
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sanitize(field: Field, value: unknown): unknown {
  if (field === "label" && typeof value === "string") return [...value.replace(/[\r\n\u2028\u2029]+/gu, " ")].slice(0, LIMITS.stencilLabelCodePoints).join("");
  if (typeof value !== "number") return value;
  if (field === "opacity") return clamp(value, LIMITS.opacityMin, LIMITS.opacityMax);
  if (field === "strokeWidth") return clamp(value, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax);
  if (field === "fontSize") return clamp(value, LIMITS.fontSizeMin, LIMITS.fontSizeMax);
  if (field === "headLength" || field === "headWidth") return clamp(value, 1, 256);
  if (field === "rotation") return ((value % 360) + 540) % 360 - 180;
  return value;
}

/** Sets an absolute rotation while keeping the visual center fixed (same pivot as the rotate handle). */
function rotateAboutCenter(node: CanvasNode, rotation: number): CanvasNode {
  const center = getNodeFrame(node, konvaFontMetrics).center;
  const rotated = { ...node, rotation } as CanvasNode;
  const moved = getNodeFrame(rotated, konvaFontMetrics).center;
  return { ...rotated, x: node.x + center.x - moved.x, y: node.y + center.y - moved.y } as CanvasNode;
}

/** Applies one field to every selected node that supports it; other fields stay untouched. */
export function applyField(nodes: CanvasNode[], field: Field, value: unknown): CanvasNode[] {
  const clean = sanitize(field, value);
  return nodes.filter((node) => supports(node, field)).map((node) => field === "rotation"
    ? rotateAboutCenter(node, clean as number)
    : node.type === "table" && field === "fontSize"
      ? { ...node, fontSize: clamp(clean as number, LIMITS.tableFontMin, LIMITS.tableFontMax) }
      : node.type === "code" && field === "fontSize"
        ? { ...node, fontSize: clamp(clean as number, LIMITS.codeFontMin, LIMITS.codeFontMax) }
      : ({ ...node, [field]: clean } as CanvasNode));
}

