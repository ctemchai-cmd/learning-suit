import { describe, expect, it } from "vitest";
import { applyDocumentCommand, type DocumentTransaction } from "../document/commands";
import { createProjectContent, createSlide, type CanvasNode, type ProjectContent, type RectNode } from "../document/model";
import { inverseTransaction } from "./selective-undo";
import { GuestReplica, guestPermission } from "./protocol";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rect = (n: number, overrides: Partial<RectNode> = {}): RectNode => ({
  id: uuid(n), type: "rectangle", x: n * 10, y: 0, rotation: 0, opacity: 1, locked: false,
  width: 10, height: 10, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});
const base = (nodes: CanvasNode[] = []): ProjectContent => {
  const content = createProjectContent("ห้อง");
  content.document.slides[0].nodes = nodes;
  return content;
};
const slideId = (content: ProjectContent) => content.document.slides[0].id;
const apply = (content: ProjectContent, transaction: DocumentTransaction) => {
  const result = applyDocumentCommand(content, transaction);
  if (result.status === "invalid") throw new Error(result.message);
  return result.content;
};
const tx = (commands: DocumentTransaction["commands"]): DocumentTransaction => ({ label: "x", affectedSlideId: null, commands });
const nodes = (content: ProjectContent) => content.document.slides[0].nodes;

describe("LIVE-01: per-person Undo", () => {
  it("reverts only the fields I changed, keeping someone else's later change of the same object", () => {
    const start = base([rect(1)]);
    const s = slideId(start);
    const mine = apply(start, tx([{ type: "nodes.replace", slideId: s, nodes: [rect(1, { stroke: "#DC2626" })] }]));
    const theirs = apply(mine, tx([{ type: "nodes.replace", slideId: s, nodes: [rect(1, { stroke: "#DC2626", x: 500 })] }]));
    const undo = inverseTransaction(start, mine, theirs, "undo", s)!;
    expect(nodes(apply(theirs, undo))[0]).toMatchObject({ stroke: "#1F2937", x: 500 });
  });

  it("removes what I added, brings back what I removed, and leaves others' new objects alone", () => {
    const start = base([rect(1), rect(2)]);
    const s = slideId(start);
    const added = apply(start, tx([{ type: "nodes.insert", slideId: s, nodes: [rect(3)] }]));
    const others = apply(added, tx([{ type: "nodes.insert", slideId: s, nodes: [rect(4)] }]));
    expect(nodes(apply(others, inverseTransaction(start, added, others, "undo", s)!)).map((node) => node.id)).toEqual([uuid(1), uuid(2), uuid(4)]);

    const removed = apply(start, tx([{ type: "nodes.remove", slideId: s, ids: [uuid(1)] }]));
    expect(nodes(apply(removed, inverseTransaction(start, removed, removed, "undo", s)!)).map((node) => node.id).sort()).toEqual([uuid(1), uuid(2)]);
  });

  it("does nothing when the change is already gone, and handles locks and order", () => {
    const start = base([rect(1), rect(2)]);
    const s = slideId(start);
    const added = apply(start, tx([{ type: "nodes.insert", slideId: s, nodes: [rect(3)] }]));
    const goneAgain = apply(added, tx([{ type: "nodes.remove", slideId: s, ids: [uuid(3)] }]));
    expect(inverseTransaction(start, added, goneAgain, "undo", s)).toBeNull();

    const locked = apply(start, tx([{ type: "nodes.lock", slideId: s, ids: [uuid(1)], locked: true }]));
    expect(nodes(apply(locked, inverseTransaction(start, locked, locked, "undo", s)!))[0].locked).toBe(false);

    const front = apply(start, tx([{ type: "nodes.reorder", slideId: s, orderedIds: [uuid(2), uuid(1)] }]));
    const plus = apply(front, tx([{ type: "nodes.insert", slideId: s, nodes: [rect(5)] }]));
    expect(nodes(apply(plus, inverseTransaction(start, front, plus, "undo", s)!)).map((node) => node.id)).toEqual([uuid(1), uuid(2), uuid(5)]);
  });

  it("undoes slide changes and redo is the inverse of the undo", () => {
    const start = base([rect(1)]);
    const extra = createSlide("สไลด์ 2");
    const added = apply(start, tx([{ type: "slide.insert", slide: extra, at: 1 }, { type: "slide.update", slideId: slideId(start), background: "#000000" }]));
    const undone = apply(added, inverseTransaction(start, added, added, "undo", null)!);
    expect(undone.document.slides.map((slide) => slide.id)).toEqual([slideId(start)]);
    expect(undone.document.slides[0].background).toBe(start.document.slides[0].background);
    const redone = apply(undone, inverseTransaction(added, undone, undone, "redo", null)!);
    expect(redone.document.slides.map((slide) => slide.id)).toEqual([slideId(start), extra.id]);
    expect(redone.document.slides[0].background).toBe("#000000");
  });
});

