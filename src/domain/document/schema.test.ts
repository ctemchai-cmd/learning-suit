import { describe, expect, it } from "vitest";
import documentFixture from "../../../tests/fixtures/document-v1.json";
import gitFixture from "../../../tests/fixtures/git-initial-v1.json";
import { createInitialGitState } from "../git/initial";
import { applyGitAction } from "../git/reducer";
import { commitTransaction, createHistory, undo, redo } from "./history";
import { LIMITS } from "./limits";
import { createProjectContent, createSlide, type CanvasNode, type GitSimulatorNode, type ProjectContent, type RectNode } from "./model";
import { migrateProjectContent, parseProjectContent } from "./schema";

const clone = <T,>(value: T): T => structuredClone(value);
const rect = (overrides: Partial<RectNode> = {}): RectNode => ({
  id: crypto.randomUUID(), type: "rectangle", x: 0, y: 0, rotation: 0, opacity: 1, locked: false,
  width: 10, height: 10, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});
const withNodes = (nodes: CanvasNode[]): ProjectContent => {
  const content = createProjectContent("ทดสอบ");
  content.document.slides[0].nodes = nodes;
  return content;
};
const gitNode = (state = createInitialGitState()): GitSimulatorNode => ({
  id: crypto.randomUUID(), type: "git-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, state,
});

