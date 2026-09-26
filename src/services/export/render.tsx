"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Group, Layer, Rect, Stage } from "react-konva";
import type Konva from "konva";
import type { SlideDocument } from "@/domain/document/model";
import { ensureCanvasFonts, konvaFontMetrics } from "@/features/canvas/font-metrics";
import { ImageCache, ImageCacheContext } from "@/features/canvas/image-cache";
import { StaticNodeView } from "@/features/canvas/node-view";
import { planRaster, type RasterPlan } from "./raster";

export class ExportError extends Error {
  constructor(public code: "MISSING_ASSET" | "TOO_EXTREME" | "EMPTY_SELECTION" | "ENCODE_FAILED" | "CANCELLED", message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export type RasterResult = { blob: Blob; plan: Extract<RasterPlan, { status: "ok" }>; warnings: string[] };

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new ExportError("CANCELLED", "ยกเลิกการส่งออกแล้ว");
};

/**
 * Renders one slide from a frozen document snapshot into a PNG blob using the same node views as
 * the editor, without culling and without any editor chrome (plan05 §8). The backing canvas is
 * created at 1×1 with pixel ratio 1 and only then resized to the capped output size.
 */
export async function renderSlidePng(slide: SlideDocument, options: {
  padding: number; scale: number; transparent: boolean; selectedIds?: string[];
  images: ImageCache; signal?: AbortSignal;
}): Promise<RasterResult> {
  const nodes = options.selectedIds ? slide.nodes.filter((node) => options.selectedIds!.includes(node.id)) : slide.nodes;
  if (options.selectedIds && !nodes.length) throw new ExportError("EMPTY_SELECTION", "ยังไม่ได้เลือกวัตถุที่จะส่งออก");
  await ensureCanvasFonts();
  throwIfAborted(options.signal);
  for (const node of nodes) {
    if (node.type !== "image") continue;
    const entry = await options.images.ensure(node.assetId);
    if (entry.status !== "ready") throw new ExportError("MISSING_ASSET", `ไม่มีข้อมูลรูป ${node.assetId} ในเครื่องหรือบน Cloud จึงหยุดการส่งออก`);
  }
  throwIfAborted(options.signal);
  const plan = planRaster(nodes, { padding: options.padding, scale: options.scale }, konvaFontMetrics);
  if (plan.status !== "ok") throw new ExportError("TOO_EXTREME", plan.message);

  const container = document.createElement("div");
  const root = createRoot(container);
  const stageRef: { current: Konva.Stage | null } = { current: null };
  const layerRef: { current: Konva.Layer | null } = { current: null };
  try {
    flushSync(() => {
      root.render(<ImageCacheContext.Provider value={options.images}>
        <Stage ref={(stage) => { stageRef.current = stage; }} width={1} height={1} listening={false}>
          <Layer ref={(layer) => { layerRef.current = layer; }} listening={false} imageSmoothingEnabled>
            {!options.transparent && <Rect x={0} y={0} width={plan.pixelWidth} height={plan.pixelHeight} fill={slide.background} />}
            <Group x={-plan.region.x * plan.scale} y={-plan.region.y * plan.scale} scaleX={plan.scale} scaleY={plan.scale}>
              {nodes.map((node) => <StaticNodeView key={node.id} node={node} git={{ activeTab: null, transfer: null }} />)}
            </Group>
          </Layer>
        </Stage>
      </ImageCacheContext.Provider>);
    });
    const stage = stageRef.current, layer = layerRef.current;
    if (!stage || !layer) throw new ExportError("ENCODE_FAILED", "สร้างภาพสำหรับส่งออกไม่สำเร็จ");
    layer.getCanvas().setPixelRatio(1);
    stage.size({ width: plan.pixelWidth, height: plan.pixelHeight });
    layer.draw();
    throwIfAborted(options.signal);
    const canvas = layer.getCanvas()._canvas;
    const allocationError = () => new ExportError("ENCODE_FAILED", "Browser จัดสรรภาพขนาดนี้ไม่ได้ ลองลดขนาดหรือแยกสไลด์");
    if (canvas.width !== plan.pixelWidth || canvas.height !== plan.pixelHeight) throw allocationError();
    // Browsers keep the width/height attributes even when the backing store failed; verify the
    // context is alive and, with a background, that the drawn background pixel really exists.
    const context = canvas.getContext("2d");
    if (!context || (typeof context.isContextLost === "function" && context.isContextLost())) throw allocationError();
    if (!options.transparent && context.getImageData(0, 0, 1, 1).data[3] === 0) throw allocationError();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || blob.size === 0) throw new ExportError("ENCODE_FAILED", "Browser สร้างไฟล์ PNG ไม่สำเร็จ ลองลดขนาดหรือแยกสไลด์");
    const warnings = plan.reduced ? [`ลดความละเอียดเป็น ${plan.pixelWidth}×${plan.pixelHeight} px เพื่อไม่ให้เกินขีดจำกัด (ไม่ได้ตัดเนื้อหา)`] : [];
    return { blob, plan, warnings };
  } finally {
    root.unmount();
  }
}
