import type { SlideDocument } from "@/domain/document/model";

/**
 * Thumbnails are a rebuildable cache, so they must never cost the lesson anything: no downloads of its own, and never while
 * the board is busy. These helpers hold that policy (kept free of canvas imports so it can be unit tested).
 */

/** The board must have been quiet this long before the first thumbnail work starts (a lesson that is just opening is busy). */
export const THUMBNAIL_FIRST_DELAY_MS = 2000;
/** Later redraws after an edit wait for a short pause in editing only. */
export const THUMBNAIL_REDRAW_DELAY_MS = 500;

/** Answers "can this asset be drawn without starting a download?" (see ImageCache.canRenderWithoutDownload). */
export type AssetAvailability = (assetId: string) => Promise<boolean>;

/** True when every image on the slide is already decoded, being loaded by the board, or stored in this browser. */
export async function slideRenderableWithoutDownload(slide: Pick<SlideDocument, "nodes">, available: AssetAvailability | null): Promise<boolean> {
  for (const node of slide.nodes) {
    if (node.type !== "image") continue;
    if (!available || !(await available(node.assetId))) return false;
  }
  return true;
}

/** Resolves when the browser is idle (or after `fallbackMs` where requestIdleCallback is missing): lets input and drawing go first. */
export function whenIdle(timeoutMs = 1000, fallbackMs = 16): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    else setTimeout(resolve, fallbackMs);
  });
}
