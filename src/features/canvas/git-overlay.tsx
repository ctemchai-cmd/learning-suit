"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { gitViewOf, type GitSimulatorNode } from "@/domain/document/model";
import type { Camera } from "@/domain/document/session";
import { worldToScreen } from "@/domain/document/camera";
import type { MachineId, RepositoryId } from "@/domain/git/model";
import { repositoryLabel } from "@/domain/git/messages";
import { validateFileSnapshot } from "@/domain/git/selectors";
import { useEditorStore } from "@/features/editor/store";
import { commitGraph } from "@/features/git-simulator/diagram-model";
import { applyTextEdit, indentEdit, newlineEdit } from "@/features/git-simulator/code-edit";
import { cancelGitDraft, flushGitDraft, gitDraftComposition, gitDraftFor, gitFieldKey, updateGitDraft } from "@/features/git-simulator/git-draft";
import { useGitSessionStore } from "@/features/git-simulator/session-store";
import { draftErrorMessage } from "@/features/git-simulator/view-model";
import { EDITOR } from "@/features/git-simulator/git-widget-view";
import {
  codeText, commitRowBox, commitRowLimit, fileCodeBox, fileEditorBox, fileNameBox, machineOf, remoteCodeBox, remoteCodeText, viewRepositories,
  widgetLayout, widgetWidth, WIDGET_H,
  type Box, type WidgetLayout,
} from "@/features/git-simulator/widget-layout";
import { CANVAS_FONT } from "./font-metrics";

// DOM controls on top of a selected Git widget (plan 04 §5): the file is edited right where it is
// drawn, and each commit circle is a button that previews that commit's code. The container uses the
// widget's own base coordinates and the same transform as the canvas, so the drawing and the controls
// always line up (zoom, rotation, widget scale).

const at = (box: Box): CSSProperties => ({ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h });
const isComposing = (event: KeyboardEvent) => event.nativeEvent.isComposing || event.keyCode === 229;

