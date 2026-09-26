import { describe, expect, it } from "vitest";
import { distancePointToSegment, eraserHitsFreehand, freehandHitsForEraser } from "./hit-test";
import type { CanvasNode, FreehandNode, RectNode } from "./model";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const pen = (overrides: Partial<FreehandNode> = {}): FreehandNode => deepFreeze({
  id: "00000000-0000-4000-8000-000000000001", type: "pen", x: 0, y: 0, rotation: 0, opacity: 1, locked: false,
  stroke: "#1F2937", strokeWidth: 4, strokeStyle: "solid",
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  ...overrides,
});

describe("distancePointToSegment", () => {
  it("measures perpendicular, endpoint and zero-length distances", () => {
    expect(distancePointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distancePointToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distancePointToSegment({ x: -3, y: -4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("eraserHitsFreehand", () => {
  it("hits within eraserRadius + strokeWidth/2 and misses beyond it", () => {
    const node = pen();
    expect(eraserHitsFreehand(node, [{ x: 50, y: 6.9 }], 5)).toBe(true); // 5 + 2 = 7
    expect(eraserHitsFreehand(node, [{ x: 50, y: 7.1 }], 5)).toBe(false);
    expect(eraserHitsFreehand(node, [{ x: 50, y: 7 }], 5)).toBe(true); // touching counts
    expect(eraserHitsFreehand(node, [{ x: 106.9, y: 0 }], 5)).toBe(true); // round cap past the end
    expect(eraserHitsFreehand(node, [], 5)).toBe(false);
  });

  it("detects an eraser path that crosses the stroke between samples", () => {
    const node = pen();
    expect(eraserHitsFreehand(node, [{ x: 50, y: -40 }, { x: 50, y: 40 }], 1)).toBe(true);
    expect(eraserHitsFreehand(node, [{ x: 120, y: -40 }, { x: 120, y: 40 }], 1)).toBe(false);
  });

  it("accounts for node translation and rotation", () => {
    // Local segment (0,0)→(100,0) at origin (200,100) rotated 90° runs from (200,100) down to (200,200).
    const node = pen({ x: 200, y: 100, rotation: 90 });
    expect(eraserHitsFreehand(node, [{ x: 205, y: 150 }], 3)).toBe(true); // 5 ≤ 3 + 2
    expect(eraserHitsFreehand(node, [{ x: 250, y: 100 }], 3)).toBe(false); // where it would be unrotated
    expect(eraserHitsFreehand(node, [{ x: 150, y: 150 }, { x: 250, y: 150 }], 0)).toBe(true);
    const diagonal = pen({ x: 10, y: 10, rotation: 45 });
    const onStroke = { x: 10 + 50 * Math.SQRT1_2, y: 10 + 50 * Math.SQRT1_2 };
    expect(eraserHitsFreehand(diagonal, [{ x: onStroke.x + 4, y: onStroke.y - 4 }], 4)).toBe(true); // ≈5.66 ≤ 6
    expect(eraserHitsFreehand(diagonal, [{ x: onStroke.x + 5, y: onStroke.y - 5 }], 4)).toBe(false); // ≈7.07 > 6
  });

  it("treats a single-point stroke as a dot of diameter strokeWidth", () => {
    const dot = pen({ x: 30, y: 30, points: [{ x: 0, y: 0 }], strokeWidth: 10 });
    expect(eraserHitsFreehand(dot, [{ x: 30, y: 38 }], 3)).toBe(true); // 8 ≤ 3 + 5
    expect(eraserHitsFreehand(dot, [{ x: 30, y: 39 }], 3)).toBe(false);
    expect(eraserHitsFreehand(dot, [{ x: 0, y: 30 }, { x: 60, y: 30 }], 0)).toBe(true);
  });

  it("counts the wide highlighter width", () => {
    const highlighter = pen({ type: "highlighter", strokeWidth: 16 });
    expect(eraserHitsFreehand(highlighter, [{ x: 50, y: 10 }], 2)).toBe(true); // 10 ≤ 2 + 8
    expect(eraserHitsFreehand(pen(), [{ x: 50, y: 10 }], 2)).toBe(false); // 10 > 2 + 2
  });
});

describe("freehandHitsForEraser", () => {
  it("returns unlocked pen/highlighter IDs only", () => {
    const rect: RectNode = {
      id: "00000000-0000-4000-8000-000000000009", type: "rectangle", x: 0, y: -10, width: 100, height: 20,
      rotation: 0, opacity: 1, locked: false, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent",
    };
    const nodes: CanvasNode[] = deepFreeze([
      pen({ id: "a" }),
      pen({ id: "locked", locked: true }),
      pen({ id: "far", y: 500 }),
      pen({ id: "hl", type: "highlighter", strokeWidth: 16, y: 12 }),
      rect,
    ]);
    expect(freehandHitsForEraser(nodes, [{ x: 50, y: 0 }, { x: 50, y: 5 }], 2)).toEqual(["a", "hl"]);
  });
});
