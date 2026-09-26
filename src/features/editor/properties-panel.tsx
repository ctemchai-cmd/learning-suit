"use client";

import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, BetweenHorizontalEnd, BetweenVerticalEnd, Lock, Trash2 } from "lucide-react";
import { isWidgetNode, type CanvasNode, type SlideDocument } from "@/domain/document/model";
import { DEFAULTS, LIMITS } from "@/domain/document/limits";
import { useEditorStore, type EditorTool } from "./store";
import { getNodeFrame } from "@/domain/document/transform";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";
import type { ToolDefaults } from "./tool-defaults";
import { insertColumn, insertRow } from "@/domain/document/table";

type Field = "opacity" | "stroke" | "strokeWidth" | "strokeStyle" | "fill" | "headLength" | "headWidth" | "color" | "fontSize" | "align" | "rotation" | "label" | "headerFill" | "header";

const STROKED = new Set(["rectangle", "ellipse", "line", "arrow", "pen", "highlighter"]);
const supports = (node: CanvasNode, field: Field): boolean => {
  switch (field) {
    case "opacity": return true;
    case "rotation": return !isWidgetNode(node);
    case "stroke": return STROKED.has(node.type) || node.type === "table";
    case "strokeWidth": case "strokeStyle": return STROKED.has(node.type);
    case "fill": return node.type === "rectangle" || node.type === "ellipse";
    case "headLength": case "headWidth": return node.type === "arrow";
    case "color": return node.type === "text" || node.type === "stencil" || node.type === "table";
    case "fontSize": return node.type === "text" || node.type === "table";
    case "align": return node.type === "text";
    case "label": return node.type === "stencil";
    case "headerFill": return node.type === "table";
    case "header": return node.type === "table" && node.variant === "grid";
  }
};
const read = (node: CanvasNode, field: Field): unknown => (node as unknown as Record<string, unknown>)[field];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function sanitize(field: Field, value: unknown): unknown {
  if (field === "label" && typeof value === "string") return [...value.replace(/[\r\n\u2028\u2029]+/gu, " ")].slice(0, LIMITS.stencilLabelCodePoints).join("");
  if (typeof value !== "number") return value;
  if (field === "opacity") return clamp(value, LIMITS.opacityMin, LIMITS.opacityMax);
  if (field === "strokeWidth") return clamp(value, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax);
  if (field === "fontSize") return clamp(value, LIMITS.fontSizeMin, LIMITS.fontSizeMax);
  if (field === "headLength" || field === "headWidth") return clamp(value, 1, 256);
  if (field === "rotation") return ((value % 360) + 540) % 360 - 180;
  return value;
}

/** Sets an absolute rotation while keeping the visual center fixed (same pivot as the rotate handle). */
function rotateAboutCenter(node: CanvasNode, rotation: number): CanvasNode {
  const center = getNodeFrame(node, konvaFontMetrics).center;
  const rotated = { ...node, rotation } as CanvasNode;
  const moved = getNodeFrame(rotated, konvaFontMetrics).center;
  return { ...rotated, x: node.x + center.x - moved.x, y: node.y + center.y - moved.y } as CanvasNode;
}

/** Applies one field to every selected node that supports it; other fields stay untouched. */
function applyField(nodes: CanvasNode[], field: Field, value: unknown): CanvasNode[] {
  const clean = sanitize(field, value);
  return nodes.filter((node) => supports(node, field)).map((node) => field === "rotation"
    ? rotateAboutCenter(node, clean as number)
    : node.type === "table" && field === "fontSize"
      ? { ...node, fontSize: clamp(clean as number, LIMITS.tableFontMin, LIMITS.tableFontMax) }
      : ({ ...node, [field]: clean } as CanvasNode));
}

