import type { FontMetrics } from "./geometry";
import type { CanvasNode, EllipseNode, Point, RectNode, TextNode } from "./model";

// Text inside a rectangle or ellipse (plan 03 §shape text): centred, wrapped to the shape's inner box, vertically
// centred. A rectangle's box is the shape less a padding; an ellipse's is the rectangle inscribed in it (about 70%
// of each side — the true inscribed square is 70.7%), so the text never leaves the curve.
// Longer text than fits is cut with "…" on the board (the editor shows all of it while typing).

export type Shape = RectNode | EllipseNode;
export const isShape = (node: CanvasNode): node is Shape => node.type === "rectangle" || node.type === "ellipse";

export const SHAPE_TEXT = {
  fontSize: 20,
  color: "#1F2937",
  lineHeight: 1.4,
  /** Gap between a rectangle's outline and its text, on each side. */
  padding: 8,
  /** Share of an ellipse's width / height that the text box takes. */
  ellipseShare: 0.7,
};

export type ShapeTextBox = { x: number; y: number; width: number; height: number };

/** The area the text is laid out in, in the shape's own frame (before rotation). */
export function shapeTextBox(node: Pick<Shape, "type" | "width" | "height" | "strokeWidth">): ShapeTextBox {
  if (node.type === "ellipse") {
    const width = Math.max(1, node.width * SHAPE_TEXT.ellipseShare), height = Math.max(1, node.height * SHAPE_TEXT.ellipseShare);
    return { x: (node.width - width) / 2, y: (node.height - height) / 2, width, height };
  }
  const pad = SHAPE_TEXT.padding + node.strokeWidth / 2;
  const width = Math.max(1, node.width - 2 * pad), height = Math.max(1, node.height - 2 * pad);
  return { x: (node.width - width) / 2, y: (node.height - height) / 2, width, height };
}

/** The text a shape shows and how (defaults for what was never set); null when it has none. */
export function shapeTextStyle(node: CanvasNode): { text: string; fontSize: number; color: string; bold: boolean; lineHeight: number } | null {
  if (!isShape(node) || !node.text || !node.text.trim()) return null;
  return { text: node.text, fontSize: node.fontSize ?? SHAPE_TEXT.fontSize, color: node.color ?? SHAPE_TEXT.color, bold: Boolean(node.bold), lineHeight: SHAPE_TEXT.lineHeight };
}

/** The shape with `text` set (or, when it is blank, removed — the other text settings stay for next time). */
export function withShapeText<T extends Shape>(node: T, text: string): T {
  const next = { ...node };
  if (text.trim()) next.text = text; else delete next.text;
  return next;
}

/** Size of the wrapped text in the shape's box, and whether it is taller than the box (so it is cut). */
export function measureShapeText(node: Shape, metrics: FontMetrics): { lineBox: ShapeTextBox; textHeight: number; overflow: boolean } | null {
  const style = shapeTextStyle(node);
  if (!style) return null;
  const box = shapeTextBox(node);
  const probe: TextNode = {
    id: node.id, type: "text", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, text: style.text, width: box.width, fontFamily: "Noto Sans Thai",
    fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color, align: "center", bold: style.bold,
  };
  const { height } = metrics.measureText(probe);
  return { lineBox: box, textHeight: height, overflow: height > box.height + 0.5 };
}

/** Is a world point inside the shape's outline (the whole area, also when the shape has no fill)? */
export function shapeContains(node: Shape, world: Point): boolean {
  const radians = -node.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const dx = world.x - node.x, dy = world.y - node.y;
  const x = dx * c - dy * s, y = dx * s + dy * c;
  if (node.type === "rectangle") return x >= 0 && x <= node.width && y >= 0 && y <= node.height;
  const rx = node.width / 2, ry = node.height / 2;
  return ((x - rx) / rx) ** 2 + ((y - ry) / ry) ** 2 <= 1;
}

/** The topmost unlocked rectangle/ellipse that contains a world point (z-order: later = on top). */
export function topShapeAt(nodes: CanvasNode[], world: Point): Shape | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (isShape(node) && !node.locked && shapeContains(node, world)) return node;
  }
  return null;
}
