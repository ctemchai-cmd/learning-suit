import { describe, expect, it } from "vitest";
import type { GitSimulationState } from "../git/model";
import { storagePathFor } from "./assets";
import { duplicateSlide, type CanvasNode, type ProjectContent } from "./model";
import { duplicateProjectContent, duplicateTitle, remapProjectContent } from "./remap";
import { parseProjectContent } from "./schema";

const OWNER = "a0000000-0000-4000-8000-000000000001";
const OLD_PROJECT = "b0000000-0000-4000-8000-000000000001";
const TARGET = { ownerId: "a0000000-0000-4000-8000-0000000000ff", projectId: "b0000000-0000-4000-8000-0000000000ff" };
const ASSET = "c0000000-0000-4000-8000-000000000001";
const UNUSED_ASSET = "c0000000-0000-4000-8000-000000000002";

function gitState(): GitSimulationState {
  const v1 = { name: "README.md", content: "สวัสดี Git\n" };
  const v2 = { name: "README.md", content: "สวัสดี Git\nบทที่ 2\n" };
  return {
    version: 1,
    commits: {
      C1: { id: "C1", parentId: null, message: "เริ่มต้นโปรเจกต์", snapshot: v1 },
      C2: { id: "C2", parentId: "C1", message: "เพิ่มบทที่ 2", snapshot: v2 },
    },
    machines: {
      A: { initialized: true, working: { ...v2 }, index: { ...v2 }, mainHead: "C2", originMainHead: "C1", knownCommitIds: ["C1", "C2"] },
      B: { initialized: true, working: { ...v1 }, index: { ...v1 }, mainHead: "C1", originMainHead: "C1", knownCommitIds: ["C1"] },
    },
    remote: { mainHead: "C1", knownCommitIds: ["C1"] },
    nextCommitNumber: 3,
  };
}

const base = { rotation: 0 as const, opacity: 1, locked: false };

function fixture(): ProjectContent {
  return {
    title: "Git เบื้องต้น",
    document: {
      schemaVersion: 1,
      slides: [
        {
          id: "10000000-0000-4000-8000-000000000001", name: "Commit อยู่ในเครื่อง", background: "#FFFFFF",
          nodes: [
            { ...base, id: "20000000-0000-4000-8000-000000000001", type: "rectangle", x: 120, y: 80, width: 300, height: 160, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent" },
            { ...base, id: "20000000-0000-4000-8000-000000000002", type: "image", x: 10, y: 20, width: 64, height: 32, assetId: ASSET, locked: true },
            { ...base, id: "20000000-0000-4000-8000-000000000003", type: "git-simulator", x: 0, y: 400, scale: 1, state: gitState() },
          ],
        },
        {
          id: "10000000-0000-4000-8000-000000000002", name: "สไลด์ที่สอง", background: "#FACC15",
          nodes: [
            { ...base, id: "20000000-0000-4000-8000-000000000004", type: "pen", x: 5, y: 5, points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], stroke: "#1F2937", strokeWidth: 3, strokeStyle: "solid" },
            { ...base, id: "20000000-0000-4000-8000-000000000005", type: "image", x: 100, y: 20, width: 64, height: 32, assetId: ASSET },
            { ...base, id: "20000000-0000-4000-8000-000000000006", type: "text", x: 0, y: 0, text: "ข้อความภาษาไทย", width: 320, fontFamily: "Noto Sans Thai", fontSize: 28, lineHeight: 1.4, color: "#1F2937", align: "left" },
          ],
        },
      ],
      assets: {
        [ASSET]: { id: ASSET, mimeType: "image/png", width: 64, height: 32, byteLength: 120, sha256: "a".repeat(64), storagePath: storagePathFor(OWNER, OLD_PROJECT, ASSET, "image/png") },
        [UNUSED_ASSET]: { id: UNUSED_ASSET, mimeType: "image/webp", width: 8, height: 8, byteLength: 40, sha256: "b".repeat(64), storagePath: storagePathFor(OWNER, OLD_PROJECT, UNUSED_ASSET, "image/webp") },
      },
    },
  };
}