/** Range / color inputs: preview on `input`, commit once on native `change` (release / picker close). */
function useCommitOnChange<T extends HTMLInputElement>(onCommit: (value: string) => void) {
  const ref = useRef<T>(null);
  const commit = useRef(onCommit);
  useEffect(() => { commit.current = onCommit; });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = () => commit.current(element.value);
    element.addEventListener("change", listener);
    return () => element.removeEventListener("change", listener);
  }, []);
  return ref;
}

function ColorField({ label, value, mixed, disabled, onPreview, onCommit, onCancel }: { label: string; value: string; mixed?: boolean; disabled: boolean; onPreview: (value: string) => void; onCommit: (value: string) => void; onCancel?: () => void }) {
  // Local draft while the picker is open so previews never reset the control to the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useCommitOnChange<HTMLInputElement>((next) => { setDraft(null); onCommit(next.toUpperCase()); });
  return <label className="flex items-center justify-between gap-2">
    <span>{label}{mixed && <span className="ml-1 text-xs muted">(หลายค่า)</span>}</span>
    <input ref={ref} type="color" aria-label={label} value={(draft ?? value).toLowerCase()} disabled={disabled}
      onChange={(event) => { const next = event.target.value.toUpperCase(); setDraft(next); onPreview(next); }}
      onBlur={() => { if (draft !== null) { setDraft(null); onCancel?.(); } }} />
  </label>;
}

function RangeField({ label, value, min, max, step, mixed, disabled, format, onPreview, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; mixed?: boolean; disabled: boolean;
  format: (value: number) => string; onPreview: (value: number) => void; onCommit: (value: number) => void;
}) {
  // Local draft during one pointer/keyboard interaction; committed once on the native change event.
  const [draft, setDraft] = useState<number | null>(null);
  const ref = useCommitOnChange<HTMLInputElement>((next) => { setDraft(null); onCommit(Number(next)); });
  const shown = draft ?? value;
  return <label className="block">
    <span className="flex justify-between"><span>{label}</span><span className="muted text-xs">{mixed && draft === null ? "หลายค่า" : format(shown)}</span></span>
    <input ref={ref} className="mt-2 w-full" type="range" aria-label={label} min={min} max={max} step={step} value={shown} disabled={disabled}
      onChange={(event) => { const next = Number(event.target.value); setDraft(next); onPreview(next); }} />
  </label>;
}

/**
 * Number input: commit on Enter or blur, Escape restores the value before editing. The commit is
 * bound to the selection present when editing started, so a blur caused by clicking another
 * object never applies the typed value to that other object.
 */
function NumberField({ label, value, min, max, step, mixed, disabled, onCommit, disabledReason }: { label: string; value: number; min: number; max: number; step: number; mixed?: boolean; disabled: boolean; onCommit: (value: number) => void; disabledReason?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commitAtStart = useRef<((value: number) => void) | null>(null);
  const shown = text ?? (mixed ? "" : String(Math.round(value * 100) / 100));
  const commit = () => {
    const target = commitAtStart.current ?? onCommit;
    commitAtStart.current = null;
    if (text === null) return;
    const parsed = Number(text);
    setText(null);
    if (text.trim() !== "" && Number.isFinite(parsed)) target(clamp(parsed, min, max));
  };
  return <label className="block">{label}
    <input className="field mt-2" type="number" aria-label={label} min={min} max={max} step={step} value={shown} placeholder={mixed ? "หลายค่า" : undefined} disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onFocus={() => { commitAtStart.current = onCommit; }}
      onChange={(event) => { if (commitAtStart.current === null) commitAtStart.current = onCommit; setText(event.target.value); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); commitAtStart.current = null; setText(null); }
      }} />
    {disabled && disabledReason && <span className="mt-1 block text-xs muted">{disabledReason}</span>}
  </label>;
}

