import type { Bounds, CanvasNode } from "@/domain/document/model";
import { getContentBounds, type FontMetrics } from "@/domain/document/geometry";
import { DEFAULTS, LIMITS } from "@/domain/document/limits";

// Pure export geometry from docs/plan/05-persistence-security-and-export.md §8.

export type RasterPlan =
  | {
    status: "ok";
    /** World region that is rendered (after padding and integer rounding). */
    region: Bounds;
    /** World units → pixels. */
    scale: number;
    requestedScale: number;
    pixelWidth: number;
    pixelHeight: number;
    empty: boolean;
    reduced: boolean;
  }
  | { status: "too-extreme"; message: string };

export function planRaster(nodes: CanvasNode[], options: { padding: number; scale: number }, metrics: FontMetrics): RasterPlan {
  const content = getContentBounds(nodes, metrics);
  let region: Bounds;
  let empty = false;
  if (!content) {
    // Empty slide: logical 1280×720 without adding padding again.
    empty = true;
    region = { x: 0, y: 0, width: DEFAULTS.emptyExport.width, height: DEFAULTS.emptyExport.height };
  } else {
    const left = Math.floor(content.x - options.padding);
    const top = Math.floor(content.y - options.padding);
    const right = Math.ceil(content.x + content.width + options.padding);
    const bottom = Math.ceil(content.y + content.height + options.padding);
    region = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }
  const { width: W, height: H } = region;
  let scale = Math.min(options.scale, LIMITS.exportEdge / W, LIMITS.exportEdge / H, Math.sqrt(LIMITS.exportPixels / (W * H)));
  let pixelWidth = Math.floor(W * scale);
  let pixelHeight = Math.floor(H * scale);
  // Re-check caps after rounding.
  while (pixelWidth > LIMITS.exportEdge || pixelHeight > LIMITS.exportEdge || pixelWidth * pixelHeight > LIMITS.exportPixels) {
    scale *= 0.999;
    pixelWidth = Math.floor(W * scale);
    pixelHeight = Math.floor(H * scale);
  }
  if (pixelWidth < 1 || pixelHeight < 1) {
    return { status: "too-extreme", message: "สัดส่วนเนื้อหากว้างหรือยาวเกินไปจนภาพเล็กกว่า 1 px กรุณาลดขอบเขตหรือแยกสไลด์" };
  }
  return { status: "ok", region, scale, requestedScale: options.scale, pixelWidth, pixelHeight, empty, reduced: scale < options.scale - 1e-9 };
}

/** PDF page size in points: 1 world unit = 1 pt, longest edge capped at 14,400 pt (aspect kept). */
export function pdfPageSize(region: Bounds): { width: number; height: number } {
  const longest = Math.max(region.width, region.height);
  const factor = longest > DEFAULTS.pdfMaxPoints ? DEFAULTS.pdfMaxPoints / longest : 1;
  return { width: region.width * factor, height: region.height * factor };
}

/** Sanitizes only characters that are unsafe in download filenames; Thai stays intact. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return [...(cleaned || "learning-suit")].slice(0, 150).join("");
}
