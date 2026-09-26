import { describe, expect, it } from "vitest";
import type { ArrowNode, CanvasNode, RectNode } from "@/domain/document/model";
import { fallbackFontMetrics, getNodeBounds } from "@/domain/document/geometry";
import { pdfPageSize, planRaster, safeFilename } from "./raster";

const rect = (overrides: Partial<RectNode> = {}): RectNode => ({
  id: crypto.randomUUID(), type: "rectangle", x: 0, y: 0, rotation: 0, opacity: 1, locked: false,
  width: 100, height: 50, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});

describe("export bounds (EXP-01, EXP-03)", () => {
  it("includes negative, offscreen, locked and rotated content plus stroke and arrow heads", () => {
    const nodes: CanvasNode[] = [
      rect({ x: -5000, y: -300, locked: true }),
      rect({ x: 9000, y: 4000, rotation: 45 }),
      { id: crypto.randomUUID(), type: "arrow", x: 200, y: 200, rotation: 0, opacity: 1, locked: false, stroke: "#1F2937", strokeWidth: 4, strokeStyle: "solid", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], headLength: 12, headWidth: 10 } satisfies ArrowNode,
    ];
    const plan = planRaster(nodes, { padding: 48, scale: 1 }, fallbackFontMetrics);
    if (plan.status !== "ok") throw new Error("expected plan");
    for (const node of nodes) {
      const bounds = getNodeBounds(node, fallbackFontMetrics);
      expect(plan.region.x).toBeLessThanOrEqual(bounds.x - 48);
      expect(plan.region.y).toBeLessThanOrEqual(bounds.y - 48);
      expect(plan.region.x + plan.region.width).toBeGreaterThanOrEqual(bounds.x + bounds.width + 48);
      expect(plan.region.y + plan.region.height).toBeGreaterThanOrEqual(bounds.y + bounds.height + 48);
    }
    const rotated = getNodeBounds(nodes[1], fallbackFontMetrics);
    expect(rotated.width).toBeGreaterThan(100); // AABB of a 45° rectangle is wider than its width
  });
  it("uses integer region edges with floor/ceil and applies padding once", () => {
    const plan = planRaster([rect({ x: 10.4, y: 20.6, width: 99.5, height: 49.2, strokeWidth: 1 })], { padding: 48, scale: 2 }, fallbackFontMetrics);
    if (plan.status !== "ok") throw new Error("expected plan");
    expect(Number.isInteger(plan.region.x) && Number.isInteger(plan.region.y)).toBe(true);
    expect(plan.region.x).toBe(Math.floor(10.4 - 0.5 - 48));
    expect(plan.pixelWidth).toBe(Math.floor(plan.region.width * 2));
    expect(plan.reduced).toBe(false);
  });
  it("uses 1280×720 for an empty slide without adding padding", () => {
    const plan = planRaster([], { padding: 48, scale: 2 }, fallbackFontMetrics);
    expect(plan).toMatchObject({ status: "ok", empty: true, region: { x: 0, y: 0, width: 1280, height: 720 }, pixelWidth: 2560, pixelHeight: 1440 });
  });
  it("reduces scale proportionally to the edge/pixel caps without cropping (EXP-04)", () => {
    const plan = planRaster([rect({ width: 20000, height: 1000 })], { padding: 0, scale: 3 }, fallbackFontMetrics);
    if (plan.status !== "ok") throw new Error("expected plan");
    expect(plan.reduced).toBe(true);
    expect(plan.pixelWidth).toBeLessThanOrEqual(8192);
    expect(plan.pixelWidth * plan.pixelHeight).toBeLessThanOrEqual(16_777_216);
    expect(plan.pixelWidth / plan.pixelHeight).toBeCloseTo(plan.region.width / plan.region.height, 1);
    const huge = planRaster([rect({ width: 9000, height: 9000 })], { padding: 48, scale: 2 }, fallbackFontMetrics);
    if (huge.status !== "ok") throw new Error("expected plan");
    expect(huge.pixelWidth * huge.pixelHeight).toBeLessThanOrEqual(16_777_216);
  });
  it("refuses extreme aspect ratios instead of producing an empty image", () => {
    const plan = planRaster([rect({ width: 9_000_000, height: 1, strokeWidth: 0.5 })], { padding: 0, scale: 1 }, fallbackFontMetrics);
    expect(plan.status).toBe("too-extreme");
  });
  it("caps PDF pages at 14,400 pt while keeping aspect", () => {
    expect(pdfPageSize({ x: 0, y: 0, width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
    const page = pdfPageSize({ x: 0, y: 0, width: 28800, height: 7200 });
    expect(page.width).toBeCloseTo(14400);
    expect(page.height).toBeCloseTo(3600);
  });
  it("sanitizes only unsafe filename characters", () => {
    expect(safeFilename("บทเรียน Git: ตอน 1/2")).toBe("บทเรียน Git- ตอน 1-2");
    expect(safeFilename("  ")).toBe("learning-suit");
  });
});

describe("rotated stroke bounds (audit regression)", () => {
  it("covers the miter corners of a thick rotated rectangle stroke", () => {
    const node = rect({ x: 0, y: 0, width: 100, height: 100, rotation: 45, strokeWidth: 64 });
    const bounds = getNodeBounds(node, fallbackFontMetrics);
    // Outer corner of the stroke outline: distance from center = (50 + 32)·√2 along the axes after 45°.
    const reach = (50 + 32) * Math.SQRT2;
    const center = { x: 0 + (50 - 50) , y: 50 * Math.SQRT2 };
    expect(bounds.x).toBeLessThanOrEqual(center.x - reach + 1e-6);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(center.x + reach - 1e-6);
    expect(bounds.y).toBeLessThanOrEqual(center.y - reach + 1e-6);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(center.y + reach - 1e-6);
  });
});