/** One-line text: commit on Enter or blur, Escape restores; bound to the selection present when editing started. */
function TextField({ label, value, mixed, disabled, maxLength, onCommit }: { label: string; value: string; mixed?: boolean; disabled: boolean; maxLength: number; onCommit: (value: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commitAtStart = useRef<((value: string) => void) | null>(null);
  const commit = () => {
    const target = commitAtStart.current ?? onCommit;
    commitAtStart.current = null;
    if (text === null) return;
    setText(null);
    if (text !== value) target(text);
  };
  return <label className="block">{label}
    <input className="field mt-2" type="text" aria-label={label} value={text ?? (mixed ? "" : value)} placeholder={mixed ? "หลายค่า" : "(ไม่มีข้อความ)"} maxLength={maxLength} disabled={disabled}
      onFocus={() => { commitAtStart.current = onCommit; }}
      onChange={(event) => { if (commitAtStart.current === null) commitAtStart.current = onCommit; setText(event.target.value); }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); commitAtStart.current = null; setText(null); }
      }} />
  </label>;
}

/** What the label of a stencil means, for the Properties field name. */
function stencilLabelName(nodes: CanvasNode[]): string {
  const kinds = new Set(nodes.map((node) => (node.type === "stencil" ? node.kind : null)));
  if (kinds.size !== 1) return "ข้อความ";
  const kind = [...kinds][0];
  if (kind === "browser") return "ที่อยู่เว็บ (URL)";
  if (kind === "window" || kind === "terminal") return "ชื่อหน้าต่าง";
  if (kind === "editor") return "ชื่อไฟล์";
  if (kind === "phone" || kind === "laptop") return "ข้อความบนจอ";
  return "คำใต้ไอคอน";
}

function Segmented<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T | null; options: { value: T; label: string; icon?: React.ReactNode }[]; disabled: boolean; onChange: (value: T) => void }) {
  return <div><div className="mb-2">{label}{value === null && <span className="ml-1 text-xs muted">(หลายค่า)</span>}</div>
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label={label}>
      {options.map((option) => <button key={option.value} type="button" className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs ${value === option.value ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}
        aria-pressed={value === option.value} aria-label={option.label} title={option.label} disabled={disabled} onClick={() => onChange(option.value)}>{option.icon ?? option.label}</button>)}
    </div></div>;
}

function ToolDefaultsEditor({ tool, defaults, onChange, slide, writable, keepDrawing, setKeepDrawing }: {
  tool: EditorTool; defaults: ToolDefaults; onChange: (update: (current: ToolDefaults) => ToolDefaults) => void;
  slide: SlideDocument | undefined; writable: boolean; keepDrawing: boolean; setKeepDrawing: (keep: boolean) => void;
}) {
  const transact = useEditorStore((state) => state.transact);
  const group = tool === "pen" ? "pen" : tool === "highlighter" ? "highlighter" : tool === "rectangle" || tool === "ellipse" ? "shape" : tool === "line" || tool === "arrow" ? "line" : tool === "text" ? "text" : null;
  const drawingTool = group !== null;
  return <div className="space-y-5">
    {group ? <>
      <p className="muted">ค่าเริ่มต้นของเครื่องมือนี้ (จำในอุปกรณ์นี้ ไม่แก้วัตถุที่มีอยู่)</p>
      {group === "text" ? <>
        <ColorField label="สีข้อความเริ่มต้น" value={defaults.text.color} disabled={false} onPreview={() => undefined} onCommit={(color) => onChange((current) => ({ ...current, text: { ...current.text, color } }))} />
        <NumberField label="ขนาดตัวอักษรเริ่มต้น" value={defaults.text.fontSize} min={LIMITS.fontSizeMin} max={LIMITS.fontSizeMax} step={1} disabled={false} onCommit={(fontSize) => onChange((current) => ({ ...current, text: { ...current.text, fontSize } }))} />
      </> : <>
        <ColorField label="สีเส้นเริ่มต้น" value={defaults[group].stroke} disabled={false} onPreview={() => undefined} onCommit={(stroke) => onChange((current) => ({ ...current, [group]: { ...current[group], stroke } }))} />
        <NumberField label="ความหนาเส้นเริ่มต้น" value={defaults[group].strokeWidth} min={LIMITS.strokeWidthMin} max={LIMITS.strokeWidthMax} step={0.5} disabled={false} onCommit={(strokeWidth) => onChange((current) => ({ ...current, [group]: { ...current[group], strokeWidth } }))} />
        {group === "shape" && <label className="flex items-center gap-2"><input type="checkbox" checked={defaults.shape.fill !== "transparent"} onChange={(event) => onChange((current) => ({ ...current, shape: { ...current.shape, fill: event.target.checked ? DEFAULTS.visibleFill : "transparent" } }))} />ใช้สีพื้นเริ่มต้น</label>}
      </>}
      {drawingTool && <label className="flex items-center gap-2"><input type="checkbox" checked={keepDrawing} onChange={(event) => setKeepDrawing(event.target.checked)} />วาดต่อเนื่อง (ไม่กลับเครื่องมือเลือก)</label>}
    </> : <p className="muted">คลิกวัตถุบนกระดานเพื่อปรับคุณสมบัติ</p>}
    {slide && <div className="border-t border-slate-200 pt-4">
      <ColorField label="พื้นหลังสไลด์" value={slide.background} disabled={!writable} onPreview={() => undefined}
        onCommit={(background) => { if (background !== slide.background) transact({ label: "เปลี่ยนพื้นหลังสไลด์", affectedSlideId: slide.id, commands: [{ type: "slide.update", slideId: slide.id, background }] }); }} />
    </div>}
  </div>;
}

