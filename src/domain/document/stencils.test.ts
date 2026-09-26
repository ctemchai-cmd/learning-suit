import { describe, expect, it } from "vitest";
import { fallbackFontMetrics as metrics, getNodeBounds } from "./geometry";
import { LIMITS } from "./limits";
import { createProjectContent, STENCIL_FRAMES, STENCIL_ICONS, type CanvasNode, type StencilNode } from "./model";
import { parseProjectContent } from "./schema";
import { STENCILS, stencilSpec } from "./stencils";
import { getSingleHandles, scaleSelection, transformSingle } from "./transform";

const stencil = (overrides: Partial<StencilNode> = {}): StencilNode => ({
  id: crypto.randomUUID(), type: "stencil", kind: "browser", x: 100, y: 50, rotation: 0, opacity: 1, locked: false,
  width: 560, height: 360, color: "#334155", label: "example.com", ...overrides,
});
const withNodes = (nodes: CanvasNode[]) => {
  const content = createProjectContent("ภาพประกอบ");
  content.document.slides[0].nodes = nodes;
  return content;
};

describe("STN-01: ready-made pictures (stencils)", () => {
  it("has exactly one catalog entry per kind, with valid defaults", () => {
    expect(STENCILS.map((item) => item.kind).sort()).toEqual([...STENCIL_FRAMES, ...STENCIL_ICONS].sort());
    for (const spec of STENCILS) {
      expect(spec.color).toMatch(/^#[0-9A-F]{6}$/);
      expect([...spec.label].length).toBeLessThanOrEqual(LIMITS.stencilLabelCodePoints);
      expect(spec.width).toBeGreaterThan(0);
      expect(spec.family).toBe((STENCIL_FRAMES as readonly string[]).includes(spec.kind) ? "frame" : "icon");
    }
    // Every default (as inserted by the picker) is a valid document node.
    const nodes = STENCILS.map((spec) => stencil({ kind: spec.kind, width: spec.width, height: spec.height, color: spec.color, label: spec.label }));
    expect(() => parseProjectContent(withNodes(nodes))).not.toThrow();
  });

  it("rejects unknown kinds, multi-line or too long labels and bad colours", () => {
    for (const bad of [
      { ...stencil(), kind: "rocket" }, stencil({ label: "a\nb" }), stencil({ label: "ก".repeat(LIMITS.stencilLabelCodePoints + 1) }),
      stencil({ color: "red" }), stencil({ width: 0 }), { ...stencil(), extra: true },
    ]) expect(() => parseProjectContent(withNodes([bad as CanvasNode])), JSON.stringify(bad).slice(0, 80)).toThrow();
    expect(() => parseProjectContent(withNodes([stencil({ label: "" })]))).not.toThrow();
  });

  it("behaves like a box: bounds without stroke padding, free resize with every handle, rotation, group scale", () => {
    const node = stencil();
    expect(getNodeBounds(node, metrics)).toEqual({ x: 100, y: 50, width: 560, height: 360 });
    expect(getSingleHandles(node, metrics, 1).map((handle) => handle.id)).toEqual(["nw", "n", "ne", "e", "se", "s", "sw", "w", "rotate"]);
    expect(transformSingle(node, "se", { x: 400, y: 150 }, { keepAspect: false }, metrics)).toMatchObject({ x: 100, y: 50, width: 300, height: 100 });
    expect(transformSingle(node, "w", { x: 200, y: 999 }, { keepAspect: false }, metrics)).toMatchObject({ x: 200, width: 460, height: 360 });
    const [scaled] = scaleSelection([node], "se", { x: 380, y: 230 }, metrics) as StencilNode[];
    expect(scaled).toMatchObject({ x: 100, y: 50, width: 280, height: 180, label: "example.com", kind: "browser" });
  });

  it("names every kind in Thai for the picker", () => {
    expect(stencilSpec("phone").name).toBe("หน้าจอมือถือ");
    expect(stencilSpec("browser").label).toBe("example.com");
    expect(stencilSpec("database")).toMatchObject({ family: "icon", label: "ฐานข้อมูล" });
  });
});
