import { isWidgetNode, widgetNodeSize, type Bounds, type CanvasNode, type Point, type TextNode } from "./model";
import { tableLayout } from "./table";
import { codeLayout } from "./code";

export interface FontMetrics {
  measureText(node: TextNode): { width: number; height: number };
  /** Width of one line of code in the monospace font (code blocks). */
  measureMono(text: string, fontSize: number): number;
}
export const fallbackFontMetrics: FontMetrics = {
  measureText(node) {
    const lines = node.text.split("\n");
    const charactersPerLine = Math.max(1, Math.floor(node.width / (node.fontSize * 0.65)));
    const wrapped = lines.reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / charactersPerLine)), 0);
    return { width: node.width, height: wrapped * node.fontSize * node.lineHeight };
  },
  measureMono: (text, fontSize) => [...text].length * fontSize * 0.6,
};

function rotateAndTranslate(point: Point, node: CanvasNode): Point {
  const radians = node.rotation * Math.PI / 180;
  const c = Math.cos(radians), s = Math.sin(radians);
  return { x: node.x + point.x * c - point.y * s, y: node.y + point.x * s + point.y * c };
}
function aabb(points: Point[], padding: number): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  minX -= padding; maxX += padding; minY -= padding; maxY += padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getNodeBounds(node: CanvasNode, metrics: FontMetrics = fallbackFontMetrics): Bounds {
  let points: Point[];
  let pad = 0;
  if (node.type === "rectangle" || node.type === "ellipse" || node.type === "image" || node.type === "stencil") {
    // Expand by half the stroke BEFORE rotating: rotated miter corners reach the expanded box corners
    // (a conservative AABB that never crops the stroke). Stencils draw their outline inside the box.
    const half = node.type === "image" || node.type === "stencil" ? 0 : node.strokeWidth / 2;
    points = [{ x: -half, y: -half }, { x: node.width + half, y: -half }, { x: node.width + half, y: node.height + half }, { x: -half, y: node.height + half }];
  } else if (node.type === "code") {
    const { width, height } = codeLayout(node, metrics);
    points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  } else if (node.type === "table") {
    const { width, height } = tableLayout(node, metrics);
    // The border is drawn on the edge: half of its width lies outside.
    points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
    pad = 1;
  } else if (node.type === "text") {
    const { height } = metrics.measureText(node);
    points = [{ x: 0, y: 0 }, { x: node.width, y: 0 }, { x: node.width, y: height }, { x: 0, y: height }];
  } else if (isWidgetNode(node)) {
    const size = widgetNodeSize(node);
    const width = size.width * node.scale, height = size.height * node.scale;
    points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  } else {
    points = node.points;
    pad = node.strokeWidth / 2;
    if (node.type === "arrow") pad += Math.max(node.headLength, node.headWidth);
  }
  return aabb(points.map((point) => rotateAndTranslate(point, node)), pad);
}

export function getContentBounds(nodes: CanvasNode[], metrics: FontMetrics = fallbackFontMetrics): Bounds | null {
  if (!nodes.length) return null;
  const bounds = nodes.map((node) => getNodeBounds(node, metrics));
  const x = Math.min(...bounds.map((item) => item.x)), y = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: maxX - x, height: maxY - y };
}
