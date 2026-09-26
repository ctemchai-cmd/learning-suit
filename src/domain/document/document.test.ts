import { describe, expect, it } from "vitest";
import { createProjectContent, duplicateSlide, type RectNode } from "./model";
import { parseProjectContent } from "./schema";
import { applyDocumentCommand } from "./commands";
import { commitTransaction, createHistory, redo, undo } from "./history";
import { fitBounds, screenToWorld, worldToScreen, zoomAt } from "./camera";
import { getContentBounds } from "./geometry";

const rectangle = (locked = false): RectNode => ({
  id: crypto.randomUUID(), type: "rectangle", x: -30, y: 20, rotation: 0,
  opacity: 1, locked, width: 100, height: 70, stroke: "#1F2937",
  strokeWidth: 2, strokeStyle: "solid", fill: "transparent",
});

describe("document boundary", () => {
  it("round trips drawing info without renderer/session state", () => {
    const content = createProjectContent("บทเรียน Git");
    content.document.slides[0].nodes.push(rectangle());
    expect(parseProjectContent(JSON.parse(JSON.stringify(content)))).toEqual(content);
    expect(JSON.stringify(content)).not.toContain("camera");
  });
  it("rejects unknown versions, node types, duplicate IDs and missing assets", () => {
    const content = createProjectContent();
    expect(() => parseProjectContent({ ...content, document: { ...content.document, schemaVersion: 2 } })).toThrow();
    const node = rectangle();
    content.document.slides[0].nodes = [node, { ...node }];
    expect(() => parseProjectContent(content)).toThrow();
    content.document.slides[0].nodes = [{ ...node, type: "shape-v2" } as unknown as RectNode];
    expect(() => parseProjectContent(content)).toThrow();
    content.document.slides[0].nodes = [{ ...node, type: "image", assetId: crypto.randomUUID() } as unknown as RectNode];
    expect(() => parseProjectContent(content)).toThrow();
  });
  it("rejects malformed Git ancestry before document mutation", () => {
    const content = createProjectContent();
    content.document.slides[0].nodes.push({
      id: crypto.randomUUID(), type: "git-simulator", x: 0, y: 0, rotation: 0,
      opacity: 1, locked: false, scale: 1,
      state: {
        version: 1, nextCommitNumber: 2,
        commits: { C1: { id: "C1", parentId: "C9", message: "first", snapshot: { name: "index.html", content: "x" } } },
        machines: {
          A: { initialized: true, working: { name: "index.html", content: "x" }, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
          B: { initialized: false, working: null, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
        }, remote: { mainHead: null, knownCommitIds: [] },
      },
    });
    expect(() => parseProjectContent(content)).toThrow();
  });
  it("checks the second parent of a merge commit", () => {
    const file = { name: "index.html", content: "x" };
    const withCommits = (commits: Record<string, unknown>, known: string[]) => {
      const content = createProjectContent();
      content.document.slides[0].nodes.push({
        id: crypto.randomUUID(), type: "git-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1,
        state: {
          version: 1, nextCommitNumber: 4, commits: commits as never,
          machines: {
            A: { initialized: true, working: file, index: file, mainHead: known.at(-1)!, originMainHead: null, knownCommitIds: known },
            B: { initialized: false, working: null, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
          }, remote: { mainHead: null, knownCommitIds: [] },
        },
      });
      return content;
    };
    const C1 = { id: "C1", parentId: null, message: "a", snapshot: file };
    const C2 = { id: "C2", parentId: "C1", message: "b", snapshot: file };
    const merge = (mergeParentId: string) => ({ id: "C3", parentId: "C1", mergeParentId, message: "m", snapshot: file });
    expect(() => parseProjectContent(withCommits({ C1, C2, C3: merge("C2") }, ["C1", "C2", "C3"]))).not.toThrow();
    // The merged-in side must be known too, exist, be older, and differ from the first parent.
    expect(() => parseProjectContent(withCommits({ C1, C2, C3: merge("C2") }, ["C1", "C3"]))).toThrow();
    expect(() => parseProjectContent(withCommits({ C1, C2, C3: merge("C9") }, ["C1", "C2", "C3"]))).toThrow();
    expect(() => parseProjectContent(withCommits({ C1, C2, C3: merge("C1") }, ["C1", "C2", "C3"]))).toThrow();
  });
  it("rolls back the entire transaction if a later command is invalid", () => {
    const content = createProjectContent();
    const node = rectangle(true);
    content.document.slides[0].nodes.push(node);
    const slideId = content.document.slides[0].id;
    const result = applyDocumentCommand(content, {
      label: "atomic", affectedSlideId: slideId,
      commands: [
        { type: "project.rename", title: "New title" },
        { type: "nodes.remove", slideId, ids: [node.id] },
      ],
    });
    expect(result.status).toBe("invalid");
    expect(result.content).toBe(content);
    expect(content.title).toBe("บทเรียนใหม่");
  });
  it("keeps 100 history entries and drops redo after a new edit", () => {
    let history = createHistory(createProjectContent());
    for (let index = 0; index < 101; index++) {
      history = commitTransaction(history, { label: "rename", affectedSlideId: null, commands: [{ type: "project.rename", title: `title-${index}` }] }).history;
    }
    expect(history.past).toHaveLength(100);
    history = undo(history).history;
    expect(history.content.title).toBe("title-99");
    history = redo(history).history;
    expect(history.content.title).toBe("title-100");
    history = undo(history).history;
    history = commitTransaction(history, { label: "new", affectedSlideId: null, commands: [{ type: "project.rename", title: "another" }] }).history;
    expect(history.future).toHaveLength(0);
    const noop = commitTransaction(history, { label: "same", affectedSlideId: null, commands: [{ type: "project.rename", title: "another" }] });
    expect(noop.result.status).toBe("noop");
    expect(noop.history).toBe(history);
  });
  it("duplicates slide nodes with distinct IDs and independent values", () => {
    const slide = createProjectContent().document.slides[0];
    slide.nodes.push(rectangle());
    const copy = duplicateSlide(slide);
    expect(copy.id).not.toBe(slide.id);
    expect(copy.nodes[0].id).not.toBe(slide.nodes[0].id);
    (copy.nodes[0] as RectNode).width = 500;
    expect((slide.nodes[0] as RectNode).width).toBe(100);
  });
});

describe("camera and bounds", () => {
  it("round trips screen/world and preserves pointer position when zooming", () => {
    const camera = { x: 120, y: -60, zoom: 2 };
    const world = { x: -35, y: 48 };
    expect(screenToWorld(worldToScreen(world, camera), camera)).toEqual(world);
    const pointer = { x: 391, y: 127 };
    const before = screenToWorld(pointer, camera);
    expect(screenToWorld(pointer, zoomAt(camera, pointer, 4))).toEqual(before);
  });
  it("fits negative and locked content while handling empty slides", () => {
    const bounds = getContentBounds([rectangle(true)]);
    expect(bounds?.x).toBeLessThan(-30);
    const camera = fitBounds(bounds, { width: 800, height: 600 });
    expect(camera.zoom).toBeGreaterThan(0);
    expect(fitBounds(null, { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 });
  });
});
