import { isWidgetNode, type CanvasNode } from "@/domain/document/model";
import { LIMITS } from "@/domain/document/limits";
import { getNodeFrame } from "@/domain/document/transform";
import { SHAPE_TEXT, shapeTextStyle } from "@/domain/document/shape-text";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";

// Which properties each object type has, and how a change is applied — shared by the Properties panel
// and the quick-properties bar on the board.

export type Field = "opacity" | "stroke" | "strokeWidth" | "strokeStyle" | "fill" | "headLength" | "headWidth" | "color" | "fontSize" | "align" | "rotation" | "label" | "headerFill" | "header" | "bold" | "language" | "theme" | "lineNumbers" | "route";

/** A rectangle / ellipse that has text in it: it also has the text settings (size, colour, bold). */
const hasShapeText = (node: CanvasNode) => shapeTextStyle(node) !== null;
const STROKED = new Set(["rectangle", "ellipse", "line", "arrow", "pen", "highlighter"]);
export const supports = (node: CanvasNode, field: Field): boolean => {
  switch (field) {
    case "opacity": return true;
    case "rotation": return !isWidgetNode(node);
    case "stroke": return STROKED.has(node.type) || node.type === "table";
    case "strokeWidth": case "strokeStyle": return STROKED.has(node.type);
    case "fill": return node.type === "rectangle" || node.type === "ellipse";
    case "headLength": case "headWidth": return node.type === "arrow";
    case "route": return node.type === "line" || node.type === "arrow";
    case "color": return node.type === "text" || node.type === "stencil" || node.type === "table" || hasShapeText(node);
    case "fontSize": return node.type === "text" || node.type === "table" || node.type === "code" || hasShapeText(node);
    case "language": case "theme": case "lineNumbers": return node.type === "code";
    case "align": return node.type === "text";
    case "bold": return node.type === "text" || hasShapeText(node);
    case "label": return node.type === "stencil";
    case "headerFill": return node.type === "table";
    case "header": return node.type === "table" && node.variant === "grid";
  }
};
/** The value of a field as shown: a shape's text settings that were never set read as the defaults of shape text. */
export function fieldValue(node: CanvasNode, field: Field): unknown {
  const stored = (node as unknown as Record<string, unknown>)[field];
  if (stored !== undefined || (node.type !== "rectangle" && node.type !== "ellipse")) return stored;
  return field === "fontSize" ? SHAPE_TEXT.fontSize : field === "color" ? SHAPE_TEXT.color : field === "bold" ? false : stored;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sanitize(field: Field, value: unknown): unknown {
  if (field === "label" && typeof value === "string") return [...value.replace(/[\r\n\u2028\u2029]+/gu, " ")].slice(0, LIMITS.stencilLabelCodePoints).join("");
  if (field === "route") return value === "elbow" || value === "curved" ? value : "straight";
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

/** Straight is the default (no field); a hand-moved elbow segment is forgotten when the style changes. */
function withRoute(node: CanvasNode, route: "straight" | "elbow" | "curved"): CanvasNode {
  if (node.type !== "line" && node.type !== "arrow") return node;
  const next: typeof node = { ...node, route };
  if (route === "straight") delete next.route;
  if ((node.route ?? "straight") !== route) delete next.bend;
  return next;
}

/** Applies one field to every selected node that supports it; other fields stay untouched. */
export function applyField(nodes: CanvasNode[], field: Field, value: unknown): CanvasNode[] {
  const clean = sanitize(field, value);
  return nodes.filter((node) => supports(node, field)).map((node) => field === "route"
    ? withRoute(node, clean as "straight" | "elbow" | "curved")
    : field === "rotation"
    ? rotateAboutCenter(node, clean as number)
    : node.type === "table" && field === "fontSize"
      ? { ...node, fontSize: clamp(clean as number, LIMITS.tableFontMin, LIMITS.tableFontMax) }
      : node.type === "code" && field === "fontSize"
        ? { ...node, fontSize: clamp(clean as number, LIMITS.codeFontMin, LIMITS.codeFontMax) }
      : ({ ...node, [field]: clean } as CanvasNode));
}

