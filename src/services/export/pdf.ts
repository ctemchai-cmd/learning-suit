"use client";

import { PDFDocument } from "pdf-lib";
import type { ProjectContent } from "@/domain/document/model";
import { DEFAULTS } from "@/domain/document/limits";
import type { ImageCache } from "@/features/canvas/image-cache";
import { pdfPageSize, safeFilename } from "./raster";
import { ExportError, renderSlidePng } from "./render";

/**
 * Raster PDF: one page per slide in document order, PNG rendered at 2× within the pixel caps,
 * page size 1 world unit = 1 pt (longest edge ≤ 14,400 pt). Each slide's offscreen stage is
 * destroyed after embedding; pdf-lib still keeps embedded data until save (not streaming).
 */
export async function exportPdf(content: ProjectContent, options: {
  images: ImageCache; padding?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void;
}): Promise<{ blob: Blob; filename: string; warnings: string[] }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(content.title);
  pdf.setCreator("Learning Suit");
  const warnings: string[] = [];
  const slides = content.document.slides;
  options.onProgress?.(0, slides.length);
  for (const [index, slide] of slides.entries()) {
    if (options.signal?.aborted) throw new ExportError("CANCELLED", "ยกเลิกการส่งออกแล้ว");
    const raster = await renderSlidePng(slide, { padding: options.padding ?? DEFAULTS.padding, scale: DEFAULTS.pngScale, transparent: false, images: options.images, signal: options.signal });
    if (raster.plan.reduced) warnings.push(`${slide.name}: ${raster.warnings[0]}`);
    const image = await pdf.embedPng(new Uint8Array(await raster.blob.arrayBuffer()));
    const size = pdfPageSize(raster.plan.region);
    const page = pdf.addPage([size.width, size.height]);
    page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    options.onProgress?.(index + 1, slides.length);
  }
  if (options.signal?.aborted) throw new ExportError("CANCELLED", "ยกเลิกการส่งออกแล้ว");
  const bytes = await pdf.save();
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), filename: `${safeFilename(content.title)}.pdf`, warnings };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