describe("DOM-01: versioned fixtures", () => {
  it("accepts the plan02 §7 fixture exactly as written and round trips it", () => {
    const parsed = parseProjectContent(documentFixture);
    expect(parsed).toEqual(documentFixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(documentFixture);
    expect(migrateProjectContent(clone(documentFixture))).toEqual(documentFixture);
  });
  it("accepts the plan04 initial Git fixture and it equals createInitialGitState()", () => {
    expect(createInitialGitState()).toEqual(gitFixture);
    expect(() => parseProjectContent(withNodes([gitNode(clone(gitFixture) as GitSimulatorNode["state"])]))).not.toThrow();
  });
  it("rejects unknown schema versions and node types instead of stripping them", () => {
    expect(() => parseProjectContent({ ...documentFixture, document: { ...documentFixture.document, schemaVersion: 2 } })).toThrow();
    const unknownType = clone(documentFixture);
    (unknownType.document.slides[0].nodes[0] as { type: string }).type = "star";
    expect(() => parseProjectContent(unknownType)).toThrow();
    const extraField = clone(documentFixture) as unknown as { document: { slides: { nodes: Record<string, unknown>[] }[] } };
    extraField.document.slides[0].nodes[0].futureField = true;
    expect(() => parseProjectContent(extraField)).toThrow();
  });
});

describe("DOM-02: invalid documents are rejected before mutation", () => {
  it("rejects non-finite or out-of-range geometry and bad styles", () => {
    for (const bad of [
      rect({ x: Number.NaN }), rect({ y: Infinity }), rect({ x: LIMITS.coordinate + 1 }), rect({ width: 0.5 }),
      rect({ strokeWidth: 0.4 }), rect({ strokeWidth: 65 }), rect({ opacity: 0.01 }), rect({ stroke: "#ff0000" }), rect({ fill: "red" }),
    ]) expect(() => parseProjectContent(withNodes([bad])), JSON.stringify(bad)).toThrow();
    expect(() => parseProjectContent(withNodes([rect({ x: -LIMITS.coordinate, width: 1, strokeWidth: 0.5, opacity: 0.05 })]))).not.toThrow();
  });
  it("enforces duplicate IDs across slides, missing assets and asset key mismatches", () => {
    const shared = rect();
    const content = withNodes([shared]);
    const second = createSlide("สไลด์ 2");
    second.nodes = [{ ...shared }];
    content.document.slides.push(second);
    expect(() => parseProjectContent(content)).toThrow(/Duplicate node ID/);
    const duplicateSlide = withNodes([]);
    duplicateSlide.document.slides.push({ ...duplicateSlide.document.slides[0] });
    expect(() => parseProjectContent(duplicateSlide)).toThrow(/Duplicate slide ID/);
    const assetId = crypto.randomUUID();
    const image = withNodes([{ id: crypto.randomUUID(), type: "image", assetId, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, locked: false }]);
    expect(() => parseProjectContent(image)).toThrow(/Missing asset/);
    image.document.assets[crypto.randomUUID()] = { id: assetId, mimeType: "image/png", width: 1, height: 1, byteLength: 1, sha256: "a".repeat(64), storagePath: "x" };
    expect(() => parseProjectContent(image)).toThrow();
  });
  it("enforces names, text length and project limits", () => {
    expect(() => parseProjectContent(createProjectContent("ก".repeat(120)))).not.toThrow();
    expect(() => parseProjectContent(createProjectContent("ก".repeat(121)))).toThrow();
    expect(() => parseProjectContent(createProjectContent(" มีช่องว่าง "))).toThrow();
    expect(() => parseProjectContent(createProjectContent(""))).toThrow();
    const text = (value: string): CanvasNode => ({ id: crypto.randomUUID(), type: "text", text: value, x: 0, y: 0, rotation: 0, opacity: 1, locked: false, width: 320, fontFamily: "Noto Sans Thai", fontSize: 28, lineHeight: 1.4, color: "#1F2937", align: "left" });
    expect(() => parseProjectContent(withNodes([text("😀".repeat(LIMITS.textCodePoints))]))).not.toThrow();
    expect(() => parseProjectContent(withNodes([text("a".repeat(LIMITS.textCodePoints + 1))]))).toThrow();
    const many = createProjectContent("สไลด์เยอะ");
    many.document.slides = Array.from({ length: LIMITS.slides + 1 }, (_, index) => createSlide(`สไลด์ ${index + 1}`));
    expect(() => parseProjectContent(many)).toThrow();
    many.document.slides.pop();
    expect(() => parseProjectContent(many)).not.toThrow();
    expect(() => parseProjectContent(withNodes(Array.from({ length: LIMITS.nodes + 1 }, () => rect())))).toThrow(/Node limit/);
    const points = Array.from({ length: LIMITS.points + 1 }, (_, index) => ({ x: index % 100, y: 0 }));
    const pen: CanvasNode = { id: crypto.randomUUID(), type: "pen", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, stroke: "#1F2937", strokeWidth: 3, strokeStyle: "solid", points };
    expect(() => parseProjectContent(withNodes([pen]))).toThrow(/Point limit/);
  }, 30_000); // builds 10,001 nodes and 1,000,001 points: slow but bounded
  it("rejects malformed Git graphs (unknown heads, lexical order, missing ancestors, counters)", () => {
    const start = createInitialGitState();
    const committed = [{ type: "edit", machine: "A", file: { name: "index.html", content: "1" } }, { type: "stage", machine: "A" }, { type: "commit", machine: "A", message: "one" }] as const;
    let state = start;
    for (const action of committed) state = applyGitAction(state, action).nextState;
    expect(() => parseProjectContent(withNodes([gitNode(state)]))).not.toThrow();
    const unknownHead = clone(state); unknownHead.remote.mainHead = "C1";
    expect(() => parseProjectContent(withNodes([gitNode(unknownHead)]))).toThrow();
    const counter = clone(state); counter.nextCommitNumber = 1;
    expect(() => parseProjectContent(withNodes([gitNode(counter)]))).toThrow();
    const uninitializedWithData = clone(state); uninitializedWithData.machines.B.knownCommitIds = ["C1"];
    expect(() => parseProjectContent(withNodes([gitNode(uninitializedWithData)]))).toThrow();
    const badName = clone(state); badName.machines.A.working = { name: "a/b.html", content: "" };
    expect(() => parseProjectContent(withNodes([gitNode(badName)]))).toThrow();
    const c1Control = clone(state); c1Control.machines.A.working = { name: "a\u0085b", content: "" };
    expect(() => parseProjectContent(withNodes([gitNode(c1Control)]))).toThrow();
  });
});

describe("DOM-03: serialization keeps Drawing info only", () => {
  it("preserves order, lock and Git state and never stores camera/session/token fields", () => {
    let state = createInitialGitState();
    for (const action of [{ type: "edit", machine: "A", file: { name: "index.html", content: "x" } }, { type: "stage", machine: "A" }, { type: "commit", machine: "A", message: "m" }, { type: "push", machine: "A" }] as const) {
      state = applyGitAction(state, action).nextState;
    }
    const content = withNodes([rect({ locked: true }), gitNode(state), rect({ rotation: 45 })]);
    const restored = parseProjectContent(JSON.parse(JSON.stringify(content)));
    expect(restored).toEqual(content);
    expect(restored.document.slides[0].nodes.map((node) => node.id)).toEqual(content.document.slides[0].nodes.map((node) => node.id));
    const text = JSON.stringify(content);
    for (const forbidden of ["camera", "selectedNodeIds", "token", "signedUrl", "session", "scaleX"]) expect(text).not.toContain(forbidden);
  });
});

describe("DOM-05/06: history across slides", () => {
  it("undo of a slide deletion restores the slide and reports it as the affected slide", () => {
    const content = createProjectContent("ประวัติ");
    const second = createSlide("สไลด์ 2");
    let history = commitTransaction(createHistory(content), { label: "add", affectedSlideId: second.id, commands: [{ type: "slide.insert", slide: second, at: 1 }] }).history;
    history = commitTransaction(history, { label: "remove", affectedSlideId: second.id, commands: [{ type: "slide.remove", slideId: second.id }] }).history;
    expect(history.content.document.slides).toHaveLength(1);
    const undone = undo(history);
    expect(undone.affectedSlideId).toBe(second.id);
    expect(undone.history.content.document.slides.map((slide) => slide.id)).toContain(second.id);
    const redone = redo(undone.history);
    expect(redone.history.content.document.slides).toHaveLength(1);
  });
  it("undo/redo of a lock restores exactly the previous lock state even though replace cannot change locks", () => {
    const node = rect();
    const content = withNodes([node]);
    const slideId = content.document.slides[0].id;
    let history = commitTransaction(createHistory(content), { label: "lock", affectedSlideId: slideId, commands: [{ type: "nodes.lock", slideId, ids: [node.id], locked: true }] }).history;
    const replaceLocked = commitTransaction(history, { label: "move", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [{ ...node, x: 50, locked: true }] }] });
    expect(replaceLocked.result.status).toBe("invalid");
    history = undo(history).history;
    expect(history.content.document.slides[0].nodes[0].locked).toBe(false);
    history = redo(history).history;
    expect(history.content.document.slides[0].nodes[0].locked).toBe(true);
  });
});