export default function PropertiesPanel({ slide, selected, writable, lockSelected, removeSelected }: {
  slide: SlideDocument | undefined;
  selected: CanvasNode[];
  writable: boolean;
  lockSelected: () => void;
  removeSelected: () => void;
}) {
  const transact = useEditorStore((state) => state.transact);
  const setPropertyPreview = useEditorStore((state) => state.setPropertyPreview);
  const tool = useEditorStore((state) => state.tool);
  const toolDefaults = useEditorStore((state) => state.toolDefaults);
  const setToolDefaults = useEditorStore((state) => state.setToolDefaults);
  const keepDrawing = useEditorStore((state) => state.keepDrawing);
  const setKeepDrawing = useEditorStore((state) => state.setKeepDrawing);

  if (!selected.length || !slide) {
    return <div className="space-y-5 p-4 text-sm"><ToolDefaultsEditor tool={tool} defaults={toolDefaults} onChange={setToolDefaults} slide={slide} writable={writable} keepDrawing={keepDrawing} setKeepDrawing={setKeepDrawing} /></div>;
  }

  const common = (field: Field) => selected.every((node) => supports(node, field));
  const valueOf = (field: Field) => {
    const values = selected.filter((node) => supports(node, field)).map((node) => read(node, field));
    const mixed = values.some((value) => value !== values[0]);
    return { value: values[0], mixed };
  };
  const preview = (field: Field, value: unknown) => setPropertyPreview({ slideId: slide.id, nodes: applyField(selected, field, value) });
  // Bound to the IDs selected in this render; node values are re-read at commit time so a late
  // commit never reverts newer edits of other fields.
  const targetIds = selected.map((node) => node.id);
  const slideId = slide.id;
  const commit = (field: Field, value: unknown) => {
    setPropertyPreview(null);
    const current = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
    const fresh = current?.nodes.filter((node) => targetIds.includes(node.id) && !node.locked) ?? [];
    const nodes = applyField(fresh, field, value);
    if (!nodes.length) return;
    transact({ label: "แก้คุณสมบัติวัตถุ", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes }] });
  };
  const opacity = valueOf("opacity");
  const stroke = valueOf("stroke");
  const strokeWidth = valueOf("strokeWidth");
  const strokeStyle = valueOf("strokeStyle");
  const fill = valueOf("fill");
  const rotation = valueOf("rotation");
  const fillOn = fill.value !== "transparent";

  return <div className="space-y-5 p-4 text-sm">
    <div className="font-semibold">เลือก {selected.length} วัตถุ</div>
    <RangeField label="ความทึบ" value={Number(opacity.value)} mixed={opacity.mixed} min={LIMITS.opacityMin} max={LIMITS.opacityMax} step={0.05} disabled={!writable}
      format={(value) => `${Math.round(value * 100)}%`} onPreview={(value) => preview("opacity", value)} onCommit={(value) => commit("opacity", value)} />
    {common("stroke") && <ColorField label="สีเส้น" value={String(stroke.value)} mixed={stroke.mixed} disabled={!writable} onPreview={(value) => preview("stroke", value)} onCommit={(value) => commit("stroke", value)} onCancel={() => setPropertyPreview(null)} />}
    {common("strokeWidth") && <>
      <NumberField label="ความหนาเส้น" value={Number(strokeWidth.value)} mixed={strokeWidth.mixed} min={LIMITS.strokeWidthMin} max={LIMITS.strokeWidthMax} step={0.5} disabled={!writable} onCommit={(value) => commit("strokeWidth", value)} />
      <Segmented label="รูปแบบเส้น" value={strokeStyle.mixed ? null : strokeStyle.value as "solid" | "dashed"} disabled={!writable}
        options={[{ value: "solid", label: "เส้นทึบ" }, { value: "dashed", label: "เส้นประ" }]} onChange={(value) => commit("strokeStyle", value)} />
    </>}
    {common("fill") && <div className="space-y-3">
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="ใช้สีพื้น" checked={fillOn} disabled={!writable} onChange={(event) => commit("fill", event.target.checked ? DEFAULTS.visibleFill : "transparent")} />ใช้สีพื้น{fill.mixed && <span className="text-xs muted">(หลายค่า)</span>}</label>
      {fillOn && <ColorField label="สีพื้น" value={String(fill.value)} mixed={fill.mixed} disabled={!writable} onPreview={(value) => preview("fill", value)} onCommit={(value) => commit("fill", value)} onCancel={() => setPropertyPreview(null)} />}
    </div>}
    {common("headLength") && <div className="grid grid-cols-2 gap-2">
      <NumberField label="ความยาวหัวลูกศร" value={Number(valueOf("headLength").value)} mixed={valueOf("headLength").mixed} min={1} max={256} step={1} disabled={!writable} onCommit={(value) => commit("headLength", value)} />
      <NumberField label="ความกว้างหัวลูกศร" value={Number(valueOf("headWidth").value)} mixed={valueOf("headWidth").mixed} min={1} max={256} step={1} disabled={!writable} onCommit={(value) => commit("headWidth", value)} />
    </div>}
    {common("label") && <>
      <ColorField label="สี" value={String(valueOf("color").value)} mixed={valueOf("color").mixed} disabled={!writable} onPreview={(value) => preview("color", value)} onCommit={(value) => commit("color", value)} onCancel={() => setPropertyPreview(null)} />
      <TextField label={stencilLabelName(selected)} value={String(valueOf("label").value ?? "")} mixed={valueOf("label").mixed} maxLength={LIMITS.stencilLabelCodePoints} disabled={!writable} onCommit={(value) => commit("label", value)} />
    </>}
    {common("headerFill") && <>
      <p className="muted text-xs">ดับเบิลคลิกช่องเพื่อพิมพ์ (Tab ไปช่องถัดไป, Enter ลงบรรทัด) · คลิกขวาที่ช่องเพื่อเพิ่ม/ลบแถว{common("header") ? "-คอลัมน์" : ""}</p>
      {common("header") && <label className="flex items-center gap-2"><input type="checkbox" aria-label="แถวหัวตาราง" checked={valueOf("header").value === true} disabled={!writable}
        onChange={(event) => commit("header", event.target.checked)} />แถวแรกเป็นหัวตาราง{valueOf("header").mixed && <span className="text-xs muted">(หลายค่า)</span>}</label>}
      <ColorField label="สีหัวตาราง" value={String(valueOf("headerFill").value)} mixed={valueOf("headerFill").mixed} disabled={!writable} onPreview={(value) => preview("headerFill", value)} onCommit={(value) => commit("headerFill", value)} onCancel={() => setPropertyPreview(null)} />
      <ColorField label="สีตัวอักษร" value={String(valueOf("color").value)} mixed={valueOf("color").mixed} disabled={!writable} onPreview={(value) => preview("color", value)} onCommit={(value) => commit("color", value)} onCancel={() => setPropertyPreview(null)} />
      <NumberField label="ขนาดตัวอักษร" value={Number(valueOf("fontSize").value)} mixed={valueOf("fontSize").mixed} min={LIMITS.tableFontMin} max={LIMITS.tableFontMax} step={1} disabled={!writable} onCommit={(value) => commit("fontSize", value)} />
      {selected.length === 1 && selected[0].type === "table" && (() => {
        const table = selected[0];
        const change = (label: string, next: typeof table) => { if (next !== table) transact({ label, affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [next] }] }); };
        return <div className="grid grid-cols-2 gap-2">
          <button type="button" className="app-button" disabled={!writable || table.rows.length >= LIMITS.tableRows} onClick={() => change("เพิ่มแถว", insertRow(table, table.rows.length))}><BetweenHorizontalEnd size={15} /> {table.variant === "class" ? "เพิ่มบรรทัด" : "เพิ่มแถว"}</button>
          {table.variant === "grid" && <button type="button" className="app-button" disabled={!writable || table.columns.length >= LIMITS.tableColumns} onClick={() => change("เพิ่มคอลัมน์", insertColumn(table, table.columns.length))}><BetweenVerticalEnd size={15} /> เพิ่มคอลัมน์</button>}
        </div>;
      })()}
    </>}
    {common("align") && <>
      <p className="muted text-xs">ดับเบิลคลิกข้อความบนกระดานเพื่อแก้เนื้อหา · ลากจุดจับด้านข้างเพื่อปรับความกว้าง</p>
      <ColorField label="สีข้อความ" value={String(valueOf("color").value)} mixed={valueOf("color").mixed} disabled={!writable} onPreview={(value) => preview("color", value)} onCommit={(value) => commit("color", value)} onCancel={() => setPropertyPreview(null)} />
      <NumberField label="ขนาดตัวอักษร" value={Number(valueOf("fontSize").value)} mixed={valueOf("fontSize").mixed} min={LIMITS.fontSizeMin} max={LIMITS.fontSizeMax} step={1} disabled={!writable} onCommit={(value) => commit("fontSize", value)} />
      <Segmented label="จัดแนว" value={valueOf("align").mixed ? null : valueOf("align").value as "left" | "center" | "right"} disabled={!writable}
        options={[{ value: "left", label: "ชิดซ้าย", icon: <AlignLeft size={15} /> }, { value: "center", label: "กึ่งกลาง", icon: <AlignCenter size={15} /> }, { value: "right", label: "ชิดขวา", icon: <AlignRight size={15} /> }]}
        onChange={(value) => commit("align", value)} />
    </>}
    {common("rotation") && <NumberField label="มุมหมุน (องศา)" value={Number(rotation.value)} mixed={rotation.mixed} min={-360} max={360} step={1} disabled={!writable || selected.length > 1}
      disabledReason={selected.length > 1 ? "หลายวัตถุ: ใช้จุดจับหมุนบนกระดานเพื่อหมุนทั้งชุดรอบจุดกลาง" : "เปิดแบบอ่านอย่างเดียว"}
      onCommit={(value) => commit("rotation", value)} />}
    <div className="flex gap-2">
      <button className="app-button flex-1" disabled={!writable} onClick={lockSelected} title="ล็อก (⌘L) · ปลดล็อกได้ที่แท็บ Objects"><Lock size={15} /> Lock</button>
      <button className="app-button flex-1" disabled={!writable} onClick={removeSelected} title="ลบ (Delete)"><Trash2 size={15} /> Delete</button>
    </div>
  </div>;
}
