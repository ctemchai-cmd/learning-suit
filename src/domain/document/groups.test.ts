import { describe, expect, it } from "vitest";
import { createProjectContent, type CanvasNode, type RectNode } from "./model";
import { cloneNodes, duplicateSlide } from "./model";
import { expandToGroups, groupNodes, isGrouped, ungroupNodes, withFreshGroups } from "./groups";
import { parseProjectContent } from "./schema";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rect = (n: number, overrides: Partial<RectNode> = {}): RectNode => ({
  id: uuid(n), type: "rectangle", x: n * 10, y: 0, rotation: 0, opacity: 1, locked: false,
  width: 10, height: 10, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});
const G = uuid(900), H = uuid(901);

describe("GRP-01: groups", () => {
  it("widens a selection to whole groups, skipping locked members", () => {
    const nodes: CanvasNode[] = [rect(1, { groupId: G }), rect(2, { groupId: G }), rect(3, { groupId: G, locked: true }), rect(4)];
    expect(expandToGroups(nodes, [uuid(1)])).toEqual([uuid(1), uuid(2)]);
    expect(expandToGroups(nodes, [uuid(4)])).toEqual([uuid(4)]);
    expect(isGrouped(nodes, [uuid(4)])).toBe(false);
  });

  it("groups two or more unlocked objects and ungroups every group touched", () => {
    const nodes: CanvasNode[] = [rect(1), rect(2), rect(3, { locked: true }), rect(4, { groupId: H }), rect(5, { groupId: H })];
    expect(groupNodes(nodes, [uuid(1)], G)).toBeNull();
    expect(groupNodes(nodes, [uuid(1), uuid(2), uuid(3)], G)!.map((node) => [node.id, node.groupId])).toEqual([[uuid(1), G], [uuid(2), G]]);
    const ungrouped = ungroupNodes(nodes, [uuid(4)])!;
    expect(ungrouped.map((node) => node.id)).toEqual([uuid(4), uuid(5)]);
    expect(ungrouped.every((node) => !("groupId" in node))).toBe(true);
    expect(ungroupNodes(nodes, [uuid(1)])).toBeNull();
  });

  it("gives copies their own group, and a lone copied member none", () => {
    let next = 0;
    const fresh = () => uuid(800 + ++next);
    const copies = withFreshGroups([rect(1, { groupId: G }), rect(2, { groupId: G }), rect(3, { groupId: H }), rect(4)], fresh);
    expect(copies.map((node) => node.groupId)).toEqual([uuid(801), uuid(801), undefined, undefined]);
    expect(cloneNodes([rect(1, { groupId: G }), rect(2, { groupId: G })], 5, 5).every((node) => node.groupId && node.groupId !== G)).toBe(true);
    const slide = { id: uuid(700), name: "ก", background: "#FFFFFF", nodes: [rect(1, { groupId: G }), rect(2, { groupId: G })] };
    const copy = duplicateSlide(slide);
    expect(new Set(copy.nodes.map((node) => node.groupId)).size).toBe(1);
    expect(copy.nodes[0].groupId).not.toBe(G);
  });

  it("accepts a group ID in documents and rejects a malformed one", () => {
    const content = createProjectContent("กลุ่ม");
    content.document.slides[0].nodes = [rect(1, { groupId: G }), rect(2)];
    expect(() => parseProjectContent(content)).not.toThrow();
    content.document.slides[0].nodes = [rect(1, { groupId: "g1" })];
    expect(() => parseProjectContent(content)).toThrow();
  });
});