/** Replace identities by position so two documents can be compared semantically. */
function withoutIds(content: ProjectContent) {
  return content.document.slides.map((slide) => ({
    ...slide,
    id: undefined,
    nodes: slide.nodes.map((node) => ({ ...node, id: undefined, ...(node.type === "image" ? { assetId: undefined } : {}) })),
  }));
}

function sequentialIds() {
  let n = 0;
  return () => `f0000000-0000-4000-8000-${(++n).toString().padStart(12, "0")}`;
}

describe("remapProjectContent (DOM-06)", () => {
  it("gives every slide, node and asset a new ID and rewrites references and storage paths", () => {
    const input = fixture();
    parseProjectContent(input);
    const { content, assetIdMap, slideIdMap, nodeIdMap } = remapProjectContent(input, TARGET);

    expect(slideIdMap.size).toBe(2);
    expect(nodeIdMap.size).toBe(6);
    expect(assetIdMap.size).toBe(2);
    const oldIds = new Set([...slideIdMap.keys(), ...nodeIdMap.keys(), ...assetIdMap.keys()]);
    for (const id of [...slideIdMap.values(), ...nodeIdMap.values(), ...assetIdMap.values()]) expect(oldIds.has(id)).toBe(false);

    content.document.slides.forEach((slide, i) => {
      expect(slide.id).toBe(slideIdMap.get(input.document.slides[i].id));
      slide.nodes.forEach((node, j) => expect(node.id).toBe(nodeIdMap.get(input.document.slides[i].nodes[j].id)));
    });
    const newAsset = assetIdMap.get(ASSET)!;
    const images = content.document.slides.flatMap((s) => s.nodes).filter((n): n is Extract<CanvasNode, { type: "image" }> => n.type === "image");
    expect(images.map((n) => n.assetId)).toEqual([newAsset, newAsset]);
    expect(Object.keys(content.document.assets).sort()).toEqual([...assetIdMap.values()].sort());
    for (const [oldId, newId] of assetIdMap) {
      const asset = content.document.assets[newId];
      const old = input.document.assets[oldId];
      expect(asset.id).toBe(newId);
      expect(asset.storagePath).toBe(storagePathFor(TARGET.ownerId, TARGET.projectId, newId, old.mimeType));
      expect(asset.storagePath).not.toContain(OWNER);
      expect(asset.storagePath).not.toContain(OLD_PROJECT);
      expect({ ...asset, id: undefined, storagePath: undefined }).toEqual({ ...old, id: undefined, storagePath: undefined });
    }
    expect(content.title).toBe(input.title);
    expect(parseProjectContent(content)).toEqual(content);
  });

  it("preserves slide order, z-order, geometry, lock and styles", () => {
    const input = fixture();
    const { content } = remapProjectContent(input, TARGET);
    expect(withoutIds(content)).toEqual(withoutIds(input));
    expect(content.document.slides.map((s) => s.name)).toEqual(["Commit อยู่ในเครื่อง", "สไลด์ที่สอง"]);
    expect(content.document.slides[0].nodes.map((n) => n.type)).toEqual(["rectangle", "image", "git-simulator"]);
    expect(content.document.slides[0].nodes[1].locked).toBe(true);
  });

  it("deep-copies Git state and keeps commit IDs; output shares no references with input", () => {
    const input = fixture();
    const snapshot = structuredClone(input);
    const { content } = remapProjectContent(input, TARGET);
    const git = content.document.slides[0].nodes[2];
    const originalGit = input.document.slides[0].nodes[2];
    if (git.type !== "git-simulator" || originalGit.type !== "git-simulator") throw new Error("fixture");
    expect(git.state).toEqual(originalGit.state);
    expect(Object.keys(git.state.commits)).toEqual(["C1", "C2"]);
    expect(git.state).not.toBe(originalGit.state);

    // Mutate every nested level of the output: input must be untouched.
    git.state.commits.C1.message = "changed";
    git.state.commits.C2.snapshot.content = "changed";
    git.state.machines.A.knownCommitIds.push("C9");
    git.state.machines.B.working!.content = "changed";
    git.state.remote.knownCommitIds.length = 0;
    const pen = content.document.slides[1].nodes[0];
    if (pen.type === "pen") pen.points[0].x = 999;
    Object.values(content.document.assets)[0].width = 1;
    content.document.slides.pop();
    expect(input).toEqual(snapshot);

    // And the other way round.
    const again = remapProjectContent(input, TARGET).content;
    const againSnapshot = structuredClone(again);
    if (originalGit.type === "git-simulator") originalGit.state.commits.C1.message = "mutated input";
    input.document.slides[0].nodes[0].x = -1;
    expect(again).toEqual(againSnapshot);
  });

  it("uses the injected ID factory deterministically", () => {
    const { content, slideIdMap } = remapProjectContent(fixture(), TARGET, sequentialIds());
    // assets first, then slide/node in document order
    expect(Object.keys(content.document.assets)).toEqual([
      "f0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000002",
    ]);
    expect([...slideIdMap.values()]).toEqual([
      "f0000000-0000-4000-8000-000000000003", "f0000000-0000-4000-8000-000000000007",
    ]);
  });

  it("rejects colliding IDs and dangling asset references", () => {
    expect(() => remapProjectContent(fixture(), TARGET, () => "f0000000-0000-4000-8000-000000000001")).toThrow();
    const broken = fixture();
    delete broken.document.assets[ASSET];
    expect(() => remapProjectContent(broken, TARGET)).toThrow(/missing asset/);
  });

  it("drops extra record fields (ownerId/revision) instead of carrying them", () => {
    const record = { ...fixture(), id: OLD_PROJECT, ownerId: OWNER, revision: 7 };
    const { content } = remapProjectContent(record, TARGET);
    expect(Object.keys(content)).toEqual(["title", "document"]);
  });
});

