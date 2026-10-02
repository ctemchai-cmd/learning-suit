import { applyDocumentCommand, type DocumentTransaction } from "./commands";
import type { FontMetrics } from "./geometry";
import type { ArrowNode, CanvasNode, ConnectorAnchor, ConnectorBinding, LineNode, Point, ProjectContent, SlideDocument } from "./model";
import { getNodeFrame } from "./transform";

// Connectors (plan 03 §connectors): a line/arrow end can be attached to an object at one of its four sides.
// Whenever a change touches a slide, attached ends are moved to where their object is now — inside the same
// transaction, so Undo, saving and the drawing room treat it as one change.

export const CONNECTABLE = new Set<CanvasNode["type"]>(["rectangle", "ellipse", "text", "image", "stencil", "table", "code"]);
export const ANCHORS: Exclude<ConnectorAnchor, "auto">[] = ["n", "e", "s", "w"];
/** Gap between an object's side and an attached arrow tip. */
const GAP = 6;

const rotate = (point: Point, degrees: number): Point => {
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
};

/** World position of a side's midpoint (`gap` outside the side). */
export function anchorPoint(node: CanvasNode, anchor: Exclude<ConnectorAnchor, "auto">, metrics: FontMetrics, gap = 0): Point {
  const frame = getNodeFrame(node, metrics);
  const local = anchor === "n" ? { x: 0, y: -frame.height / 2 - gap } : anchor === "s" ? { x: 0, y: frame.height / 2 + gap }
    : anchor === "e" ? { x: frame.width / 2 + gap, y: 0 } : { x: -frame.width / 2 - gap, y: 0 };
  const offset = rotate(local, frame.rotation);
  return { x: frame.center.x + offset.x, y: frame.center.y + offset.y };
}

/** The side of `node` closest to a world point. */
export function nearestAnchor(node: CanvasNode, world: Point, metrics: FontMetrics): Exclude<ConnectorAnchor, "auto"> {
  let best: Exclude<ConnectorAnchor, "auto"> = "n", distance = Infinity;
  for (const anchor of ANCHORS) {
    const point = anchorPoint(node, anchor, metrics);
    const d = Math.hypot(point.x - world.x, point.y - world.y);
    if (d < distance) { distance = d; best = anchor; }
  }
  return best;
}

/** Topmost connectable object under a world point (`except` = the object the connector starts from). */
export function connectableAt(nodes: CanvasNode[], world: Point, metrics: FontMetrics, except?: string): CanvasNode | null {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (!CONNECTABLE.has(node.type) || node.id === except) continue;
    const frame = getNodeFrame(node, metrics);
    const local = rotate({ x: world.x - frame.center.x, y: world.y - frame.center.y }, -frame.rotation);
    const margin = 8;
    if (Math.abs(local.x) <= frame.width / 2 + margin && Math.abs(local.y) <= frame.height / 2 + margin) return node;
  }
  return null;
}

type Connector = LineNode | ArrowNode;
const isConnector = (node: CanvasNode): node is Connector => node.type === "line" || node.type === "arrow";

/** A connector with its attached ends placed on their objects (null = unchanged). Missing objects detach the end. */
function placeConnector(connector: Connector, byId: Map<string, CanvasNode>, metrics: FontMetrics): Connector | null {
  if (!connector.startBinding && !connector.endBinding) return null;
  const toWorld = (point: Point) => { const offset = rotate(point, connector.rotation); return { x: connector.x + offset.x, y: connector.y + offset.y }; };
  let start = toWorld(connector.points[0]), end = toWorld(connector.points[1]);
  let startBinding: ConnectorBinding | undefined = connector.startBinding, endBinding: ConnectorBinding | undefined = connector.endBinding;
  const startTarget = startBinding && byId.get(startBinding.nodeId), endTarget = endBinding && byId.get(endBinding.nodeId);
  if (startBinding && !startTarget) startBinding = undefined;
  if (endBinding && !endTarget) endBinding = undefined;
  // "auto": the side facing the other end (its object's centre when attached, else the free end).
  const centre = (node: CanvasNode) => getNodeFrame(node, metrics).center;
  const startRef = startTarget ? centre(startTarget) : start, endRef = endTarget ? centre(endTarget) : end;
  const side = (target: CanvasNode, anchor: ConnectorAnchor, towards: Point) => (anchor === "auto" ? nearestAnchor(target, towards, metrics) : anchor);
  if (startTarget && startBinding) start = anchorPoint(startTarget, side(startTarget, startBinding.anchor, endRef), metrics, GAP);
  if (endTarget && endBinding) end = anchorPoint(endTarget, side(endTarget, endBinding.anchor, startRef), metrics, GAP);
  const next: Connector = { ...connector, x: start.x, y: start.y, rotation: 0, points: [{ x: 0, y: 0 }, { x: end.x - start.x, y: end.y - start.y }] };
  if (startBinding) next.startBinding = startBinding; else delete next.startBinding;
  if (endBinding) next.endBinding = endBinding; else delete next.endBinding;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const key = (node: Connector) => JSON.stringify([round(node.x), round(node.y), node.rotation, node.points.map((point) => [round(point.x), round(point.y)]), node.startBinding, node.endBinding]);
  return key(next) === key(connector) ? null : next;
}

/** Connectors of a slide that must move because the objects they are attached to changed. */
export function connectorUpdates(slide: SlideDocument, metrics: FontMetrics): Connector[] {
  const byId = new Map(slide.nodes.map((node) => [node.id, node]));
  const updates: Connector[] = [];
  for (const node of slide.nodes) {
    if (!isConnector(node) || node.locked) continue;
    const placed = placeConnector(node, byId, metrics);
    if (placed) updates.push(placed);
  }
  return updates;
}

/**
 * The transaction plus the connector moves it causes (same transaction = one Undo step). Unchanged when it does
 * not apply or moves nothing. Deterministic, so the drawing room's copies stay identical.
 */
export function withConnectorUpdates(content: ProjectContent, transaction: DocumentTransaction, metrics: FontMetrics): DocumentTransaction {
  const result = applyDocumentCommand(content, transaction);
  if (!result.changed) return transaction;
  const before = new Map(content.document.slides.map((slide) => [slide.id, slide]));
  const extra: DocumentTransaction["commands"] = [];
  for (const slide of result.content.document.slides) {
    const previous = before.get(slide.id);
    if (previous && previous.nodes === slide.nodes) continue;
    if (!slide.nodes.some((node) => isConnector(node) && (node.startBinding || node.endBinding))) continue;
    const updates = connectorUpdates(slide, metrics);
    if (updates.length) extra.push({ type: "nodes.replace", slideId: slide.id, nodes: updates });
  }
  return extra.length ? { ...transaction, commands: [...transaction.commands, ...extra] } : transaction;
}
