"use client";

import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, X } from "lucide-react";
import type { ProjectContent } from "@/domain/document/model";
import { DEFAULTS } from "@/domain/document/limits";
import type { ImageCache } from "@/features/canvas/image-cache";
import { downloadBlob, exportPdf } from "@/services/export/pdf";
import { safeFilename } from "@/services/export/raster";
import { ExportError, renderSlidePng } from "@/services/export/render";

export type ExportKind = "png-slide" | "png-selection" | "pdf" | "archive";

export type ArchiveExporter = (content: ProjectContent, options: { signal: AbortSignal; onProgress: (done: number, total: number) => void }) => Promise<{ blob: Blob; filename: string }>;

/**
 * Export runs from a frozen snapshot taken when the user presses the button (after pending
 * edits flushed); drawing can continue and the camera/selection never change (EXP-06).
 */
export default function ExportDialog({ open, onOpenChange, getSnapshot, activeSlideId, selectedIds, images, exportArchive, initialKind = "png-slide" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getSnapshot: () => ProjectContent | null;
  activeSlideId: string | null;
  selectedIds: string[];
  images: ImageCache;
  exportArchive: ArchiveExporter;
  initialKind?: ExportKind;
}) {
  const [kind, setKind] = useState<ExportKind>(initialKind);
  const [scale, setScale] = useState<1 | 2 | 3>(DEFAULTS.pngScale);
  const [padding, setPadding] = useState<number>(DEFAULTS.padding);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);

  const selectionEmpty = selectedIds.length === 0;
  const run = async () => {
    const content = getSnapshot();
    if (!content) return;
    const snapshot = structuredClone(content);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(null); setWarnings([]); setProgress(null);
    try {
      if (kind === "png-slide" || kind === "png-selection") {
        const slide = snapshot.document.slides.find((item) => item.id === activeSlideId) ?? snapshot.document.slides[0];
        const result = await renderSlidePng(slide, { padding, scale, transparent, images, signal: abort.signal, selectedIds: kind === "png-selection" ? selectedIds : undefined });
        downloadBlob(result.blob, `${safeFilename(`${snapshot.title}-${slide.name}`)}.png`);
        setWarnings(result.warnings);
      } else if (kind === "pdf") {
        const result = await exportPdf(snapshot, { images, padding, signal: abort.signal, onProgress: (done, total) => setProgress({ done, total }) });
        downloadBlob(result.blob, result.filename);
        setWarnings(result.warnings);
      } else {
        const result = await exportArchive(snapshot, { signal: abort.signal, onProgress: (done, total) => setProgress({ done, total }) });
        downloadBlob(result.blob, result.filename);
      }
    } catch (cause) {
      if (cause instanceof ExportError && cause.code === "CANCELLED") setError("ยกเลิกการส่งออกแล้ว ไม่มีไฟล์ถูกสร้าง");
      else if (abort.signal.aborted) setError("ยกเลิกการส่งออกแล้ว ไม่มีไฟล์ถูกสร้าง");
      else setError(cause instanceof Error ? cause.message : "ส่งออกไม่สำเร็จ");
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false); setProgress(null);
    }
  };

  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) controller.current?.abort(); onOpenChange(next); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content !w-[min(480px,calc(100vw-2rem))]">
        <div className="flex items-start justify-between">
          <Dialog.Title className="text-xl font-semibold">Export</Dialog.Title>
          <Dialog.Close className="app-button icon-button" aria-label="ปิด"><X size={18} /></Dialog.Close>
        </div>
        <Dialog.Description className="muted mt-2 text-sm">ส่งออกจาก Drawing info ทั้งหมดของสไลด์ รวมวัตถุนอกจอและที่ล็อก โดยไม่มีจุดจับหรือกริด</Dialog.Description>
        <fieldset className="mt-4 space-y-2 text-sm" disabled={busy}>
          <legend className="mb-2 font-semibold">ชนิดไฟล์</legend>
          {([
            { value: "png-slide", label: "PNG · สไลด์นี้" },
            { value: "png-selection", label: "PNG · เฉพาะวัตถุที่เลือก", disabledReason: selectionEmpty ? "เลือกวัตถุก่อนจึงส่งออกเฉพาะที่เลือกได้" : null },
            { value: "pdf", label: "PDF · ทุกสไลด์ (ภาพ raster ข้อความเลือกไม่ได้)" },
            { value: "archive", label: "ไฟล์โปรเจกต์ .learning-suit (นำกลับมาแก้ได้)" },
          ] as { value: ExportKind; label: string; disabledReason?: string | null }[]).map((option) => <label key={option.value} className={`flex items-start gap-2 ${option.disabledReason ? "opacity-60" : ""}`}>
            <input type="radio" name="export-kind" value={option.value} checked={kind === option.value} disabled={Boolean(option.disabledReason)} onChange={() => setKind(option.value)} />
            <span>{option.label}{option.disabledReason && <span className="block text-xs muted">{option.disabledReason}</span>}</span>
          </label>)}
        </fieldset>
        {(kind === "png-slide" || kind === "png-selection" || kind === "pdf") && <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {kind !== "pdf" && <label className="block">ความละเอียด
            <select className="field mt-1" value={scale} disabled={busy} onChange={(event) => setScale(Number(event.target.value) as 1 | 2 | 3)}>
              <option value={1}>1×</option><option value={2}>2×</option><option value={3}>3×</option>
            </select>
          </label>}
          <label className="block">ขอบรอบเนื้อหา
            <input className="field mt-1" type="number" min={0} max={256} value={padding} disabled={busy} onChange={(event) => setPadding(Math.max(0, Math.min(256, Number(event.target.value) || 0)))} />
          </label>
          {kind !== "pdf" && <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={transparent} disabled={busy} onChange={(event) => setTransparent(event.target.checked)} />พื้นหลังโปร่งใส</label>}
        </div>}
        {progress && <div className="mt-4" role="status" aria-live="polite">
          <div className="text-sm">กำลังส่งออก {progress.done}/{progress.total}</div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-slate-800" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        </div>}
        {warnings.map((warning) => <p key={warning} className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">{warning}</p>)}
        {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          {busy ? <button className="app-button" onClick={() => controller.current?.abort()}>ยกเลิก</button> : <Dialog.Close className="app-button">ปิด</Dialog.Close>}
          <button className="app-button app-button-primary" disabled={busy || (kind === "png-selection" && selectionEmpty)} onClick={() => void run()}><Download size={16} /> {busy ? "กำลังส่งออก…" : "ส่งออก"}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