describe("duplicateProjectContent", () => {
  it("publishes only referenced assets, remaps them and appends the Thai suffix", () => {
    const input = fixture();
    const { content, assetIdMap } = duplicateProjectContent(input, TARGET);
    expect(content.title).toBe("Git เบื้องต้น สำเนา");
    expect([...assetIdMap.keys()]).toEqual([ASSET]);
    expect(Object.keys(content.document.assets)).toEqual([assetIdMap.get(ASSET)]);
    expect(input.document.assets[UNUSED_ASSET]).toBeDefined();
    expect(parseProjectContent(content)).toEqual(content);
  });

  it("keeps titles within 120 code points by shortening the base, never the suffix", () => {
    const long = "ก".repeat(118);
    expect([...duplicateTitle(long)].length).toBe(120);
    expect(duplicateTitle(long).endsWith(" สำเนา")).toBe(true);
    // Thai clusters are not split: "กำ" (2 code points) is dropped whole when it does not fit.
    const clusters = `ก${"กำ".repeat(60)}`;
    const title = duplicateTitle(clusters);
    expect([...title].length).toBe(119);
    expect(title).toBe(`ก${"กำ".repeat(56)} สำเนา`);
    const input = fixture();
    input.title = "ข".repeat(120);
    const { content } = duplicateProjectContent(input, TARGET);
    expect([...content.title].length).toBe(120);
    expect(duplicateTitle("บทเรียน", " (copy)")).toBe("บทเรียน (copy)");
  });
});

describe("slide clone", () => {
  it("duplicateSlide deep-copies Git state and gives nodes new IDs", () => {
    const slide = fixture().document.slides[0];
    const copy = duplicateSlide(slide);
    const git = copy.nodes[2];
    const original = slide.nodes[2];
    if (git.type !== "git-simulator" || original.type !== "git-simulator") throw new Error("fixture");
    expect(git.id).not.toBe(original.id);
    expect(git.state).toEqual(original.state);
    git.state.commits.C1.message = "changed";
    git.state.machines.A.knownCommitIds.push("C5");
    expect(original.state.commits.C1.message).toBe("เริ่มต้นโปรเจกต์");
    expect(original.state.machines.A.knownCommitIds).toEqual(["C1", "C2"]);
  });
});
