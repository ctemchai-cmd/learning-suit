import { describe, expect, it } from "vitest";
import { fallbackFontMetrics as metrics, getNodeBounds } from "./geometry";
import type {
  ArrowNode, CanvasNode, EllipseNode, FreehandNode, GitSimulatorNode, ImageNode, LineNode, Point, RectNode, TextNode,
} from "./model";
import {
  getHandleCursor, getMultiHandles, getNodeFrame, getSingleHandles, lockToDominantAxis, normalizeDegrees,
  rotateSelection, rotateSingle, scaleSelection, transformSingle, translateNodes, type TransformHandleId,
} from "./transform";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const common = { rotation: 0, opacity: 1, locked: false };
const strokeStyle = { stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid" as const };

const rect: RectNode = deepFreeze({ id: uuid(1), type: "rectangle", x: 100, y: 200, width: 80, height: 40, ...common, ...strokeStyle, fill: "transparent" });
const ellipse: EllipseNode = deepFreeze({ ...rect, id: uuid(2), type: "ellipse" });
const line: LineNode = deepFreeze({ id: uuid(3), type: "line", x: 10, y: 20, ...common, ...strokeStyle, points: [{ x: 0, y: 0 }, { x: 50, y: 30 }] });
const arrow: ArrowNode = deepFreeze({ ...line, id: uuid(4), type: "arrow", headLength: 12, headWidth: 10 });
const pen: FreehandNode = deepFreeze({
  id: uuid(5), type: "pen", x: 300, y: 100, ...common, ...strokeStyle, strokeWidth: 3,
  points: [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 80, y: 10 }],
});
const text: TextNode = deepFreeze({
  id: uuid(6), type: "text", x: 50, y: 60, ...common, text: "Hello world, this is some text", width: 200,
  fontFamily: "Noto Sans Thai", fontSize: 20, lineHeight: 1.4, color: "#1F2937", align: "left",
});
const image: ImageNode = deepFreeze({ id: uuid(7), type: "image", assetId: uuid(99), x: 0, y: 0, width: 200, height: 100, ...common });
const git: GitSimulatorNode = deepFreeze({
  id: uuid(8), type: "git-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "local",
  state: {
    version: 1, nextCommitNumber: 1, commits: {},
    machines: {
      A: { initialized: true, working: { name: "index.html", content: "" }, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
      B: { initialized: false, working: null, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
    },
    remote: { mainHead: null, knownCommitIds: [] },
  },
});

const BOX: TransformHandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CORNERS = ["nw", "ne", "se", "sw"] as const;
const OPPOSITE: Record<string, TransformHandleId> = { nw: "se", n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e" };

const handleAt = (node: CanvasNode, id: TransformHandleId, zoom = 1) => {
  const found = getSingleHandles(node, metrics, zoom).find((item) => item.id === id);
  if (!found) throw new Error(`missing handle ${id} on ${node.type}`);
  return found.world;
};
const ids = (node: CanvasNode) => getSingleHandles(node, metrics, 1).map((item) => item.id);
const toWorld = (node: CanvasNode, local: Point): Point => {
  const r = node.rotation * Math.PI / 180;
  return { x: node.x + local.x * Math.cos(r) - local.y * Math.sin(r), y: node.y + local.x * Math.sin(r) + local.y * Math.cos(r) };
};
const expectPoint = (actual: Point, expected: Point, digits = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
function expectFinite(value: unknown) {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object") for (const child of Object.values(value)) expectFinite(child);
}
const single = (node: CanvasNode, handle: Exclude<TransformHandleId, "rotate">, pointer: Point, keepAspect = false) => {
  const next = transformSingle(node, handle, pointer, { keepAspect }, metrics);
  expect(next).not.toBe(node);
  expect(next.id).toBe(node.id);
  expect(next.type).toBe(node.type);
  expectFinite(next);
  return next;
};

describe("handles and frames", () => {
  it("exposes the handle set of each node type", () => {
    expect(ids(rect)).toEqual([...BOX, "rotate"]);
    expect(ids(ellipse)).toEqual([...BOX, "rotate"]);
    expect(ids(line)).toEqual(["start", "end", "rotate"]);
    expect(ids(arrow)).toEqual(["start", "end", "rotate"]);
    expect(ids(pen)).toEqual([...BOX, "rotate"]);
    expect(ids({ ...pen, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] })).toEqual(["e", "w", "rotate"]);
    expect(ids({ ...pen, points: [{ x: 0, y: 0 }] })).toEqual(["rotate"]);
    expect(ids(text)).toEqual(["e", "w", "rotate"]);
    expect(ids(image)).toEqual(["nw", "ne", "se", "sw", "rotate"]);
    expect(ids(git)).toEqual(["nw", "ne", "se", "sw"]);
  });

  it("places box handles in rotated local axes and the rotation handle above the top-center", () => {
    expectPoint(handleAt(rect, "nw"), { x: 100, y: 200 });
    expectPoint(handleAt(rect, "e"), { x: 180, y: 220 });
    expectPoint(handleAt(rect, "rotate", 2), { x: 140, y: 200 - 14 });
    const rotated = { ...rect, rotation: 90 };
    expectPoint(handleAt(rotated, "se"), { x: 60, y: 280 });
    // top-center (100, 240); rotated up axis points to +x.
    expectPoint(getSingleHandles(rotated, metrics, 1, 20).find((h) => h.id === "rotate")!.world, { x: 120, y: 240 });
    expectPoint(handleAt(line, "end"), { x: 60, y: 50 });
    expectPoint(handleAt(text, "e"), { x: 250, y: 60 + metrics.measureText(text).height / 2 });
  });

  it("computes oriented frames without stroke padding", () => {
    const frame = getNodeFrame({ ...rect, rotation: 90 }, metrics);
    expectPoint(frame.center, { x: 80, y: 240 });
    expect(frame).toMatchObject({ width: 80, height: 40, rotation: 90 });
    expect(getNodeFrame(text, metrics)).toMatchObject({ width: 200, height: metrics.measureText(text).height });
    expect(getNodeFrame(pen, metrics)).toEqual({ center: { x: 340, y: 110 }, width: 80, height: 20, rotation: 0 });
    expect(getNodeFrame(git, metrics)).toEqual({ center: { x: 560, y: 340 }, width: 1120, height: 680, rotation: 0 });
    // The two-machine step (and old documents without `view`) is wider; the frame follows the step.
    expect(getNodeFrame({ ...git, view: "full" }, metrics)).toEqual({ center: { x: 800, y: 340 }, width: 1600, height: 680, rotation: 0 });
    expect(getNodeFrame({ ...git, view: undefined, scale: 0.5 }, metrics)).toMatchObject({ width: 800, height: 340 });
  });

  it("builds multi-selection handles from the union of node bounds", () => {
    const nodes = [rect, pen];
    const { frame, handles } = getMultiHandles(nodes, metrics, 2);
    const a = getNodeBounds(rect, metrics), b = getNodeBounds(pen, metrics);
    const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width), bottom = Math.max(a.y + a.height, b.y + b.height);
    expect(frame).toEqual({ center: { x: (left + right) / 2, y: (top + bottom) / 2 }, width: right - left, height: bottom - top, rotation: 0 });
    expect(handles).toEqual([
      { id: "nw", world: { x: left, y: top } }, { id: "ne", world: { x: right, y: top } },
      { id: "se", world: { x: right, y: bottom } }, { id: "sw", world: { x: left, y: bottom } },
      { id: "rotate", world: { x: (left + right) / 2, y: top - 14 } },
    ]);
    expect(getMultiHandles([rect, git], metrics, 1).handles.map((h) => h.id)).toEqual(["nw", "ne", "se", "sw"]);
    expect(getMultiHandles([], metrics, 1).handles).toEqual([]);
  });

  it("suggests rotation-aware cursors", () => {
    expect(getHandleCursor("e")).toBe("ew-resize");
    expect(getHandleCursor("nw")).toBe("nwse-resize");
    expect(getHandleCursor("ne")).toBe("nesw-resize");
    expect(getHandleCursor("n")).toBe("ns-resize");
    expect(getHandleCursor("e", 90)).toBe("ns-resize");
    expect(getHandleCursor("e", 45)).toBe("nwse-resize");
    expect(getHandleCursor("rotate")).toBe("grab");
    expect(getHandleCursor("start")).toBe("crosshair");
  });
});

describe("transformSingle: rectangle / ellipse", () => {
  it("resizes free / Shift corners with the opposite edge anchored and clamps before flipping (ported from resize.ts)", () => {
    const base = { ...rect, x: 100, y: 200, width: 80, height: 40, rotation: 0 } as RectNode;
    expect(single(base, "w", { x: 60, y: 220 }, false)).toMatchObject({ x: 60, y: 200, width: 120, height: 40 });
    expect(single(base, "w", { x: 300, y: 220 }, false)).toMatchObject({ x: 179, width: 1 });
    expect(single(base, "se", { x: 260, y: 260 }, true)).toMatchObject({ x: 100, y: 200, width: 160, height: 80 });
    const rotated = { ...base, rotation: 90 } as RectNode;
    const next = single(rotated, "nw", { x: 110, y: 180 }, false) as RectNode;
    expect(next.x).toBeCloseTo(110); expect(next.y).toBeCloseTo(180);
    expect(next.width).toBeCloseTo(100); expect(next.height).toBeCloseTo(50);
  });

  it("keeps the opposite handle fixed for every handle of a rotated node", () => {
    for (const node of [{ ...rect, rotation: 30 }, { ...ellipse, rotation: -120 }]) {
      for (const id of BOX) {
        for (const offset of [{ x: 25, y: 11 }, { x: -300, y: -300 }]) {
          for (const keepAspect of [false, true]) {
            const next = single(node, id as "nw", add(handleAt(node, id), offset), keepAspect);
            expectPoint(handleAt(next, OPPOSITE[id]), handleAt(node, OPPOSITE[id]));
            expect(next.rotation).toBe(node.rotation);
          }
        }
      }
    }
  });

  it("clamps instead of flipping when dragged across the opposite side", () => {
    const crossed = single(rect, "se", { x: -500, y: -500 }) as RectNode;
    expect(crossed).toMatchObject({ x: 100, y: 200, width: 1, height: 1 });
    const west = single(rect, "w", { x: 900, y: 0 }) as RectNode;
    expect(west).toMatchObject({ x: 179, width: 1, height: 40 });
  });

  it("keeps the aspect ratio with Shift on corners, including at the minimum size", () => {
    const next = single(rect, "se", { x: 260, y: 230 }, true) as RectNode;
    expect(next).toMatchObject({ x: 100, y: 200, width: 160, height: 80 });
    const tiny = single(rect, "se", { x: -500, y: -500 }, true) as RectNode;
    expect(tiny.width).toBeCloseTo(2, 9);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
    expect(tiny.width / tiny.height).toBeCloseTo(2, 9);
    // Shift on an edge handle is a free resize (no aspect for sides).
    expect(single(rect, "e", { x: 300, y: 220 }, true)).toMatchObject({ width: 200, height: 40 });
  });

  it("ignores handles the type does not expose", () => {
    expect(single(rect, "start", { x: 0, y: 0 })).toEqual(rect);
  });

  it("never lands a hair below the minimum size because of float noise", () => {
    for (const size of [3, 7, 49, 97.3, 0.1 + 0.2 + 33, 1234.567]) {
      const node = { ...rect, width: size * 3, height: size } as RectNode;
      const shifted = single(node, "se", { x: -1e5, y: -1e5 }, true) as RectNode;
      expect(shifted.height).toBeGreaterThanOrEqual(1);
      expect(shifted.width).toBeGreaterThanOrEqual(1);
      const img = single({ ...image, width: size, height: size * 1.7 } as ImageNode, "nw", { x: 1e5, y: 1e5 }) as ImageNode;
      expect(img.width).toBeGreaterThanOrEqual(1);
      const multi = scaleSelection([node, { ...text, fontSize: size % 150 + 9 } as TextNode], "se", { x: -1e5, y: -1e5 }, metrics);
      expect((multi[0] as RectNode).height).toBeGreaterThanOrEqual(1);
      expect((multi[1] as TextNode).fontSize).toBeGreaterThanOrEqual(8);
      expect((multi[1] as TextNode).width).toBeGreaterThanOrEqual(24);
    }
  });
});

describe("transformSingle: line / arrow", () => {
  it("moves one endpoint and keeps the other fixed in world space", () => {
    const next = single(arrow, "end", { x: 100, y: 80 }) as ArrowNode;
    expect(next.points).toEqual([{ x: 0, y: 0 }, { x: 90, y: 60 }]);
    expect(next).toMatchObject({ headLength: 12, headWidth: 10, strokeWidth: 2 });
    const rotated = { ...line, rotation: 40 } as LineNode;
    const moved = single(rotated, "start", { x: -80, y: 3 });
    expectPoint(handleAt(moved, "end"), handleAt(rotated, "end"));
    expectPoint(handleAt(moved, "start"), { x: -80, y: 3 });
  });

  it("snaps Shift drags to 45° in world space, even for rotated lines", () => {
    const rotated = { ...line, rotation: 30, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] } as LineNode;
    const next = single(rotated, "end", { x: 110, y: 140 }, true);
    const start = handleAt(next, "start"), end = handleAt(next, "end");
    expectPoint(start, { x: 10, y: 20 });
    expect(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI).toBeCloseTo(45, 9);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(Math.hypot(100, 120), 9);
    // Like resize.ts the drag distance is kept; only the direction snaps.
    const vertical = single(line, "end", { x: 12, y: 200 }, true) as LineNode;
    expect(vertical.points[1]).toEqual({ x: 0, y: Math.hypot(2, 180) });
  });

  it("never collapses to zero length", () => {
    const next = single(arrow, "end", { x: 10, y: 20 }) as ArrowNode;
    const [a, b] = next.points;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(1, 9);
    expect(Math.atan2(b.y - a.y, b.x - a.x)).toBeCloseTo(Math.atan2(30, 50), 9); // keeps the previous direction
  });

  it("ignores box handles", () => {
    expect(single(line, "se", { x: 0, y: 0 })).toEqual(line);
  });
});

describe("transformSingle: pen / highlighter", () => {
  it("scales local points into the new box with strokeWidth unchanged", () => {
    const next = single(pen, "se", { x: 460, y: 140 }) as FreehandNode;
    expect(next).toMatchObject({ x: 300, y: 100, strokeWidth: 3 });
    expect(next.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 20 }]);
    const stretched = single(pen, "e", { x: 340, y: 999 }) as FreehandNode;
    expect(stretched.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 40, y: 10 }]);
  });

  it("anchors the opposite handle (rotated) and re-normalizes the local origin", () => {
    const rotated = { ...pen, type: "highlighter", strokeWidth: 16, rotation: 45 } as FreehandNode;
    for (const id of BOX) {
      for (const keepAspect of [false, true]) {
        const next = single(rotated, id as "nw", add(handleAt(rotated, id), { x: -17, y: 29 }), keepAspect) as FreehandNode;
        expectPoint(handleAt(next, OPPOSITE[id]), handleAt(rotated, OPPOSITE[id]));
        expect(Math.min(...next.points.map((p) => p.x))).toBeCloseTo(0, 9);
        expect(Math.min(...next.points.map((p) => p.y))).toBeCloseTo(0, 9);
        expect(next.strokeWidth).toBe(16);
      }
    }
  });

  it("keeps the aspect with Shift on corners and clamps the box at 1 instead of flipping", () => {
    const aspect = single(pen, "se", { x: 460, y: 130 }, true);
    expect(getNodeFrame(aspect, metrics)).toMatchObject({ width: 160, height: 40 });
    const crossed = single(pen, "se", { x: 0, y: 0 });
    expect(getNodeFrame(crossed, metrics)).toMatchObject({ width: 1, height: 1 });
    expect(crossed).toMatchObject({ x: 300, y: 100 });
    const crossedAspect = single(pen, "nw", { x: 9000, y: 9000 }, true);
    const frame = getNodeFrame(crossedAspect, metrics);
    expect(frame.width).toBeCloseTo(1, 9);
    expect(frame.width / frame.height).toBeCloseTo(4, 9);
  });

  it("does not scale a zero-size axis", () => {
    const flat = { ...pen, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] } as FreehandNode;
    const next = single(flat, "e", { x: 400, y: 500 }) as FreehandNode;
    expect(next.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const dot = { ...pen, points: [{ x: 0, y: 0 }] } as FreehandNode;
    expect(single(dot, "se", { x: 999, y: 999 }, true)).toEqual(dot);
  });
});

