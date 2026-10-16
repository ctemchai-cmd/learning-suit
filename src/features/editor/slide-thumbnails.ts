"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideDocument } from "@/domain/document/model";
import type { ImageCache } from "@/features/canvas/image-cache";
import { renderSlideThumbnail } from "@/services/export/render";
import { slideRenderableWithoutDownload, THUMBNAIL_FIRST_DELAY_MS, THUMBNAIL_REDRAW_DELAY_MS, whenIdle } from "./thumbnail-policy";

/** Pixel size of a thumbnail: about twice its size in the slide list, so it stays sharp on HiDPI screens. */
export const THUMBNAIL_PX = { width: 176, height: 110 };

/**
 * Thumbnail URLs of the slides (slide id → blob URL, null = nothing to show). Slides are immutable (immer),
 * so a slide is redrawn only when its object changed; redraws run one at a time after a pause in editing.
 * Opening a lesson comes first: the first pass waits for a quiet board, each slide waits for an idle moment, and a slide
 * whose images are not stored in this browser yet is skipped (a thumbnail never downloads images; it is redrawn once the
 * board has loaded them).
 */
export function useSlideThumbnails(slides: SlideDocument[], images: ImageCache | null, enabled: boolean): Record<string, string | null> {
  const drawn = useRef(new Map<string, { slide: SlideDocument; url: string | null }>());
  const disposed = useRef(false);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  // Images the board finishes loading later (e.g. downloaded for the slide being viewed) make skipped slides drawable.
  const [imagesVersion, setImagesVersion] = useState(0);
  useEffect(() => images?.subscribe(() => setImagesVersion((version) => version + 1)), [images]);
  const firstPass = useRef(true);

  useEffect(() => {
    if (!enabled || !images) return;
    let stopped = false;
    const delay = firstPass.current ? THUMBNAIL_FIRST_DELAY_MS : THUMBNAIL_REDRAW_DELAY_MS;
    const timer = window.setTimeout(async () => {
      firstPass.current = false;
      const alive = new Set(slides.map((slide) => slide.id));
      for (const [id, entry] of drawn.current) {
        if (alive.has(id)) continue;
        if (entry.url) URL.revokeObjectURL(entry.url);
        drawn.current.delete(id);
      }
      for (const slide of slides) {
        if (stopped) return;
        if (drawn.current.get(slide.id)?.slide === slide) continue;
        await whenIdle();
        if (stopped) return;
        if (!await slideRenderableWithoutDownload(slide, (assetId) => images.canRenderWithoutDownload(assetId))) continue;
        if (stopped) return;
        const blob = await renderSlideThumbnail(slide, { ...THUMBNAIL_PX, images }).catch(() => null);
        const url = blob ? URL.createObjectURL(blob) : null;
        if (disposed.current) { if (url) URL.revokeObjectURL(url); return; }
        // Kept even if a newer edit arrived meanwhile: it is still the right picture for this slide object.
        const previous = drawn.current.get(slide.id)?.url;
        drawn.current.set(slide.id, { slide, url });
        setUrls((current) => ({ ...current, [slide.id]: url }));
        // The list still shows the previous picture until it re-renders.
        if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
      }
    }, delay);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [slides, images, enabled, imagesVersion]);

  useEffect(() => {
    const entries = drawn.current;
    disposed.current = false;
    return () => {
      disposed.current = true;
      for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
      entries.clear();
    };
  }, []);

  return urls;
}
