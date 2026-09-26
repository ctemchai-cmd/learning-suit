import { describe, expect, it } from "vitest";
import { reorderNodeIds } from "./z-order";
import type { CanvasNode } from "./model";

const nodes = ["A", "B", "C", "D", "E"].map((id) => ({ id })) as CanvasNode[];

describe("z-order", () => {
  it("moves a multi-selection one unselected neighbor while preserving its internal order", () => {
    expect(reorderNodeIds(nodes, ["B", "D"], "forward")).toEqual(["A", "C", "B", "E", "D"]);
    expect(reorderNodeIds(nodes, ["B", "D"], "backward")).toEqual(["B", "A", "D", "C", "E"]);
  });
  it("sends a selection to either end without changing its own stacking order", () => {
    expect(reorderNodeIds(nodes, ["B", "D"], "front")).toEqual(["A", "C", "E", "B", "D"]);
    expect(reorderNodeIds(nodes, ["B", "D"], "back")).toEqual(["B", "D", "A", "C", "E"]);
  });
  it("does not change the order when the requested edge is already reached", () => {
    expect(reorderNodeIds(nodes, ["E"], "forward")).toEqual(["A", "B", "C", "D", "E"]);
    expect(reorderNodeIds(nodes, ["A", "B"], "back")).toEqual(["A", "B", "C", "D", "E"]);
  });
});