describe("transformSingle: text", () => {
  const topRight = (node: TextNode) => toWorld(node, { x: node.width, y: 0 });

  it("changes width with side handles and reflows without touching fontSize", () => {
    const next = single(text, "e", { x: 450, y: 0 }) as TextNode;
    expect(next).toMatchObject({ x: 50, y: 60, width: 400, fontSize: 20 });
    expect(metrics.measureText(next).height).toBeLessThan(metrics.measureText(text).height);
  });

  it("keeps the right edge anchored in rotated axes when dragging the west handle", () => {
    const rotated = { ...text, rotation: 30 } as TextNode;
    const next = single(rotated, "w", add(handleAt(rotated, "w"), { x: -60, y: 40 })) as TextNode;
    expect(next.width).toBeGreaterThan(rotated.width);
    expectPoint(topRight(next), topRight(rotated));
    expect(next.fontSize).toBe(20);
  });

  it("clamps width at 24", () => {
    const narrow = single(text, "w", { x: 5000, y: 60 }) as TextNode;
    expect(narrow.width).toBe(24);
    expectPoint(topRight(narrow), topRight(text));
    expect(single(text, "e", { x: -5000, y: 60 })).toMatchObject({ x: 50, width: 24 });
  });

  it("ignores corner handles", () => {
    expect(single(text, "se", { x: 999, y: 999 })).toEqual(text);
  });
});

