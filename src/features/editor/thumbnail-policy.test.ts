import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/domain/document/model";
import { ImageCache } from "@/features/canvas/image-cache";
import { slideRenderableWithoutDownload, THUMBNAIL_FIRST_DELAY_MS, THUMBNAIL_REDRAW_DELAY_MS } from "./thumbnail-policy";

const base = { x: 0, y: 0, rotation: 0, opacity: 1, locked: false };
const image = (id: string, assetId: string) => ({ ...base, id, type: "image", assetId, width: 100, height: 100 }) as unknown as CanvasNode;
const rect = (id: string) => ({ ...base, id, type: "rectangle", width: 10, height: 10, stroke: "#000", strokeWidth: 1, strokeStyle: "solid", fill: "transparent" }) as unknown as CanvasNode;

describe("slideRenderableWithoutDownload", () => {
  it("slides without images are always renderable, even with no availability source", async () => {
    expect(await slideRenderableWithoutDownload({ nodes: [rect("a")] }, null)).toBe(true);
    expect(await slideRenderableWithoutDownload({ nodes: [] }, null)).toBe(true);
  });

  it("is renderable only when every image is available (planted omission: one missing image blocks the slide)", async () => {
    const stored = new Set(["a1", "a2"]);
    const available = async (id: string) => stored.has(id);
    const slide = { nodes: [image("n1", "a1"), rect("r"), image("n2", "a2")] };
    expect(await slideRenderableWithoutDownload(slide, available)).toBe(true);
    stored.delete("a2");
    expect(await slideRenderableWithoutDownload(slide, available)).toBe(false);
  });

  it("an image slide with no availability source is not renderable (never guess)", async () => {
    expect(await slideRenderableWithoutDownload({ nodes: [image("n1", "a1")] }, null)).toBe(false);
  });

  it("waits for a quiet board before the first pass and for a short pause before redraws", () => {
    expect(THUMBNAIL_FIRST_DELAY_MS).toBeGreaterThanOrEqual(2000);
    expect(THUMBNAIL_REDRAW_DELAY_MS).toBeLessThan(THUMBNAIL_FIRST_DELAY_MS);
  });
});

describe("ImageCache.canRenderWithoutDownload", () => {
  it("never calls the downloading resolver and never creates entries", async () => {
    const resolve = vi.fn(async () => null);
    const cache = new ImageCache(resolve, async (id) => id === "local");
    expect(await cache.canRenderWithoutDownload("local")).toBe(true);
    expect(await cache.canRenderWithoutDownload("remote-only")).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    // Still no entry was created: a later get() starts the (single) real load.
    cache.get("remote-only");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("without a local probe only images the board already has or is loading count", async () => {
    const cache = new ImageCache(() => new Promise(() => undefined));
    expect(await cache.canRenderWithoutDownload("x")).toBe(false);
    cache.get("x"); // the board asked for it: waiting for that load costs nothing extra
    expect(await cache.canRenderWithoutDownload("x")).toBe(true);
  });

  it("a probe failure counts as unavailable", async () => {
    const cache = new ImageCache(async () => null, async () => { throw new Error("idb"); });
    expect(await cache.canRenderWithoutDownload("x")).toBe(false);
  });
});
