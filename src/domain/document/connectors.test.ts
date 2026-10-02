import { describe, expect, it } from "vitest";
import { applyDocumentCommand, type DocumentTransaction } from "./commands";
import { anchorPoint, connectableAt, connectionPoint, connectionPoints, nearestAnchor, nearestConnectionPoint, sideOf, withConnectorUpdates, withLiveConnectors } from "./connectors";
import { connectorPath, elbowLayout } from "./connector-route";
import { getNodeBounds } from "./geometry";
import { remapBindings } from "./copy";
import { fallbackFontMetrics as metrics } from "./geometry";
import { createProjectContent, type ArrowNode, type CanvasNode, type ProjectContent, type RectNode } from "./model";
import { parseProjectContent } from "./schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rect = (n: number, x: number, y: number, overrides: Partial<RectNode> = {}): RectNode => ({
  id: uuid(n), type: "rectangle", x, y, rotation: 0, opacity: 1, locked: false,
  width: 100, height: 50, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});
const arrow = (overrides: Partial<ArrowNode> = {}): ArrowNode => ({
  id: uuid(9), type: "arrow", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid",
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], headLength: 12, headWidth: 10, ...overrides,
});
const withNodes = (nodes: CanvasNode[]): ProjectContent => {
  const content = createProjectContent("เชื่อม");
  content.document.slides[0].nodes = nodes;
  return content;
};
const commit = (content: ProjectContent, transaction: DocumentTransaction) => {
  const result = applyDocumentCommand(content, withConnectorUpdates(content, transaction, metrics));
  if (result.status === "invalid") throw new Error(result.message);
  return result.content;
};
const ends = (content: ProjectContent) => {
  const node = content.document.slides[0].nodes.find((item) => item.type === "arrow") as ArrowNode;
  return [{ x: node.x + node.points[0].x, y: node.y + node.points[0].y }, { x: node.x + node.points[1].x, y: node.y + node.points[1].y }];
};

describe("CON-01: connectors follow the objects they are attached to", () => {
  it("places anchors on the sides (outside by a gap) and finds the side nearest a point", () => {
    const box = rect(1, 0, 0);
    expect(anchorPoint(box, "e", metrics)).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(box, "n", metrics, 6)).toEqual({ x: 50, y: -6 });
    expect(nearestAnchor(box, { x: 52, y: 70 }, metrics)).toBe("s");
    const turned = rect(1, 0, 0, { rotation: 90 });
    const east = anchorPoint(turned, "e", metrics);
    // Rotated about its top-left corner: the right side ends up below the origin.
    expect(east.x).toBeCloseTo(-25); expect(east.y).toBeCloseTo(100);
    expect(connectableAt([box, rect(2, 300, 0)], { x: 320, y: 10 }, metrics)?.id).toBe(uuid(2));
    expect(connectableAt([box], { x: 320, y: 10 }, metrics)).toBeNull();
    expect(connectableAt([box], { x: 10, y: 10 }, metrics, uuid(1))).toBeNull();
  });

  it("moves both attached ends when either object moves, resizes or rotates, in the same transaction", () => {
    const a = rect(1, 0, 0), b = rect(2, 300, 0);
    const start = withNodes([a, b, arrow({ startBinding: { nodeId: uuid(1), anchor: "e" }, endBinding: { nodeId: uuid(2), anchor: "w" } })]);
    const placed = commit(start, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: start.document.slides[0].id, nodes: [{ ...a, x: 1 }] }] });
    expect(ends(placed)).toEqual([{ x: 107, y: 25 }, { x: 294, y: 25 }]);
    const moved = commit(placed, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: placed.document.slides[0].id, nodes: [{ ...b, y: 200, height: 100 }] }] });
    expect(ends(moved)[1]).toEqual({ x: 294, y: 250 });
    // Unrelated change elsewhere: nothing extra.
    const tx: DocumentTransaction = { label: "x", affectedSlideId: null, commands: [{ type: "slide.update", slideId: moved.document.slides[0].id, name: "ใหม่" }] };
    expect(withConnectorUpdates(moved, tx, metrics)).toBe(tx);
  });

  it("“auto” ends always use the sides facing each other", () => {
    const a = rect(1, 0, 0), b = rect(2, 300, 0);
    const start = withNodes([a, b, arrow({ startBinding: { nodeId: uuid(1), anchor: "auto" }, endBinding: { nodeId: uuid(2), anchor: "auto" } })]);
    const s = start.document.slides[0].id;
    const side = commit(start, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: s, nodes: [{ ...a, fill: "#FFFFFF" }] }] });
    expect(ends(side)).toEqual([{ x: 106, y: 25 }, { x: 294, y: 25 }]); // right side → left side
    const above = commit(side, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: s, nodes: [{ ...b, x: 0, y: -300 }] }] });
    expect(ends(above)).toEqual([{ x: 50, y: -6 }, { x: 50, y: -244 }]); // top side → bottom side
  });

  it("detaches an end whose object is deleted, keeping where it was", () => {
    const start = withNodes([rect(1, 0, 0), rect(2, 300, 0), arrow({ startBinding: { nodeId: uuid(1), anchor: "e" }, endBinding: { nodeId: uuid(2), anchor: "w" } })]);
    const s = start.document.slides[0].id;
    const placed = commit(start, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: s, nodes: [rect(1, 0, 0, { fill: "#FFFFFF" })] }] });
    const deleted = commit(placed, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.remove", slideId: s, ids: [uuid(2)] }] });
    const connector = deleted.document.slides[0].nodes.find((node) => node.type === "arrow") as ArrowNode;
    expect(connector.endBinding).toBeUndefined();
    expect(connector.startBinding?.nodeId).toBe(uuid(1));
    expect(ends(deleted)).toEqual(ends(placed));
  });

  it("keeps copies attached only to objects copied with them; validates bindings", () => {
    const copied = remapBindings([arrow({ startBinding: { nodeId: uuid(1), anchor: "e" }, endBinding: { nodeId: uuid(2), anchor: "w" } })], new Map([[uuid(1), uuid(11)]]));
    expect((copied[0] as ArrowNode).startBinding).toEqual({ nodeId: uuid(11), anchor: "e" });
    expect((copied[0] as ArrowNode).endBinding).toBeUndefined();
    expect(() => parseProjectContent(withNodes([arrow({ startBinding: { nodeId: uuid(1), anchor: "e" } })]))).not.toThrow();
    expect(() => parseProjectContent(withNodes([arrow({ startBinding: { nodeId: uuid(1), anchor: "x" as "e" } })]))).toThrow();
  });
});