describe("transformSingle: image", () => {
  it("always preserves the aspect ratio on corners", () => {
    const next = single(image, "se", { x: 300, y: 300 }, false) as ImageNode;
    expect(next).toMatchObject({ x: 0, y: 0, width: 600, height: 300 });
  });

  it("anchors the opposite corner of a rotated image", () => {
    const rotated = { ...image, rotation: 120 } as ImageNode;
    for (const id of CORNERS) {
      const next = single(rotated, id, add(handleAt(rotated, id), { x: 40, y: -90 })) as ImageNode;
      expectPoint(handleAt(next, OPPOSITE[id]), handleAt(rotated, OPPOSITE[id]));
      expect(next.width / next.height).toBeCloseTo(2, 9);
    }
  });

  it("clamps at min size 1 while keeping the aspect, and ignores edge handles", () => {
    const tiny = single(image, "se", { x: -500, y: -500 }) as ImageNode;
    expect(tiny.height).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeCloseTo(1, 9);
    expect(tiny.width).toBeCloseTo(2, 9);
    expect(single(image, "e", { x: 900, y: 50 })).toEqual(image);
  });
});

describe("transformSingle: git simulator", () => {
  it("scales uniformly from corners with the opposite corner anchored and rotation 0", () => {
    const doubled = single(git, "se", { x: 2240, y: 1360 }) as GitSimulatorNode;
    expect(doubled).toMatchObject({ x: 0, y: 0, scale: 2, rotation: 0 });
    const half = single(git, "nw", { x: 560, y: 340 }) as GitSimulatorNode;
    expect(half).toMatchObject({ x: 560, y: 340, scale: 0.5, rotation: 0 });
    expectPoint(handleAt(half, "se"), handleAt(git, "se"));
    expect(half.state).toBe(git.state);
  });

  it("clamps the scale to 0.5–4 and ignores edge handles", () => {
    expect(single(git, "se", { x: 9000, y: 0 })).toMatchObject({ scale: 4, x: 0, y: 0 });
    expect(single(git, "se", { x: -9000, y: -9000 })).toMatchObject({ scale: 0.5, x: 0, y: 0 });
    const huge = single(git, "nw", { x: -1e6, y: -1e6 }) as GitSimulatorNode;
    expect(huge.scale).toBe(4);
    expectPoint(handleAt(huge, "se"), { x: 1120, y: 680 });
    expect(single(git, "e", { x: 2000, y: 300 })).toEqual(git);
  });
});