function FileEditor({ node, slideId, machine, layout }: { node: GitSimulatorNode; slideId: string; machine: MachineId; layout: WidgetLayout }) {
  const draft = useEditorStore((state) => gitDraftFor(state.pendingEdit, node.id, machine));
  const blurWhileComposing = useRef(false);
  const working = node.state.machines[machine].working ?? { name: "", content: "" };
  const file = draft?.draft ?? working;
  const validation = draft ? validateFileSnapshot(draft.draft) : null;
  const error = validation && !validation.ok ? validation : null;
  const big = !layout.compact;
  const code = fileCodeBox(layout, machine)!;
  const name = fileNameBox(layout, machine)!;
  const editor = fileEditorBox(layout, machine)!;
  const column = machineOf(layout, machine)!.file;
  const metrics = codeText(layout);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = file.content.split("\n").length;
  const errorId = `git-file-error-${node.id}-${machine}`;
  const where = repositoryLabel(machine);

  const change = (patch: { name?: string; content?: string }) => updateGitDraft(slideId, node.id, machine, { ...file, ...patch });
  /** Leaving the editor applies a valid draft as one Edit; an invalid one stays with its error. */
  const finish = () => {
    const current = gitDraftFor(useEditorStore.getState().pendingEdit, node.id, machine);
    if (current && validateFileSnapshot(current.draft).ok) flushGitDraft();
  };
  const common = {
    spellCheck: false,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    onCompositionStart: () => { gitDraftComposition.active = true; },
    onCompositionEnd: () => {
      gitDraftComposition.active = false;
      if (blurWhileComposing.current) { blurWhileComposing.current = false; finish(); }
    },
    // In the two-machine step the panel follows the machine being edited, so Add/Commit act on it.
    onFocus: () => { if (gitViewOf(node) === "full") useGitSessionStore.getState().setTab(node.id, machine); },
    onBlur: () => {
      if (gitDraftComposition.active) blurWhileComposing.current = true;
      else finish();
    },
    // Other keys reach the editor, which ignores typing in fields but still honours Cmd+S (flush + save).
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (isComposing(event)) return;
      const field = event.currentTarget;
      const modifier = event.metaKey || event.ctrlKey || event.altKey;
      if (event.key === "Escape") {
        // Esc leaves the editor and keeps what was typed (one Undo step reverts it); an invalid draft stays open.
        event.preventDefault();
        event.stopPropagation();
        if (flushGitDraft()) field.blur();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey || field instanceof HTMLInputElement)) {
        event.preventDefault();
        event.stopPropagation();
        if (flushGitDraft()) field.blur();
      } else if (field instanceof HTMLTextAreaElement && event.key === "Tab" && !modifier) {
        event.preventDefault();
        applyTextEdit(field, indentEdit(field.value, field.selectionStart, field.selectionEnd, event.shiftKey));
      } else if (field instanceof HTMLTextAreaElement && event.key === "Enter" && !modifier && !event.shiftKey) {
        event.preventDefault();
        applyTextEdit(field, newlineEdit(field.value, field.selectionStart, field.selectionEnd));
      }
    },
  };
  const font = `"${CANVAS_FONT}", sans-serif`;
  // Same colours and metrics as the drawn editor (EDITOR, codeText) so selecting the widget changes nothing visually.
  return <div className="group contents">
    <input {...common} data-git-field={gitFieldKey(machine, "name")} aria-label={`ชื่อไฟล์บน${where}`} value={file.name}
      className="pointer-events-auto select-text border-0 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400"
      style={{ ...at(name), paddingLeft: 22, paddingRight: 8, fontFamily: font, fontSize: big ? 13 : 11, background: EDITOR.bg, color: EDITOR.text, caretColor: "#F8FAFC", borderRadius: big ? "10px 6px 0 0" : "10px 10px 0 0" }}
      onChange={(event) => change({ name: event.target.value })} />
    <span aria-hidden className="pointer-events-none rounded-full" style={{ ...at({ x: name.x + 12 - (big ? 4 : 3), y: name.y + name.h / 2 - (big ? 4 : 3), w: big ? 8 : 6, h: big ? 8 : 6 }), background: EDITOR.dot }} />
    {big && editor.w - name.w > 120 && <span aria-hidden className="pointer-events-none text-right text-[11px] text-slate-400 group-focus-within:invisible"
      style={{ ...at({ x: name.x + name.w + 8, y: name.y, w: editor.w - name.w - 18, h: name.h }), lineHeight: `${name.h}px`, fontFamily: font }}>✎ คลิกในกล่องเพื่อพิมพ์โค้ด</span>}
    <div className="pointer-events-auto overflow-hidden focus-within:ring-2 focus-within:ring-blue-400"
      style={{ ...at(code), background: EDITOR.bg, borderRadius: "0 0 10px 10px" }}>
      {metrics.gutter > 0 && <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-full overflow-hidden" style={{ width: metrics.gutter }}>
        <div ref={gutterRef} style={{ paddingTop: metrics.pad }}>
          {Array.from({ length: lineCount }, (_, index) => <div key={index} className="text-right"
            style={{ height: metrics.lineH, lineHeight: `${metrics.lineH}px`, paddingRight: 6, fontSize: metrics.gutterSize, fontFamily: font, color: EDITOR.gutter }}>{index + 1}</div>)}
        </div>
      </div>}
      <textarea {...common} data-git-field={gitFieldKey(machine, "content")} aria-label={`แก้ไฟล์บน${where}`} value={file.content}
        placeholder="พิมพ์โค้ดที่นี่" wrap="off"
        className="absolute top-0 h-full select-text resize-none overflow-auto border-0 bg-transparent outline-none placeholder:text-slate-500 selection:bg-blue-500/40"
        style={{ left: metrics.gutter, width: code.w - metrics.gutter, padding: metrics.pad, fontFamily: font, fontSize: metrics.size, lineHeight: `${metrics.lineH}px`, whiteSpace: "pre", tabSize: 4, color: EDITOR.text, caretColor: "#F8FAFC" }}
        onScroll={(event) => { if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`; }}
        onChange={(event) => change({ content: event.target.value })} />
    </div>
    {error && <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-red-50 px-2 text-red-700"
      style={{ ...at({ x: column.x + 10, y: column.y + column.h - 36, w: column.w - 20, h: 30 }), fontSize: big ? 13 : 11 }}>
      <p id={errorId} role="alert" className="min-w-0 flex-1 truncate">{draftErrorMessage(error)}</p>
      <button type="button" className="shrink-0 rounded px-1.5 py-0.5 font-semibold underline-offset-2 hover:bg-red-100 hover:underline" onClick={cancelGitDraft}>ยกเลิกการแก้</button>
    </div>}
  </div>;
}

/**
 * GitHub's file (read-only): the drawing shows the first lines; while the widget is selected this scrollable
 * copy on top lets the teacher show the whole pushed file. Same colours/metrics as the drawing.
 */
function RemoteFileViewer({ node, layout }: { node: GitSimulatorNode; layout: WidgetLayout }) {
  const preview = useGitSessionStore((state) => state.preview[node.id]);
  const state = node.state;
  const commitId = preview?.repository === "remote" && state.remote.knownCommitIds.includes(preview.commitId) ? preview.commitId : state.remote.mainHead;
  const file = commitId ? state.commits[commitId]?.snapshot : null;
  const gutterRef = useRef<HTMLDivElement>(null);
  if (!file) return null;
  const code = remoteCodeBox(layout)!;
  const metrics = remoteCodeText(layout);
  const font = `"${CANVAS_FONT}", sans-serif`;
  const lineCount = file.content.split("\n").length;
  return <div className="pointer-events-auto overflow-hidden focus-within:ring-2 focus-within:ring-blue-400" style={{ ...at(code), background: EDITOR.bg, borderRadius: "0 0 10px 10px" }}>
    {metrics.gutter > 0 && <div aria-hidden className="pointer-events-none absolute left-0 top-0 h-full overflow-hidden" style={{ width: metrics.gutter }}>
      <div ref={gutterRef} style={{ paddingTop: metrics.pad }}>
        {Array.from({ length: lineCount }, (_, index) => <div key={index} className="text-right"
          style={{ height: metrics.lineH, lineHeight: `${metrics.lineH}px`, paddingRight: 6, fontSize: metrics.gutterSize, fontFamily: font, color: EDITOR.gutter }}>{index + 1}</div>)}
      </div>
    </div>}
    <textarea readOnly wrap="off" spellCheck={false} value={file.content} aria-label={`โค้ดบน GitHub (${commitId}) อ่านอย่างเดียว`}
      className="absolute top-0 h-full cursor-default select-text resize-none overflow-auto border-0 bg-transparent outline-none selection:bg-blue-500/40"
      style={{ left: metrics.gutter, width: code.w - metrics.gutter, padding: metrics.pad, fontFamily: font, fontSize: metrics.size, lineHeight: `${metrics.lineH}px`, whiteSpace: "pre", tabSize: 4, color: EDITOR.text }}
      onScroll={(event) => { if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`; }} />
  </div>;
}

