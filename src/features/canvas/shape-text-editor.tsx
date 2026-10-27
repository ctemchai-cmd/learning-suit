"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { Camera } from "@/domain/document/session";
import { worldToScreen } from "@/domain/document/camera";
import { LIMITS } from "@/domain/document/limits";
import { SHAPE_TEXT, shapeTextBox, type Shape } from "@/domain/document/shape-text";
import { useEditorStore } from "@/features/editor/store";
import { CANVAS_FONT } from "./font-metrics";
import { BoldMarkerHint, useBoldSelection } from "./bold-selection";

export type ShapeSession = { slideId: string; before: Shape; draft: Shape };

/**
 * Typing inside a rectangle / ellipse (plan 03 §shape text), the same way as a text box: one focus session = one
 * document transaction; the draft is a pending edit (crash recovery) flushed on blur, ⌘Enter, Save/Export/slide
 * change; Escape cancels. The textarea sits in the shape's text box (same place and size as on the board) and the
 * outline marks the shape. IME (Thai) composition is never cut in the middle.
 */
export function ShapeTextEditorOverlay({ session, camera, onChange, onFinish }: {
  session: ShapeSession;
  camera: Camera;
  onChange: (draft: Shape) => void;
  onFinish: (commit: boolean) => boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const blurWhileComposing = useRef(false);
  const finishRef = useRef(onFinish);
  useLayoutEffect(() => { finishRef.current = onFinish; });
  const registerFlusher = useEditorStore((state) => state.registerFlusher);

  const boldSelection = useBoldSelection(ref, session.draft.text ?? "");

  useEffect(() => registerFlusher(() => {
    // Flushing during IME composition would split a syllable; wait for compositionend.
    if (composing.current) return false;
    return finishRef.current(true);
  }), [registerFlusher]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }, []);

  const { draft } = session;
  const box = shapeTextBox(draft);
  const fontSize = draft.fontSize ?? SHAPE_TEXT.fontSize;
  const text = draft.text ?? "";
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(box.height, Math.max(element.scrollHeight, fontSize * SHAPE_TEXT.lineHeight))}px`;
  }, [text, box.height, box.width, fontSize, draft.bold]);

  const origin = worldToScreen({ x: draft.x, y: draft.y }, camera);
  return <>
  <BoldMarkerHint text={text} left={origin.x} top={origin.y} />
  <div
    className="pointer-events-none absolute z-30 outline outline-2 outline-blue-500"
    style={{
      left: origin.x, top: origin.y, width: draft.width, height: draft.height, borderRadius: draft.type === "ellipse" ? "50%" : 0,
      transform: `rotate(${draft.rotation}deg) scale(${camera.zoom})`, transformOrigin: "top left",
    }}>
    <div className="absolute flex items-center" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
      <textarea
        ref={ref}
        aria-label="แก้ข้อความในรูปทรง"
        className="pointer-events-auto block w-full resize-none border-0 bg-transparent p-0 outline-none"
        style={{
          fontFamily: `"${CANVAS_FONT}", sans-serif`, fontSize, lineHeight: SHAPE_TEXT.lineHeight, fontWeight: draft.bold ? 700 : 400,
          color: draft.color ?? SHAPE_TEXT.color, textAlign: draft.align ?? "center", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: box.height, overflowY: "auto",
        }}
        value={text}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          if ([...next].length > LIMITS.textCodePoints) return;
          onChange({ ...draft, text: next });
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => {
          composing.current = false;
          if (blurWhileComposing.current) { blurWhileComposing.current = false; onFinish(true); }
        }}
        onBlur={() => {
          if (composing.current) blurWhileComposing.current = true;
          else onFinish(true);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onFinish(false); return; }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            if (!event.nativeEvent.isComposing && !composing.current) onFinish(true);
            return;
          }
          // ⌘B: the selected words bold / normal (`**…**` in the text); with nothing selected all of the shape's text (same edit session).
          if ((event.metaKey || event.ctrlKey) && event.code === "KeyB") {
            event.preventDefault();
            if (event.nativeEvent.isComposing || composing.current) return;
            if (!boldSelection((next) => onChange({ ...draft, text: next }))) onChange({ ...draft, bold: !draft.bold });
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (!event.nativeEvent.isComposing && !composing.current && onFinish(true)) void useEditorStore.getState().save();
          }
        }}
      />
    </div>
  </div>
  </>;
}