describe("rotateSingle", () => {
  const center = (node: CanvasNode) => getNodeFrame(node, metrics).center;

  it("rotates about the frame center so the center stays fixed", () => {
    for (const node of [rect, text, line, pen, image, { ...ellipse, rotation: 33 }] as CanvasNode[]) {
      const c = center(node);
      const next = rotateSingle(node, add(c, { x: 0, y: -100 }), add(c, { x: 100, y: 0 }), false, metrics);
      expect(next.rotation).toBeCloseTo(normalizeDegrees(node.rotation + 90), 9);
      expectPoint(center(next), c);
      expectFinite(next);
    }
    const next = rotateSingle(rect, { x: 140, y: 120 }, { x: 240, y: 220 }, false, metrics);
    expect(next).toMatchObject({ rotation: 90, x: 160, y: 180 });
  });

  it("snaps the resulting rotation to 15° steps and normalizes to (-180, 180]", () => {
    const tilted = { ...rect, rotation: 10 } as RectNode;
    const c = center(tilted);
    const at = (degrees: number) => add(c, { x: 100 * Math.cos(degrees * Math.PI / 180), y: 100 * Math.sin(degrees * Math.PI / 180) });
    const snapped = rotateSingle(tilted, at(0), at(37), true, metrics);
    expect(snapped.rotation).toBe(45);
    expectPoint(center(snapped), c);
    expect(rotateSingle(tilted, at(0), at(37), false, metrics).rotation).toBeCloseTo(47, 9);
    const turned = { ...rect, rotation: 170 } as RectNode;
    const tc = center(turned);
    const around = (degrees: number) => add(tc, { x: 100 * Math.cos(degrees * Math.PI / 180), y: 100 * Math.sin(degrees * Math.PI / 180) });
    const wrapped = rotateSingle(turned, around(0), around(30), false, metrics);
    expect(wrapped.rotation).toBeCloseTo(-160, 9);
    expectPoint(center(wrapped), tc);
    expect(rotateSingle(turned, around(0), around(10), true, metrics).rotation).toBe(180);
    expect(rotateSingle(turned, around(0), around(-360 + 5), false, metrics).rotation).toBeCloseTo(175, 9);
  });

  it("returns git widgets unchanged", () => {
    const next = rotateSingle(git, { x: 0, y: -100 }, { x: 100, y: 0 }, false, metrics);
    expect(next).toEqual(git);
    expect(next.rotation).toBe(0);
  });
});