/**
 * Controls for the one selected, unlocked Git widget. Render only while no move/transform preview
 * is shown, so the controls never lag behind the drawing.
 */
export function GitCanvasOverlay({ node, slideId, camera, writable }: { node: GitSimulatorNode; slideId: string; camera: Camera; writable: boolean }) {
  const view = gitViewOf(node);
  const layout = widgetLayout(view);
  const preview = useGitSessionStore((state) => state.preview[node.id]);
  const setPreview = useGitSessionStore((state) => state.setPreview);
  const origin = worldToScreen({ x: node.x, y: node.y }, camera);
  const machines = (["A", "B"] as const).filter((machine) => machineOf(layout, machine) && node.state.machines[machine].initialized);

  const togglePreview = (repository: RepositoryId, commitId: string) => {
    // The board draft becomes the working file first, so "back to the file" shows the latest edit.
    if (!useEditorStore.getState().flushPendingEdits()) return;
    const same = preview?.repository === repository && preview.commitId === commitId;
    setPreview(node.id, same ? undefined : { repository, commitId });
    if (repository !== "remote" && view === "full") useGitSessionStore.getState().setTab(node.id, repository);
  };

  return <div data-testid="git-overlay" className="pointer-events-none absolute left-0 top-0 z-10"
    style={{ width: widgetWidth(view), height: WIDGET_H, transformOrigin: "0 0", transform: `translate(${origin.x}px, ${origin.y}px) rotate(${node.rotation}deg) scale(${camera.zoom * node.scale})` }}>
    {machines.map((machine) => preview?.repository === machine
      ? <button key={machine} type="button" aria-label={`กลับไปไฟล์ที่แก้อยู่ (${repositoryLabel(machine)})`} title="กลับไปไฟล์ที่แก้อยู่"
        className="pointer-events-auto cursor-pointer rounded-lg hover:bg-blue-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        style={at(fileEditorBox(layout, machine)!)} onClick={() => setPreview(node.id, undefined)} />
      : writable ? <FileEditor key={machine} node={node} slideId={slideId} machine={machine} layout={layout} /> : null)}
    {layout.remote && <RemoteFileViewer node={node} layout={layout} />}
    {viewRepositories(view).flatMap((repository) => commitGraph(node.state, repository, commitRowLimit(layout, repository)).rows.map((row, index) => {
      const selected = preview?.repository === repository && preview.commitId === row.id;
      const label = `${selected ? "เลิกดู" : "ดู"}โค้ดของ ${row.id} (${repositoryLabel(repository)})`;
      return <button key={`${repository}-${row.id}`} type="button" aria-label={label} title={label} aria-pressed={selected}
        className="pointer-events-auto cursor-pointer rounded-lg hover:bg-blue-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        style={at(commitRowBox(layout, repository, index)!)} onClick={() => togglePreview(repository, row.id)} />;
    }))}
  </div>;
}
