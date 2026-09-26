import { describe, expect, it } from "vitest";
import type { Point } from "./model";
import { freehandFromWorld, simplifyPolyline } from "./simplify";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("simplifyPolyline", () => {
  it("collapses a straight line to its endpoints", () => {
    const points = deepFreeze(Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: i })));
    expect(simplifyPolyline(points, 0.35)).toEqual([{ x: 0, y: 0 }, { x: 98, y: 49 }]);
  });

  it("keeps zig-zag vertices that deviate more than the tolerance", () => {
    const zigzag = deepFreeze([
      { x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 5 }, { x: 40, y: 0 },
    ]);
    expect(simplifyPolyline(zigzag, 1)).toEqual(zigzag);
    // Below-tolerance jitter is removed, but first/last are always kept.
    const jitter = [{ x: 0, y: 0 }, { x: 10, y: 0.1 }, { x: 20, y: -0.1 }, { x: 30, y: 0 }];
    expect(simplifyPolyline(jitter, 1)).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
  });

  it("keeps a back-tracking stroke's turning point (segment distance, not line distance)", () => {
    const backtrack = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }];
    expect(simplifyPolyline(backtrack, 0.35)).toEqual(backtrack);
    const loop = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }];
    expect(simplifyPolyline(loop, 0.35)).toHaveLength(4);
  });

  it("returns 1- and 2-point inputs unchanged as new arrays and is never empty", () => {
    const one = deepFreeze([{ x: 3, y: 4 }]);
    const two = deepFreeze([{ x: 3, y: 4 }, { x: 3, y: 4 }]);
    expect(simplifyPolyline(one, 5)).toEqual(one);
    expect(simplifyPolyline(one, 5)).not.toBe(one);
    expect(simplifyPolyline(two, 5)).toEqual(two);
    const many = Array.from({ length: 30 }, () => ({ x: 1, y: 1 }));
    expect(simplifyPolyline(many, 1000).length).toBeGreaterThan(0);
    expect(simplifyPolyline(many, Number.NaN).length).toBeGreaterThan(0);
  });

  it("handles long strokes without recursion limits", () => {
    const long = Array.from({ length: 20_000 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 20 }));
    const result = simplifyPolyline(long, 0.35);
    expect(result[0]).toEqual(long[0]);
    expect(result.at(-1)).toEqual(long.at(-1));
    expect(result.length).toBeLessThan(long.length);
  });
});

describe("freehandFromWorld", () => {
  // Vertex (50, 50.2) deviates 0.2 world units from the chord (0,50)–(100,50).
  const samples: Point[] = deepFreeze([{ x: 0, y: 50 }, { x: 50, y: 50.2 }, { x: 100, y: 50 }]);

  it("uses tolerance 0.35 / zoomAtStart", () => {
    expect(freehandFromWorld(samples, 1).points).toHaveLength(2); // 0.2 < 0.35
    expect(freehandFromWorld(samples, 2).points).toHaveLength(3); // 0.2 > 0.175
  });

  it("normalizes the local origin to the min x/y of the simplified points", () => {
    const result = freehandFromWorld([{ x: 120, y: -40 }, { x: 80, y: 10 }, { x: 150, y: 60 }], 1);
    expect(result.x).toBe(80);
    expect(result.y).toBe(-40);
    expect(result.points).toEqual([{ x: 40, y: 0 }, { x: 0, y: 50 }, { x: 70, y: 100 }]);
  });

  it("turns a click without drag into a single-point dot", () => {
    expect(freehandFromWorld([{ x: 7, y: 9 }], 1)).toEqual({ x: 7, y: 9, points: [{ x: 0, y: 0 }] });
    expect(freehandFromWorld([{ x: 7, y: 9 }, { x: 7, y: 9 }], 1)).toEqual({ x: 7, y: 9, points: [{ x: 0, y: 0 }] });
  });

  it("ignores non-finite samples, clamps coordinates and rejects empty input", () => {
    const result = freehandFromWorld([{ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 2e7, y: 0 }], 1);
    expect(result.x).toBe(0);
    expect(result.points).toEqual([{ x: 0, y: 0 }, { x: 10_000_000, y: 0 }]);
    expect(() => freehandFromWorld([], 1)).toThrow(RangeError);
    expect(freehandFromWorld(samples, 0).points).toHaveLength(2); // invalid zoom falls back to 1
  });
});