describe("CON-02: connection points and elbow / curved routes", () => {
  it("offers corner and quarter points on boxes (12 round an ellipse) and attaches to the one near a point", () => {
    const box = rect(1, 0, 0);
    expect(connectionPoints(box)).toHaveLength(16);
    expect(connectionPoints({ ...box, type: "ellipse" } as CanvasNode)).toHaveLength(12);
    expect(connectionPoint(box, { x: 0.25, y: 1 }, metrics)).toEqual({ x: 25, y: 50 });
    expect(connectionPoint(box, { x: 1, y: 0 }, metrics, 6).x).toBeCloseTo(104.243, 2); // a corner pushes out diagonally
    expect(nearestConnectionPoint(box, { x: 27, y: 53 }, metrics, 10)).toEqual({ x: 0.25, y: 1 });
    expect(nearestConnectionPoint(box, { x: 50, y: 25 }, metrics, 10)).toBeNull();
    expect(sideOf(box, { x: 0.75, y: 0 }, metrics)).toBe("n");
  });

  it("keeps a fixed end on its connection point when the object moves, and records the side each end leaves from", () => {
    const a = rect(1, 0, 0), b = rect(2, 300, 0);
    const start = withNodes([a, b, arrow({ route: "elbow", startBinding: { nodeId: uuid(1), anchor: "fixed", at: { x: 1, y: 0.75 } }, endBinding: { nodeId: uuid(2), anchor: "auto" } })]);
    const s = start.document.slides[0].id;
    const moved = commit(start, { label: "x", affectedSlideId: null, commands: [{ type: "nodes.replace", slideId: s, nodes: [{ ...a, y: 10 }] }] });
    const connector = moved.document.slides[0].nodes.find((node) => node.type === "arrow") as ArrowNode;
    expect(ends(moved)[0]).toEqual({ x: 106, y: 47.5 });
    expect(connector.startBinding).toEqual({ nodeId: uuid(1), anchor: "fixed", at: { x: 1, y: 0.75 }, side: "e" });
    expect(connector.endBinding?.side).toBe("w");
    expect(() => parseProjectContent(moved)).not.toThrow();
    expect(() => parseProjectContent(withNodes([arrow({ startBinding: { nodeId: uuid(1), anchor: "fixed" } })]))).toThrow();
  });

  it("routes elbows at right angles (middle segment movable by `bend`), L shapes and curves", () => {
    const across = arrow({ route: "elbow", points: [{ x: 0, y: 0 }, { x: 200, y: 100 }], startBinding: { nodeId: uuid(1), anchor: "e", side: "e" }, endBinding: { nodeId: uuid(2), anchor: "w", side: "w" } });
    expect(connectorPath(across).points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(elbowLayout({ ...across, bend: 30 }).middle).toEqual({ from: { x: 130, y: 0 }, to: { x: 130, y: 100 }, axis: "x" });
    const corner = { ...across, endBinding: { nodeId: uuid(2), anchor: "n" as const, side: "n" as const } };
    expect(connectorPath(corner).points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }]);
    expect(elbowLayout(corner).middle).toBeNull();
    // Leaving away from the other end: out, across, back.
    const back = arrow({ route: "elbow", points: [{ x: 0, y: 0 }, { x: -200, y: 100 }], startBinding: { nodeId: uuid(1), anchor: "e", side: "e" }, endBinding: { nodeId: uuid(2), anchor: "e", side: "e" } });
    expect(connectorPath(back).points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 50 }, { x: -180, y: 50 }, { x: -180, y: 100 }, { x: -200, y: 100 }]);
    const curve = connectorPath({ ...across, route: "curved" });
    expect(curve.bezier).toBe(true);
    expect(curve.points).toHaveLength(4);
    expect(connectorPath(arrow()).points).toEqual(arrow().points);
    // The bounds follow the drawn path.
    expect(getNodeBounds({ ...back, x: 0, y: 0, headLength: 1, headWidth: 1, strokeWidth: 2 }, metrics).x).toBeCloseTo(-202);
  });

  it("moves attached arrows live while their object is dragged, leaving the dragged ones alone", () => {
    const a = rect(1, 0, 0), b = rect(2, 300, 0);
    const link = arrow({ startBinding: { nodeId: uuid(1), anchor: "e" }, endBinding: { nodeId: uuid(2), anchor: "w" } });
    const live = withLiveConnectors([{ ...a, y: 100 }, b, link], metrics, new Set([uuid(1)]));
    const shown = live.find((node) => node.type === "arrow") as ArrowNode;
    expect(shown.y).toBe(125);
    expect(withLiveConnectors([{ ...a, y: 100 }, b, link], metrics, new Set([uuid(9)])).find((node) => node.type === "arrow")).toBe(link);
  });
});