describe("scaleSelection", () => {
  const a: RectNode = deepFreeze({ ...rect, id: uuid(11), x: 0, y: 0, width: 100, height: 50 });
  const b: RectNode = deepFreeze({ ...rect, id: uuid(12), x: 200, y: 100, width: 50, height: 50, rotation: 30 });

  const anchorOf = (nodes: CanvasNode[], handle: "nw" | "ne" | "se" | "sw") =>
    getMultiHandles(nodes, metrics, 1).handles.find((h) => h.id === OPPOSITE[handle])!.world;
  const cornerOf = (nodes: CanvasNode[], handle: "nw" | "ne" | "se" | "sw") =>
    getMultiHandles(nodes, metrics, 1).handles.find((h) => h.id === handle)!.world;
  const scaledPointer = (nodes: CanvasNode[], handle: "nw" | "ne" | "se" | "sw", factor: number) => {
    const anchor = anchorOf(nodes, handle), corner = cornerOf(nodes, handle);
    return { x: anchor.x + (corner.x - anchor.x) * factor, y: anchor.y + (corner.y - anchor.y) * factor };
  };

  it("scales every node type uniformly about the opposite corner", () => {
    const nodes = deepFreeze([a, b, text, arrow, pen, { ...git, x: 400, y: 400 }] as CanvasNode[]);
    for (const handle of CORNERS) {
      const anchor = anchorOf(nodes, handle);
      const next = scaleSelection(nodes, handle, scaledPointer(nodes, handle, 2), metrics);
      next.forEach((node, i) => {
        const before = nodes[i];
        expect(node).not.toBe(before);
        expectFinite(node);
        expectPoint(node, { x: anchor.x + (before.x - anchor.x) * 2, y: anchor.y + (before.y - anchor.y) * 2 });
        expect(node.rotation).toBe(before.rotation);
      });
      const [na, nb, nt, nArrow, nPen, nGit] = next as [RectNode, RectNode, TextNode, ArrowNode, FreehandNode, GitSimulatorNode];
      expect(na).toMatchObject({ width: 200, height: 100, strokeWidth: 2 });
      expect(nb).toMatchObject({ width: 100, height: 100, rotation: 30 });
      expect(nt).toMatchObject({ width: 400, fontSize: 40 });
      expect(nArrow).toMatchObject({ points: [{ x: 0, y: 0 }, { x: 100, y: 60 }], headLength: 12, headWidth: 10, strokeWidth: 2 });
      expect(nPen.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 20 }]);
      expect(nPen.strokeWidth).toBe(3);
      expect(nGit.scale).toBe(2);
      // The rotated rectangle's far corner moved exactly as a uniform scale about the anchor.
      const farBefore = toWorld(b, { x: 50, y: 50 }), farAfter = toWorld(nb, { x: 100, y: 100 });
      expectPoint(farAfter, { x: anchor.x + (farBefore.x - anchor.x) * 2, y: anchor.y + (farBefore.y - anchor.y) * 2 });
    }
  });

  it("derives the factor from the pointer projection onto the frame diagonal", () => {
    const nodes = [a, b];
    const anchor = anchorOf(nodes, "se"), corner = cornerOf(nodes, "se");
    const diagonal = { x: corner.x - anchor.x, y: corner.y - anchor.y };
    const pointer = { x: anchor.x + diagonal.x * 1.5, y: anchor.y };
    const factor = (diagonal.x * diagonal.x * 1.5) / (diagonal.x ** 2 + diagonal.y ** 2);
    const [na] = scaleSelection(nodes, "se", pointer, metrics) as RectNode[];
    expect(na.width).toBeCloseTo(100 * factor, 9);
    expect(scaleSelection(nodes, "se", corner, metrics)).toEqual(nodes);
  });

  it("clamps the whole set when one node hits its limit (text at fontSize 8)", () => {
    const small: TextNode = deepFreeze({ ...text, id: uuid(13), fontSize: 8, y: 300 });
    const nodes = [a, small];
    const shrunk = scaleSelection(nodes, "se", scaledPointer(nodes, "se", 0.5), metrics);
    expect(shrunk).toEqual(nodes);
    const grown = scaleSelection(nodes, "se", scaledPointer(nodes, "se", 2), metrics) as [RectNode, TextNode];
    expect(grown[1].fontSize).toBe(16);
    expect(grown[0].width).toBe(200);
    const big: TextNode = deepFreeze({ ...text, id: uuid(14), fontSize: 80 });
    const capped = scaleSelection([a, big], "se", scaledPointer([a, big], "se", 5), metrics) as [RectNode, TextNode];
    expect(capped[1].fontSize).toBe(160);
    expect(capped[0].width).toBeCloseTo(200, 9);
  });

  it("clamps git scale to 0.5–4 for the whole set", () => {
    const maxed: GitSimulatorNode = deepFreeze({ ...git, scale: 4, x: 300, y: 0 });
    expect(scaleSelection([a, maxed], "se", scaledPointer([a, maxed], "se", 3), metrics)).toEqual([a, maxed]);
    const shrunk = scaleSelection([a, maxed], "se", scaledPointer([a, maxed], "se", 0.01), metrics) as [RectNode, GitSimulatorNode];
    expect(shrunk[1].scale).toBe(0.5);
    expect(shrunk[0].width).toBeCloseTo(100 / 8, 9);
  });

  it("never flips or produces sizes below the minimum when dragged across the anchor", () => {
    const nodes = [a, b, text];
    const anchor = anchorOf(nodes, "se");
    const next = scaleSelection(nodes, "se", { x: anchor.x - 1000, y: anchor.y - 1000 }, metrics) as [RectNode, RectNode, TextNode];
    expect(next[0].width).toBeGreaterThanOrEqual(1);
    expect(next[0].height).toBeGreaterThanOrEqual(1);
    expect(next[1].width).toBeGreaterThanOrEqual(1);
    expect(next[2].width).toBeGreaterThanOrEqual(24);
    expect(next[2].fontSize).toBeGreaterThanOrEqual(8);
    // fontSize 20 → 8 is the binding limit for the set (factor 0.4), not text width (0.12) or rect sides (0.02).
    expect(next[2].fontSize).toBe(8);
    expect(next[2].width).toBeCloseTo(80, 9);
    expect(next[0].width).toBeCloseTo(40, 9);
    expect(next[1].width).toBeCloseTo(20, 9);
    const rectsOnly = scaleSelection([a, b], "se", { x: -1e6, y: -1e6 }, metrics) as RectNode[];
    expect(rectsOnly[0].height).toBe(1); // 50 → 1 binds (factor 0.02)
    expect(rectsOnly[1].width).toBe(1);
    expect(rectsOnly[0].width).toBeCloseTo(2, 9);
  });
});

