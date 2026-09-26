"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CodeNode } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { worldToScreen } from "@/domain/document/camera";
import { LIMITS } from "@/domain/document/limits";
import { CODE_LINE_HEIGHT, codeLayout, indentAfter } from "@/domain/document/code";
import { useEditorStore, type CodeEdit } from "@/features/editor/store";
import { konvaFontMetrics, MONO_STACK } from "./font-metrics";
import { CODE_THEMES } from "./code-view";

const TAB = "    ";
const fits = (code: string) => [...code].length <= LIMITS.codeCodePoints && code.split("\n").length <= LIMITS.codeLines;

/** Inserts text at the selection keeping the textarea's own Undo (execCommand), with a plain fallback. */
function insertText(element: HTMLTextAreaElement, text: string) {
  element.focus();
  // An empty insert over a whole line also eats the line break in WebKit: remove the selection directly instead.
  if (!text || !document.execCommand?.("insertText", false, text)) element.setRangeText(text, element.selectionStart, element.selectionEnd, "end");
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Typing into a code block (plan 03 §code). The textarea's text is transparent: the board underneath shows the
 * live, coloured preview in the same monospace layout. Tab / ⇧Tab indent / outdent (also several lines), Enter keeps
 * the indentation (one level deeper after `:` / `{`), Esc cancels, ⌘Enter or a click outside commits.
 * The draft is kept as a pending edit, so it survives a reload.
 */
export function CodeEditorOverlay({ node, edit, camera }: { node: CodeNode; edit: CodeEdit; camera: Camera }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => edit.draft ?? node.code);
  const done = useRef(false);
  const composing = useRef(false);
  const textRef = useRef(text);
  useLayoutEffect(() => { textRef.current = text; });
  const setPropertyPreview = useEditorStore((state) => state.setPropertyPreview);
  const setPendingEdit = useEditorStore((state) => state.setPendingEdit);
  const registerFlusher = useEditorStore((state) => state.registerFlusher);

  const finish = (commit: boolean): boolean => {
    if (done.current) return true;
    done.current = true;
    const state = useEditorStore.getState();
    state.setPropertyPreview(null);
    const found = state.history?.content.document.slides.find((slide) => slide.id === edit.slideId)?.nodes.find((item) => item.id === edit.nodeId);
    if (commit && found?.type === "code" && !found.locked && textRef.current !== found.code && state.writable) {
      const ok = state.transact({ label: "แก้โค้ด", affectedSlideId: edit.slideId, commands: [{ type: "nodes.replace", slideId: edit.slideId, nodes: [{ ...found, code: textRef.current }] }] });
      if (!ok) { done.current = false; return false; }
    }
    state.setPendingEdit(null);
    state.setCodeEdit(null);
    return true;
  };
  const finishRef = useRef(finish);
  useLayoutEffect(() => { finishRef.current = finish; });
  useEffect(() => registerFlusher(() => (composing.current ? false : finishRef.current(true))), [registerFlusher]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    if (edit.selectAll) element.select();
    else element.setSelectionRange(element.value.length, element.value.length);
  }, [edit.selectAll]);

  const draft = useMemo(() => (text === node.code ? node : { ...node, code: text }), [node, text]);
  // Live, coloured preview on the board + crash recovery of the draft.
  useEffect(() => {
    if (done.current) return;
    setPropertyPreview(draft === node ? null : { slideId: edit.slideId, nodes: [draft] });
    setPendingEdit(draft === node ? null : { kind: "code", slideId: edit.slideId, nodeId: node.id, before: node, draft });
  }, [draft, node, edit.slideId, setPropertyPreview, setPendingEdit]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const element = event.currentTarget;
    if (event.key === "Escape") { event.preventDefault(); finish(false); return; }
    if (event.nativeEvent.isComposing || composing.current) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); finish(true); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (finish(true)) void useEditorStore.getState().save();
      return;
    }
    const value = element.value, start = element.selectionStart, end = element.selectionEnd;
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      insertText(element, `\n${indentAfter(value.slice(lineStart, start), draft.language)}`);
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const firstLine = value.lastIndexOf("\n", start - 1) + 1;
    const multiLine = value.slice(start, end).includes("\n");
    if (!event.shiftKey && !multiLine) { insertText(element, TAB); return; }
    // Indent / outdent every line touched by the selection, then keep those lines selected.
    const lastEnd = value.indexOf("\n", end - (end > start && value[end - 1] === "\n" ? 1 : 0));
    const blockEnd = lastEnd === -1 ? value.length : lastEnd;
    const block = value.slice(firstLine, blockEnd);
    const changed = block.split("\n").map((line) => (event.shiftKey ? line.replace(/^ {1,4}/, "") : TAB + line)).join("\n");
    if (changed === block) return;
    element.setSelectionRange(firstLine, blockEnd);
    insertText(element, changed);
    element.setSelectionRange(firstLine, firstLine + changed.length);
  };

  const layout = codeLayout(draft, konvaFontMetrics);
  const theme = CODE_THEMES[node.theme];
  const origin = worldToScreen({ x: node.x, y: node.y }, camera);
  return <textarea
    ref={ref}
    aria-label="แก้โค้ด"
    className="absolute z-30 resize-none overflow-hidden border-0 bg-transparent outline outline-2 outline-blue-500"
    style={{
      left: origin.x, top: origin.y, width: layout.width, height: layout.height, boxSizing: "border-box", borderRadius: node.fontSize * 0.6,
      paddingTop: layout.header + layout.pad * 0.6, paddingLeft: layout.pad + layout.gutter, paddingRight: layout.pad, paddingBottom: 0,
      transform: `rotate(${node.rotation}deg) scale(${camera.zoom})`, transformOrigin: "top left",
      fontFamily: MONO_STACK, fontSize: node.fontSize, lineHeight: CODE_LINE_HEIGHT, whiteSpace: "pre", tabSize: 4,
      color: "transparent", caretColor: theme.colors.plain, fontVariantLigatures: "none",
    }}
    value={text}
    spellCheck={false}
    autoCapitalize="off"
    autoCorrect="off"
    onChange={(event) => { const next = event.target.value.replace(/\t/g, TAB); if (fits(next)) setText(next); }}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onBlur={() => { if (!composing.current) finish(true); }}
    onKeyDown={onKeyDown}
  />;
}
