"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { LIMITS } from "@/domain/document/limits";
import { hasBoldRuns, toggleBoldRange } from "@/domain/document/rich-text";

/**
 * ⌘B inside a text editor with part of the text selected: those words become bold / normal again by adding or
 * removing `**` markers around them (plan 03 §text). The textarea shows the markers while editing — the board
 * hides them. Returns `apply(element, setText)`: true when a selection was handled (also when there was nothing to
 * change, e.g. only spaces selected), false when nothing is selected (the caller toggles the whole box instead).
 * The selection is put back on the same words after the new text is rendered.
 */
export function useBoldSelection(ref: RefObject<HTMLTextAreaElement | null>, text: string) {
  const pending = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current, range = pending.current;
    if (!element || !range || element.value !== text) return;
    pending.current = null;
    element.setSelectionRange(range.start, range.end);
  }, [ref, text]);
  return (setText: (text: string) => void): boolean => {
    const element = ref.current;
    if (!element || element.selectionStart === element.selectionEnd) return false;
    const next = toggleBoldRange(element.value, element.selectionStart, element.selectionEnd, LIMITS.textCodePoints);
    if (next) {
      pending.current = { start: next.start, end: next.end };
      setText(next.text);
    }
    return true;
  };
}

/** A small note above the editor while the text holds bold markers: they are only shown while editing. */
export function BoldMarkerHint({ text, left, top }: { text: string; left: number; top: number }) {
  if (!hasBoldRuns(text)) return null;
  return <div role="note" className="pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-slate-800 px-2 py-0.5 text-xs text-white shadow"
    style={{ left, top: Math.max(2, top - 26) }}>** ** = ตัวหนา (กระดานไม่แสดงเครื่องหมาย) · เลือกคำ + ⌘B เพื่อสลับ</div>;
}