describe("LIVE-02: what students may change", () => {
  it("allows drawing and editing objects, not slides, locks, title or images", () => {
    const s = uuid(99);
    expect(guestPermission(tx([{ type: "nodes.insert", slideId: s, nodes: [rect(1)] }]))).toBeNull();
    expect(guestPermission(tx([{ type: "nodes.replace", slideId: s, nodes: [rect(1)] }, { type: "nodes.remove", slideId: s, ids: [uuid(2)] }]))).toBeNull();
    expect(guestPermission(tx([{ type: "nodes.lock", slideId: s, ids: [uuid(1)], locked: false }]))).toMatch(/ครู/);
    expect(guestPermission(tx([{ type: "slide.remove", slideId: s }]))).toMatch(/สไลด์/);
    expect(guestPermission(tx([{ type: "project.rename", title: "x" }]))).toMatch(/ชื่อ/);
    expect(guestPermission(tx([{ type: "nodes.insert", slideId: s, nodes: [rect(1, { locked: true })] }]))).toMatch(/ล็อก/);
    expect(guestPermission(tx([]))).not.toBeNull();
  });
});

describe("LIVE-03: a student's copy lines up with the teacher's order", () => {
  it("shows my change at once, keeps it on top of others' changes, and drops it when refused", () => {
    const start = base([rect(1)]);
    const s = slideId(start);
    const replica = new GuestReplica(start, 0);
    replica.local("a", tx([{ type: "nodes.insert", slideId: s, nodes: [rect(2)] }]));
    expect(nodes(replica.content).map((node) => node.id)).toEqual([uuid(1), uuid(2)]);
    // Someone else's change is numbered first: mine stays on top.
    expect(replica.applied(1, "z", tx([{ type: "nodes.insert", slideId: s, nodes: [rect(3)] }]))).toBe("ok");
    expect(nodes(replica.content).map((node) => node.id)).toEqual([uuid(1), uuid(3), uuid(2)]);
    // Mine confirmed: the same document as everyone else's.
    expect(replica.applied(2, "a", tx([{ type: "nodes.insert", slideId: s, nodes: [rect(2)] }]))).toBe("ok");
    expect(replica.pending).toEqual([]);
    expect(nodes(replica.content).map((node) => node.id)).toEqual([uuid(1), uuid(3), uuid(2)]);

    replica.local("b", tx([{ type: "nodes.remove", slideId: s, ids: [uuid(1)] }]));
    replica.rejected("b");
    expect(nodes(replica.content).map((node) => node.id)).toEqual([uuid(1), uuid(3), uuid(2)]);
    // A pending change that no longer applies (its object was deleted) is dropped.
    replica.local("c", tx([{ type: "nodes.replace", slideId: s, nodes: [rect(3, { x: 99 })] }]));
    replica.applied(3, "y", tx([{ type: "nodes.remove", slideId: s, ids: [uuid(3)] }]));
    expect(replica.pending).toEqual([]);
    expect(replica.applied(5, "q", tx([{ type: "nodes.remove", slideId: s, ids: [uuid(2)] }]))).toBe("gap");
    expect(replica.applied(2, "q", tx([]))).toBe("old");
  });
});
