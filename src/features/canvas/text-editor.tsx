"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { TextNode } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { worldToScreen } from "@/domain/document/camera";
import { LIMITS } from "@/domain/document/limits";
import { useEditorStore } from "@/features/editor/store";
import { CANVAS_FONT } from "./font-metrics";

export type TextSession = { slideId: string; before: TextNode | null; draft: TextNode };

/**
 * DOM text editor overlay (plan03 §7). One focus session = one document transaction.
 * The draft is persisted as a pendingEdit (500 ms debounce) and flushed on blur, Cmd+Enter,
 * Save/Export/slide change; Escape cancels and clears recovery.
 */
export function TextEditorOverlay({ session, camera, onChange, onFinish }: {
  session: TextSession;
  camera: Camera;
  onChange: (draft: TextNode) => void;
  onFinish: (commit: boolean) => boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const blurWhileComposing = useRef(false);
  const finishRef = useRef(onFinish);
  useLayoutEffect(() => { finishRef.current = onFinish; });
  const registerFlusher = useEditorStore((state) => state.registerFlusher);

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

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [session.draft.text, session.draft.width, session.draft.fontSize]);

  const { draft } = session;
  const origin = worldToScreen({ x: draft.x, y: draft.y }, camera);
  return <textarea
    ref={ref}
    aria-label="แก้ข้อความบนกระดาน"
    className="absolute z-30 resize-none overflow-hidden border-0 bg-white/80 p-0 outline outline-2 outline-blue-500"
    style={{
      left: origin.x, top: origin.y, width: draft.width,
      minHeight: draft.fontSize * draft.lineHeight,
      transform: `rotate(${draft.rotation}deg) scale(${camera.zoom})`, transformOrigin: "top left",
      fontFamily: `"${CANVAS_FONT}", sans-serif`, fontSize: draft.fontSize, lineHeight: draft.lineHeight,
      color: draft.color, textAlign: draft.align, whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}
    value={draft.text}
    spellCheck={false}
    onChange={(event) => {
      const text = event.target.value;
      if ([...text].length > LIMITS.textCodePoints) return;
      onChange({ ...draft, text });
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!event.nativeEvent.isComposing && !composing.current && onFinish(true)) void useEditorStore.getState().save();
      }
    }}
  />;
}
