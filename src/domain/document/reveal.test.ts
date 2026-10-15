import { describe, expect, it } from "vitest";
import { createInitialAiState } from "../ai/initial";
import { createInitialDataState } from "../data/initial";
import type { FlowFrame } from "../data/model";
import { createInitialDeployState } from "../deploy/initial";
import { createInitialGitState } from "../git/initial";
import { createInitialSshState } from "../ssh/initial";
import { createProjectContent, type CanvasNode, type ProjectContent, type WidgetNode } from "./model";
import {
  REVEAL_MAX, hasPartsLeft, nextPart, partFilter, partsOfFrames, revealAll, revealForParts, revealHide, revealNext, revealOnStepChange, revealToggle, revealTransaction, revealedCount, withReveal,
  type RevealPart,
} from "./reveal";
import { parseProjectContent } from "./schema";

const PARTS: RevealPart[] = [{ id: "a", label: "เอ" }, { id: "b", label: "บี" }, { id: "c", label: "ซี" }];
const base = { x: 0, y: 0, rotation: 0 as const, opacity: 1, locked: false, scale: 1 };
const widgets = (): WidgetNode[] => [
  { ...base, id: crypto.randomUUID(), type: "git-simulator", state: createInitialGitState() },
  { ...base, id: crypto.randomUUID(), type: "data-simulator", view: "where", state: createInitialDataState() },
  { ...base, id: crypto.randomUUID(), type: "deploy-simulator", view: "local", state: createInitialDeployState() },
  { ...base, id: crypto.randomUUID(), type: "ai-simulator", view: "history", state: createInitialAiState() },
  { ...base, id: crypto.randomUUID(), type: "ssh-simulator", view: "setup", state: createInitialSshState() },
];
const withNodes = (nodes: CanvasNode[]): ProjectContent => {
  const content = createProjectContent("ทดสอบ");
  content.document.slides[0].nodes = nodes;
  return content;
};

describe("reveal transitions", () => {
  it("toggle on starts at 0 parts, toggle off removes the mode", () => {
    expect(revealToggle(true)).toBe(0);
    expect(revealToggle(false)).toBeUndefined();
  });
  it("next adds one part up to the last, then stays; it does nothing while the mode is off", () => {
    expect(revealNext(PARTS, 0)).toBe(1);
    expect(revealNext(PARTS, 2)).toBe(3);
    expect(revealNext(PARTS, 3)).toBe(3);
    expect(revealNext(PARTS, undefined)).toBeUndefined();
  });
  it("all shows every part, hide goes back to 0, both leave the mode off alone", () => {
    expect(revealAll(PARTS, 1)).toBe(3);
    expect(revealHide(3)).toBe(0);
    expect(revealAll(PARTS, undefined)).toBeUndefined();
    expect(revealHide(undefined)).toBeUndefined();
  });
  it("a lesson step change resets to 0 only when the mode is on", () => {
    expect(revealOnStepChange(2)).toBe(0);
    expect(revealOnStepChange(undefined)).toBeUndefined();
  });
  it("an action reveals up to its last needed part, never hides, ignores unknown ids, and never turns the mode on", () => {
    expect(revealForParts(PARTS, 0, ["b"])).toBe(2);
    expect(revealForParts(PARTS, 0, ["c", "a"])).toBe(3);
    expect(revealForParts(PARTS, 3, ["a"])).toBe(3);
    expect(revealForParts(PARTS, 1, ["nope"])).toBe(1);
    expect(revealForParts(PARTS, undefined, ["c"])).toBeUndefined();
  });
  it("next part and counts follow the number", () => {
    expect(nextPart(PARTS, 0)?.id).toBe("a");
    expect(nextPart(PARTS, 2)?.id).toBe("c");
    expect(nextPart(PARTS, 3)).toBeNull();
    expect(nextPart(PARTS, undefined)).toBeNull();
    expect(hasPartsLeft(PARTS, 2)).toBe(true);
    expect(hasPartsLeft(PARTS, 3)).toBe(false);
    expect(revealedCount(PARTS, undefined)).toBe(3);
    expect(revealedCount(PARTS, 9)).toBe(3);
  });
  it("the filter hides parts beyond the count and shows everything when the mode is off", () => {
    const shows = partFilter(PARTS, 1);
    expect([shows("a"), shows("b"), shows("c"), shows("zzz")]).toEqual([true, false, false, false]);
    expect(partFilter(PARTS, 0)("a")).toBe(false);
    expect(partFilter(PARTS, undefined)("c")).toBe(true);
  });
  it("withReveal sets or drops the key, and the transaction replaces the widget (one undoable step)", () => {
    const [node] = widgets();
    expect(withReveal(node, 2).reveal).toBe(2);
    expect("reveal" in withReveal(withReveal(node, 2), undefined)).toBe(false);
    const tx = revealTransaction("slide", node, 1, "แสดงส่วนถัดไป");
    expect(tx.label).toBe("แสดงส่วนถัดไป");
    expect(tx.commands).toEqual([{ type: "nodes.replace", slideId: "slide", nodes: [{ ...node, reveal: 1 }] }]);
  });
  it("partsOfFrames collects the parts of hop ends, marks and what a hop passes (planted: an unmapped spot is dropped, not invented)", () => {
    const frames: FlowFrame<unknown>[] = [
      { hop: { from: "x", to: "y", label: "l", tone: "data" }, caption: "", state: null, marks: [{ spot: "z", tone: "new" }, { spot: "unknown", tone: "new" }] },
    ];
    const partOf = (spot: string) => ({ x: "p1", y: "p2", z: "p3" })[spot] ?? null;
    expect(partsOfFrames(frames, partOf).sort()).toEqual(["p1", "p2", "p3"]);
    expect(partsOfFrames(frames, partOf, () => ["gate"]).sort()).toEqual(["gate", "p1", "p2", "p3"]);
    expect(partsOfFrames(frames, () => null)).toEqual([]);
  });
});

describe("schema: reveal on every widget type", () => {
  it("there are five widget types and each accepts 0, a middle value and the maximum, and round trips", () => {
    const nodes = widgets();
    expect(nodes).toHaveLength(5);
    for (const node of nodes) {
      for (const reveal of [0, 3, REVEAL_MAX]) {
        const parsed = parseProjectContent(withNodes([{ ...node, reveal }]));
        expect(parsed.document.slides[0].nodes[0], node.type).toMatchObject({ reveal });
      }
    }
  });
  it("rejects negative, fractional, too large and non-number values on every widget type", () => {
    for (const node of widgets()) {
      for (const reveal of [-1, 1.5, REVEAL_MAX + 1, "2", null, Number.NaN]) {
        expect(() => parseProjectContent(withNodes([{ ...node, reveal } as unknown as CanvasNode])), `${node.type} ${String(reveal)}`).toThrow();
      }
    }
  });
  it("old documents without the key parse unchanged (the key stays absent)", () => {
    for (const node of widgets()) {
      const content = withNodes([node]);
      const parsed = parseProjectContent(content);
      expect("reveal" in parsed.document.slides[0].nodes[0]).toBe(false);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(JSON.parse(JSON.stringify(content)));
    }
  });
});