describe("rotateSelection", () => {
  const nodes = deepFreeze([
    { ...rect, x: 0, y: 0 },
    { ...pen, rotation: 20 },
    { ...text, x: 50, y: 300 },
    { ...arrow, x: 400, y: -50 },
  ] as CanvasNode[]);
  const center = getMultiHandles(nodes, metrics, 1).frame.center;
  const at = (degrees: number) => add(center, { x: 100 * Math.cos(degrees * Math.PI / 180), y: 100 * Math.sin(degrees * Math.PI / 180) });
  const centers = (list: CanvasNode[]) => list.map((node) => getNodeFrame(node, metrics).center);

  it("rotates positions about the union center and adds the same delta to every node", () => {
    const next = rotateSelection(nodes, at(0), at(90), false, metrics);
    const before = centers(nodes), after = centers(next);
    next.forEach((node, i) => {
      expect(node.rotation).toBeCloseTo(normalizeDegrees(nodes[i].rotation + 90), 9);
      const offset = { x: before[i].x - center.x, y: before[i].y - center.y };
      expectPoint(after[i], { x: center.x - offset.y, y: center.y + offset.x });
    });
    for (let i = 0; i < before.length; i += 1) {
      for (let j = i + 1; j < before.length; j += 1) {
        expect(Math.hypot(after[i].x - after[j].x, after[i].y - after[j].y))
          .toBeCloseTo(Math.hypot(before[i].x - before[j].x, before[i].y - before[j].y), 6);
      }
    }
  });

  it("snaps the delta to 15° steps", () => {
    const next = rotateSelection(nodes, at(0), at(50), true, metrics);
    next.forEach((node, i) => expect(node.rotation).toBeCloseTo(normalizeDegrees(nodes[i].rotation + 45), 9));
  });

  it("returns the input unchanged when a git widget is selected", () => {
    const withGit = [...nodes, git];
    expect(rotateSelection(withGit, at(0), at(90), false, metrics)).toEqual(withGit);
  });
});

describe("translateNodes", () => {
  it("moves every node by the same delta and returns new objects", () => {
    const nodes = deepFreeze([rect, pen] as CanvasNode[]);
    const next = translateNodes(nodes, 15, -5);
    expect(next.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 115, y: 195 }, { x: 315, y: 95 }]);
    expect(next[0]).not.toBe(nodes[0]);
    expect((next[1] as FreehandNode).points).toEqual(pen.points);
  });

  it("clamps the delta for the whole set at ±10,000,000", () => {
    const edge = deepFreeze({ ...rect, x: 9_999_990 } as RectNode);
    const next = translateNodes([edge, rect], 100, 0);
    expect(next[0].x).toBe(10_000_000);
    expect(next[1].x).toBe(110);
    expect(translateNodes([rect], -2e7, Number.NaN)[0]).toMatchObject({ x: -10_000_000, y: 200 });
  });

  it("locks to the dominant axis for Shift moves", () => {
    expect(lockToDominantAxis(10, -4)).toEqual({ dx: 10, dy: 0 });
    expect(lockToDominantAxis(3, -4)).toEqual({ dx: 0, dy: -4 });
  });
});
