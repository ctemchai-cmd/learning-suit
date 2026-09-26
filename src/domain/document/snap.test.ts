import { describe, expect, it } from "vitest";
import { snapMove } from "./snap";

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe("SNP-01: snapping a drag", () => {
  it("lines edges and centres up with a nearby object and reports the guide", () => {
    const other = box(300, 0);
    // Left edge 297 → 300 (3 away); the top is 7 away from other's top, beyond the threshold of 5.
    const result = snapMove(box(0, 0), [other], 297, 207, { threshold: 5, grid: null });
    expect(result).toMatchObject({ dx: 300, dy: 207 });
    expect(result.guides).toEqual([{ axis: "x", at: 300, from: 0, to: 257 }]);
    // Centre to centre on y.
    expect(snapMove(box(0, 0), [box(300, 100)], 0, 98, { threshold: 5, grid: null })).toMatchObject({ dy: 100 });
  });

  it("falls back to the grid, keeps a Shift-locked axis, and prefers the closest line", () => {
    expect(snapMove(box(0, 0), [], 23, 36, { threshold: 5, grid: 10 })).toEqual({ dx: 20, dy: 40, guides: [] });
    expect(snapMove(box(0, 0), [], 23, 0, { threshold: 5, grid: 10, lockY: true })).toEqual({ dx: 20, dy: 0, guides: [] });
    expect(snapMove(box(5, 5), [], 23, 36, { threshold: 5, grid: null })).toEqual({ dx: 23, dy: 36, guides: [] });
    // Right edge (x+100) is 1 from 400; left edge is 4 from 303: the right edge wins.
    expect(snapMove(box(0, 0), [box(303, 500, 97, 10)], 299, 0, { threshold: 5, grid: null, lockY: true }).dx).toBe(300);
  });
});
