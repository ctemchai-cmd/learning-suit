import { describe, expect, it } from "vitest";
import { snapMove, snapPoint, snapResize, snappingBypassed } from "./snap";

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

describe("SNP-02: snapping a point being placed", () => {
  const other = box(300, 100, 100, 50);
  it("lands on another object's edge or centre with a guide, else on the grid", () => {
    const hit = snapPoint({ x: 303, y: 400 }, [other], { threshold: 5, grid: 10 });
    expect(hit.point).toEqual({ x: 300, y: 400 });
    expect(hit.guides).toEqual([{ axis: "x", at: 300, from: 100, to: 400 }]);
    expect(snapPoint({ x: 100, y: 125 }, [other], { threshold: 5, grid: null }).point).toEqual({ x: 100, y: 125 });
    expect(snapPoint({ x: 100, y: 127 }, [other], { threshold: 5, grid: null }).point).toEqual({ x: 100, y: 125 });
    // Nothing near: the grid.
    expect(snapPoint({ x: 123, y: 456 }, [other], { threshold: 5, grid: 10 })).toEqual({ point: { x: 120, y: 460 }, guides: [] });
    expect(snapPoint({ x: 123, y: 456 }, [], { threshold: 5, grid: null })).toEqual({ point: { x: 123, y: 456 }, guides: [] });
  });
  it("leaves a locked axis alone", () => {
    expect(snapPoint({ x: 303, y: 456 }, [other], { threshold: 5, grid: 10, lockX: true }).point).toEqual({ x: 303, y: 460 });
  });
  it("⌘/Ctrl bypasses snapping", () => {
    expect(snappingBypassed({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(snappingBypassed({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(snappingBypassed({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe("SNP-03: snapping a resize", () => {
  // The box being resized starts at (0,0) 100×50; the real transform here just moves the dragged edge to the pointer.
  const resulting = (handle: "e" | "se") => (pointer: { x: number; y: number }) => ({ x: 0, y: 0, width: pointer.x, height: handle === "se" ? pointer.y : 50 });
  const other = box(300, 200, 100, 50);
  it("snaps the dragged edge to another object's edge and shows the guide", () => {
    const result = snapResize("e", { x: 297, y: 20 }, [other], { threshold: 5, grid: null, resulting: resulting("e") });
    expect(result.pointer).toEqual({ x: 300, y: 20 });
    expect(result.guides).toMatchObject([{ axis: "x", at: 300 }]);
    // y does not move with an east handle, even if it is near a line.
    expect(snapResize("e", { x: 100, y: 202 }, [other], { threshold: 5, grid: null, resulting: resulting("e") }).pointer.y).toBe(202);
  });
  it("falls back to the grid, and does nothing when there is nothing to snap to", () => {
    expect(snapResize("e", { x: 123, y: 20 }, [], { threshold: 5, grid: 10, resulting: resulting("e") })).toEqual({ pointer: { x: 120, y: 20 }, guides: [] });
    expect(snapResize("e", { x: 123, y: 20 }, [], { threshold: 5, grid: null, resulting: resulting("e") })).toEqual({ pointer: { x: 123, y: 20 }, guides: [] });
  });
  it("with the aspect locked on a corner, only the axis that really lands is snapped", () => {
    // Aspect 2:1 — the height follows the width, so only x can be honoured; y snapping (202 → 200) would not land.
    const aspect = (pointer: { x: number; y: number }) => ({ x: 0, y: 0, width: pointer.x, height: pointer.x / 2 });
    const result = snapResize("se", { x: 297, y: 202 }, [other], { threshold: 5, grid: null, keepAspect: true, resulting: aspect });
    expect(result.pointer).toEqual({ x: 300, y: 202 });
    expect(result.guides).toMatchObject([{ axis: "x", at: 300 }]);
    // Nothing lands: unchanged pointer, no guide.
    expect(snapResize("se", { x: 297, y: 202 }, [other], { threshold: 5, grid: null, keepAspect: true, resulting: () => ({ x: 0, y: 0, width: 50, height: 50 }) }))
      .toEqual({ pointer: { x: 297, y: 202 }, guides: [] });
  });
  it("drops a guide when the minimum size stops the edge short of the line (planted omission)", () => {
    const clamped = () => ({ x: 0, y: 0, width: 40, height: 50 });
    expect(snapResize("e", { x: 297, y: 20 }, [other], { threshold: 5, grid: null, resulting: clamped }).guides).toEqual([]);
  });
});
