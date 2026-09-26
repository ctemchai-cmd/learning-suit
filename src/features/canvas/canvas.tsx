"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Group, Layer, Line, Rect, Shape, Stage } from "react-konva";
import type Konva from "konva";
import type { Bounds, CanvasNode, Point, SlideDocument, TextNode } from "@/domain/document/model";
import { cloneNodes, isFlowWidget, isWidgetNode } from "@/domain/document/model";
import { getContentBounds, getNodeBounds } from "@/domain/document/geometry";
import { fitBounds, screenToWorld, zoomAt } from "@/domain/document/camera";
import type { Camera, PendingEdit } from "@/domain/document/session";
import { DEFAULTS } from "@/domain/document/limits";
import { freehandHitsForEraser } from "@/domain/document/hit-test";
import { getNodeFrame, translateNodes } from "@/domain/document/transform";
import { useEditorStore, type EditorTool } from "@/features/editor/store";
import { useFlowSession, type FlowPlay } from "@/features/flow/flow-session";
import { useGitSessionStore, type GitPreview, type GitTab, type GitTransferAnimation } from "@/features/git-simulator/session-store";
import { projectState } from "@/features/git-simulator/view-model";
import FavoriteToolbar, { type ToolbarPosition } from "./favorite-toolbar";
import { NodeBody } from "./node-view";
import { ensureCanvasFonts, konvaFontMetrics, resetFontMetricsCache } from "./font-metrics";
import { constrainPoint, freehandNode, isStepTool, stepNode, type StepTool } from "./draw-tools";
import { GitCanvasOverlay } from "./git-overlay";
import { LaserPointer, type LaserHandle } from "./laser-pointer";
import { TextEditorOverlay, type TextSession } from "./text-editor";
import { TransformOverlay } from "./transform-overlay";

type Gesture =
  | { kind: "pending-select"; pointerId: number; screen: Point; world: Point; ids: string[]; clone: boolean; toggleId: string | null; zoom: number }
  | { kind: "moving"; pointerId: number; screen: Point; world: Point; ids: string[]; clone: boolean; dx: number; dy: number; zoom: number }
  | { kind: "marquee"; pointerId: number; start: Point; current: Point; additive: boolean; previousIds: string[]; screen: Point }
  | { kind: "drawing"; pointerId: number; tool: "pen" | "highlighter"; samples: Point[]; zoom: number; lastScreen: Point }
  | { kind: "erasing"; pointerId: number; path: Point[]; hits: Set<string> }
  | { kind: "panning"; pointerId: number; screen: Point; camera: Camera }
  /** Text/shape tools. Shapes: a click places a point; pressing and dragging draws from `start` (then `dragging`). */
  | { kind: "click"; pointerId: number; screen: Point; start: Point; dragging: boolean };

type StepDraft = { slideId: string; tool: StepTool; toolVersion: number; start: Point; current: Point; drag?: true };
type MovePreview = { ids: string[]; dx: number; dy: number; clone: boolean } | null;

const boundsCache = new WeakMap<CanvasNode, Bounds>();
function cachedBounds(node: CanvasNode): Bounds {
  let bounds = boundsCache.get(node);
  if (!bounds) { bounds = getNodeBounds(node, konvaFontMetrics); boundsCache.set(node, bounds); }
  return bounds;
}
const intersects = (a: Bounds, b: Bounds) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
/** Keys belong to the canvas only when focus is on the page itself or the canvas viewport. */
const canvasOwnsKeys = (event: KeyboardEvent) => {
  if (event.defaultPrevented || document.querySelector("[role=dialog],[role=alertdialog]")) return false;
  const target = event.target;
  if (isEditableTarget(target)) return false;
  if (target instanceof HTMLElement && target !== document.body && target.closest("button, a, [role=tab], [role=separator], [role=slider], [role=menu], [role=listbox]")) return false;
  return true;
};

const DocNode = memo(function DocNode({ node, listening, hitWidth, gitTab, gitTransfer, gitPreview, flowPlay }: {
  node: CanvasNode; listening: boolean; hitWidth: number;
  gitTab: GitTab | null; gitTransfer: GitTransferAnimation | null; gitPreview: GitPreview | null; flowPlay: FlowPlay | null;
}) {
  return <Group id={node.id} name="doc-node" x={node.x} y={node.y} rotation={node.rotation} opacity={node.opacity} listening={listening}>
    <NodeBody node={node} hitWidth={hitWidth} git={node.type === "git-simulator" ? { activeTab: gitTab, transfer: gitTransfer, preview: gitPreview } : undefined}
      flow={flowPlay} />
  </Group>;
});

/** A Git widget drawn with the file being typed on the board, so its status updates while typing. */
function withGitDraft(node: CanvasNode, edit: PendingEdit | null): CanvasNode {
  if (node.type !== "git-simulator" || edit?.kind !== "git-file" || edit.nodeId !== node.id) return node;
  const projection = projectState(node.state, edit.machine, edit.draft);
  return projection.state === node.state ? node : { ...node, state: projection.state };
}

function GridLayer({ camera, size }: { camera: Camera; size: { width: number; height: number } }) {
  const spacing = camera.zoom >= 0.5 ? 40 : camera.zoom >= 0.2 ? 200 : 1000;
  return <Layer listening={false}>
    <Shape sceneFunc={(context) => {
      const step = spacing * camera.zoom;
      if (step < 8) return;
      const offsetX = ((camera.x % step) + step) % step, offsetY = ((camera.y % step) + step) % step;
      context.fillStyle = "rgba(100,116,139,0.18)";
      for (let x = offsetX; x < size.width; x += step) {
        for (let y = offsetY; y < size.height; y += step) context.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }} />
  </Layer>;
}

export default function Canvas({ slide, favorites, toolbarPosition, onToolbarPositionChange, onImageFiles, onRequestImagePicker, onWidgetSelected }: {
  slide: SlideDocument;
  /** A teaching widget was clicked: show its panel (the editor knows where the panel lives in this layout). */
  onWidgetSelected: () => void;
  favorites: EditorTool[];
  toolbarPosition: ToolbarPosition;
  onToolbarPositionChange: (position: ToolbarPosition) => void;
  onImageFiles: (files: File[], world: Point | null) => void;
  onRequestImagePicker: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const previewLineRef = useRef<Konva.Line>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastPress = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const nudge = useRef<{ start: CanvasNode[]; dx: number; dy: number } | null>(null);
  const laserRef = useRef<LaserHandle | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<{ start: Point; current: Point } | null>(null);
  const [movePreview, setMovePreview] = useState<MovePreview>(null);
  const [erasing, setErasing] = useState<Set<string> | null>(null);
  const [freehandPreview, setFreehandPreview] = useState<{ tool: "pen" | "highlighter" } | null>(null);
  const [stepDraft, setStepDraft] = useState<StepDraft | null>(null);
  const [transformPreview, setTransformPreview] = useState<CanvasNode[] | null>(null);
  const [nudgePreview, setNudgePreview] = useState<CanvasNode[] | null>(null);
  const [textSession, setTextSession] = useState<TextSession | null>(null);
  const textSessionRef = useRef<TextSession | null>(null);
  const [fontsVersion, setFontsVersion] = useState(0);

  const tool = useEditorStore((state) => state.tool);
  const toolVersion = useEditorStore((state) => state.toolVersion);
  const storedCamera = useEditorStore((state) => state.cameras[slide.id]);
  const setCamera = useEditorStore((state) => state.setCamera);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const setSelectedIds = useEditorStore((state) => state.setSelectedIds);
  const transact = useEditorStore((state) => state.transact);
  const setTool = useEditorStore((state) => state.setTool);
  const writable = useEditorStore((state) => state.writable);
  const keepDrawing = useEditorStore((state) => state.keepDrawing);
  const toolDefaults = useEditorStore((state) => state.toolDefaults);
  const propertyPreview = useEditorStore((state) => state.propertyPreview);
  const setGestureActive = useEditorStore((state) => state.setGestureActive);
  const setPendingEdit = useEditorStore((state) => state.setPendingEdit);
  const pendingEdit = useEditorStore((state) => state.pendingEdit);
  const gitTabs = useGitSessionStore((state) => state.tabs);
  const gitTransfers = useGitSessionStore((state) => state.transfers);
  const gitPreviews = useGitSessionStore((state) => state.preview);
  const flowPlays = useFlowSession((state) => state.plays);

  const camera = useMemo<Camera>(() => storedCamera ?? { x: size.width / 2, y: size.height / 2, zoom: 1 }, [storedCamera, size.width, size.height]);
  const cameraRef = useRef(camera);
  useLayoutEffect(() => { cameraRef.current = camera; });

  // ------------------------------------------------------------------ fonts & viewport
  useEffect(() => {
    let active = true;
    void ensureCanvasFonts().then(() => { if (active) { resetFontMetricsCache(); setFontsVersion((value) => value + 1); } });
    return () => { active = false; };
  }, []);

  const cancelGesture = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current && containerRef.current?.hasPointerCapture(current.pointerId)) containerRef.current.releasePointerCapture(current.pointerId);
    setMarquee(null); setMovePreview(null); setErasing(null); setFreehandPreview(null);
    if (current) setGestureActive(false);
  }, [setGestureActive]);

  // Unmount (slide switch, undo to another slide) must not leave a half gesture or a stuck blocker.
  useEffect(() => () => {
    if (gesture.current || nudge.current) useEditorStore.getState().setGestureActive(false);
    gesture.current = null;
    nudge.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
  }, []);

  const sizeRef = useRef(size);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      const previous = sizeRef.current;
      if (next.width === previous.width && next.height === previous.height) return;
      sizeRef.current = next;
      // Cancel any uncommitted gesture before the coordinate frame changes (plan03 §1).
      if (gesture.current) cancelGesture();
      const state = useEditorStore.getState();
      const current = state.cameras[slide.id];
      if (current && previous.width && previous.height) {
        // Keep the world point at the viewport center fixed.
        state.setCamera(slide.id, { ...current, x: current.x + (next.width - previous.width) / 2, y: current.y + (next.height - previous.height) / 2 });
      }
      setSize(next);
      state.setViewport(next);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [slide.id, cancelGesture]);

  // ------------------------------------------------------------------ derived render data
  const overrides = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    const apply = (nodes: CanvasNode[] | null | undefined) => nodes?.forEach((node) => map.set(node.id, node));
    if (propertyPreview?.slideId === slide.id) apply(propertyPreview.nodes);
    apply(nudgePreview);
    apply(transformPreview);
    return map;
  }, [propertyPreview, nudgePreview, transformPreview, slide.id]);

  const displayNodes = useMemo(() => slide.nodes.map((node) => {
    const override = overrides.get(node.id) ?? node;
    if (movePreview && !movePreview.clone && movePreview.ids.includes(node.id)) return { ...override, x: override.x + movePreview.dx, y: override.y + movePreview.dy } as CanvasNode;
    return override;
  }), [slide.nodes, overrides, movePreview]);

  const viewportWorld = useMemo<Bounds>(() => {
    const margin = 100 / camera.zoom;
    const topLeft = screenToWorld({ x: 0, y: 0 }, camera);
    return { x: topLeft.x - margin, y: topLeft.y - margin, width: size.width / camera.zoom + 2 * margin, height: size.height / camera.zoom + 2 * margin };
  }, [camera, size]);

  const selectable = tool === "select" && !spaceDown;
  const hitWidth = 8 / camera.zoom;
  const selectedNodes = useMemo(() => displayNodes.filter((node) => selectedIds.includes(node.id) && !node.locked), [displayNodes, selectedIds]);
  const content = useMemo(() => getContentBounds(slide.nodes, konvaFontMetrics),
    // fontsVersion invalidates text measurements once the webfont is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slide.nodes, fontsVersion]);

  // ------------------------------------------------------------------ helpers
  const pointerOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const nodeAt = (screen: Point): CanvasNode | null => {
    let shape: Konva.Node | null = stageRef.current?.getIntersection(screen) ?? null;
    while (shape && shape.name() !== "doc-node") shape = shape.getParent();
    const id = shape?.id();
    return id ? slide.nodes.find((node) => node.id === id && !node.locked) ?? null : null;
  };
  const schedule = (update: () => void) => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; update(); });
  };
  const beginGesture = (next: Gesture, event: ReactPointerEvent<HTMLDivElement>) => {
    gesture.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGestureActive(true);
  };
  const endGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    gesture.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setGestureActive(false);
  };

  const openText = (session: TextSession) => {
    textSessionRef.current = session;
    setTextSession(session);
    setPendingEdit({ kind: "text", slideId: session.slideId, nodeId: session.draft.id, before: session.before, draft: session.draft });
  };
  const finishText = (commit: boolean): boolean => {
    const session = textSessionRef.current;
    if (!session) return true;
    // Claim the session first: selection changes below flush pending edits, which must not
    // re-enter and commit this session a second time.
    textSessionRef.current = null;
    const state = useEditorStore.getState();
    const { before, draft } = session;
    let select: string | null = null;
    if (commit && state.writable) {
      let ok = true;
      if (before) {
        const found = state.history?.content.document.slides.find((item) => item.id === session.slideId)?.nodes.find((node) => node.id === before.id);
        const current = found?.type === "text" ? found : null;
        if (current && draft.text !== current.text) {
          ok = state.transact(draft.text.trim()
            ? { label: "แก้ข้อความ", affectedSlideId: session.slideId, commands: [{ type: "nodes.replace", slideId: session.slideId, nodes: [{ ...current, text: draft.text }] }] }
            : { label: "ลบข้อความ", affectedSlideId: session.slideId, commands: [{ type: "nodes.remove", slideId: session.slideId, ids: [before.id] }] });
        }
      } else if (draft.text.trim()) {
        ok = state.transact({ label: "เพิ่มข้อความ", affectedSlideId: session.slideId, commands: [{ type: "nodes.insert", slideId: session.slideId, nodes: [draft] }] });
        if (ok) select = draft.id;
      }
      if (!ok) { textSessionRef.current = session; return false; }
    }
    setTextSession(null);
    state.setPendingEdit(null);
    if (select) {
      state.setSelectedIds([select]);
      if (!state.keepDrawing) state.setTool("select");
    }
    return true;
  };

  // Recovered pending text draft after reload (PST-03 / TXT-03).
  const recoveredEdit = useEditorStore((state) => state.recoveredEdit);
  useEffect(() => {
    if (!recoveredEdit || recoveredEdit.kind !== "text" || recoveredEdit.slideId !== slide.id || textSessionRef.current) return;
    const edit = useEditorStore.getState().consumeRecoveredEdit();
    if (edit?.kind !== "text") return;
    // Opening the recovered editor is the purpose of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openText({ slideId: edit.slideId, before: edit.before, draft: edit.draft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveredEdit, slide.id]);

  const startEditingText = (node: TextNode) => {
    if (!writable || node.locked || textSessionRef.current?.draft.id === node.id) return;
    setSelectedIds([node.id]);
    openText({ slideId: slide.id, before: node, draft: structuredClone(node) });
  };

  // ------------------------------------------------------------------ pointer handling
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement)) return;
    if (gesture.current || (event.button !== 0 && event.button !== 1)) return;
    // Any open Text/Git DOM draft is flushed (or refuses) before the canvas changes selection.
    if (!useEditorStore.getState().flushPendingEdits()) return;
    const screen = pointerOf(event);
    const world = screenToWorld(screen, camera);
    if (event.button === 1 || spaceDown || tool === "hand") {
      event.preventDefault();
      beginGesture({ kind: "panning", pointerId: event.pointerId, screen, camera }, event);
      return;
    }
    if (tool === "select") {
      const hit = nodeAt(screen);
      // Double-click detection from pointerdown: with pointer capture some engines (WebKit) do not
      // deliver dblclick to the viewport, so the second press on the same text node opens the editor.
      const previous = lastPress.current;
      lastPress.current = hit ? { id: hit.id, time: event.timeStamp, x: screen.x, y: screen.y } : null;
      if (hit?.type === "text" && previous?.id === hit.id && event.timeStamp - previous.time < 450 && Math.hypot(screen.x - previous.x, screen.y - previous.y) < 6) {
        lastPress.current = null;
        // Suppress the compatibility mousedown so its default focus change cannot blur the new editor.
        event.preventDefault();
        startEditingText(hit);
        return;
      }
      if (hit) {
        let ids = selectedIds;
        let toggleId: string | null = null;
        if (event.shiftKey) {
          if (selectedIds.includes(hit.id)) toggleId = hit.id;
          else ids = [...selectedIds, hit.id];
        } else if (!selectedIds.includes(hit.id)) ids = [hit.id];
        if (ids !== selectedIds) setSelectedIds(ids);
        if (isWidgetNode(hit)) onWidgetSelected();
        beginGesture({ kind: "pending-select", pointerId: event.pointerId, screen, world, ids, clone: event.altKey, toggleId, zoom: camera.zoom }, event);
      } else {
        beginGesture({ kind: "marquee", pointerId: event.pointerId, start: world, current: world, additive: event.shiftKey, previousIds: selectedIds, screen }, event);
      }
      return;
    }
    // The laser only points: no selection, no drawing, nothing saved.
    if (tool === "laser") return;
    if (!writable) return;
    if (tool === "pen" || tool === "highlighter") {
      beginGesture({ kind: "drawing", pointerId: event.pointerId, tool, samples: [world], zoom: camera.zoom, lastScreen: screen }, event);
      setFreehandPreview({ tool });
      previewLineRef.current?.points([world.x, world.y, world.x, world.y]);
      return;
    }
    if (tool === "eraser") {
      const hits = new Set(freehandHitsForEraser(slide.nodes, [world], 8 / camera.zoom));
      beginGesture({ kind: "erasing", pointerId: event.pointerId, path: [world], hits }, event);
      setErasing(new Set(hits));
      return;
    }
    const pending = stepDraft && stepDraft.slideId === slide.id && stepDraft.tool === tool && stepDraft.toolVersion === toolVersion ? stepDraft : null;
    beginGesture({ kind: "click", pointerId: event.pointerId, screen, start: pending?.start ?? world, dragging: false }, event);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    const screen = pointerOf(event);
    if (tool === "laser" && !spaceDown) laserRef.current?.move(screen);
    if (!current) {
      if (stepDraft && stepDraft.slideId === slide.id && stepDraft.tool === tool && stepDraft.toolVersion === toolVersion) {
        const world = screenToWorld(screen, camera);
        const point = event.shiftKey ? constrainPoint(stepDraft.tool, stepDraft.start, world) : world;
        schedule(() => setStepDraft((draft) => draft ? { ...draft, current: point } : draft));
      }
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    const world = screenToWorld(screen, camera);
    switch (current.kind) {
      case "panning": {
        const next = { ...current.camera, x: current.camera.x + screen.x - current.screen.x, y: current.camera.y + screen.y - current.screen.y };
        schedule(() => setCamera(slide.id, next));
        return;
      }
      case "pending-select": {
        if (Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) < DEFAULTS.cloneThresholdPx || !writable) return;
        const ids = current.ids.filter((id) => slide.nodes.some((node) => node.id === id && !node.locked));
        if (!ids.length) return;
        gesture.current = { kind: "moving", pointerId: current.pointerId, screen: current.screen, world: current.world, ids, clone: current.clone, dx: 0, dy: 0, zoom: current.zoom };
        return onPointerMove(event);
      }
      case "moving": {
        let dx = world.x - current.world.x, dy = world.y - current.world.y;
        if (event.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
        current.dx = dx; current.dy = dy;
        schedule(() => setMovePreview({ ids: current.ids, dx: current.dx, dy: current.dy, clone: current.clone }));
        return;
      }
      case "marquee": {
        current.current = world;
        if (Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) < DEFAULTS.cloneThresholdPx) return;
        schedule(() => setMarquee({ start: current.start, current: current.current }));
        return;
      }
      case "drawing": {
        const events = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [];
        const samples = events.length ? events.map((item) => pointerOf(item)) : [screen];
        for (const sample of samples) {
          if (Math.hypot(sample.x - current.lastScreen.x, sample.y - current.lastScreen.y) < 0.8) continue;
          current.lastScreen = sample;
          current.samples.push(screenToWorld(sample, camera));
        }
        schedule(() => {
          const line = previewLineRef.current;
          if (!line) return;
          const points = current.samples.length === 1 ? [current.samples[0], current.samples[0]] : current.samples;
          line.points(points.flatMap((point) => [point.x, point.y]));
          line.getLayer()?.batchDraw();
        });
        return;
      }
      case "erasing": {
        const last = current.path.at(-1)!;
        current.path.push(world);
        for (const id of freehandHitsForEraser(slide.nodes, [last, world], 8 / camera.zoom)) current.hits.add(id);
        schedule(() => setErasing(new Set(current.hits)));
        return;
      }
      case "click": {
        // Press-drag-release also draws a shape (like most drawing apps); the two-click way still works.
        if (!isStepTool(tool) || !writable) return;
        if (!current.dragging && Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) <= 6) return;
        if (!current.dragging) { current.dragging = true; setSelectedIds([]); }
        const point = event.shiftKey ? constrainPoint(tool, current.start, world) : world;
        const start = current.start;
        schedule(() => setStepDraft({ slideId: slide.id, tool, toolVersion, start, current: point, drag: true }));
        return;
      }
    }
  };

  /** Inserts the finished shape; afterwards the new shape is selected unless “วาดต่อเนื่อง” is on. */
  const finishStep = (stepTool: StepTool, start: Point, point: Point): void => {
    const node = stepNode(stepTool, start, point, camera.zoom, crypto.randomUUID(), toolDefaults);
    if (!node) return;
    setStepDraft(null);
    if (transact({ label: "วาดรูปทรง", affectedSlideId: slide.id, commands: [{ type: "nodes.insert", slideId: slide.id, nodes: [node] }] })) {
      if (!keepDrawing) { setTool("select"); setSelectedIds([node.id]); }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const screen = pointerOf(event);
    const world = screenToWorld(screen, camera);
    endGesture(event);
    switch (current.kind) {
      case "panning": {
        setCamera(slide.id, { ...current.camera, x: current.camera.x + screen.x - current.screen.x, y: current.camera.y + screen.y - current.screen.y });
        return;
      }
      case "pending-select": {
        if (current.toggleId) setSelectedIds(selectedIds.filter((id) => id !== current.toggleId));
        return;
      }
      case "moving": {
        setMovePreview(null);
        let dx = world.x - current.world.x, dy = world.y - current.world.y;
        if (event.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
        if (Math.hypot(dx, dy) < 1e-6) return;
        const nodes = slide.nodes.filter((node) => current.ids.includes(node.id));
        if (current.clone) {
          const copies = cloneNodes(nodes, dx, dy);
          if (transact({ label: "ทำสำเนาวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.insert", slideId: slide.id, nodes: copies }] })) setSelectedIds(copies.map((node) => node.id));
        } else {
          transact({ label: "ย้ายวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.replace", slideId: slide.id, nodes: translateNodes(nodes, dx, dy) }] });
        }
        return;
      }
      case "marquee": {
        setMarquee(null);
        if (Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) < DEFAULTS.cloneThresholdPx) {
          if (!current.additive) setSelectedIds([]);
          return;
        }
        const box: Bounds = {
          x: Math.min(current.start.x, world.x), y: Math.min(current.start.y, world.y),
          width: Math.abs(world.x - current.start.x), height: Math.abs(world.y - current.start.y),
        };
        const hits = slide.nodes.filter((node) => !node.locked && intersects(cachedBounds(node), box)).map((node) => node.id);
        setSelectedIds(current.additive ? [...new Set([...current.previousIds, ...hits])] : hits);
        return;
      }
      case "drawing": {
        setFreehandPreview(null);
        if (Math.hypot(screen.x - current.lastScreen.x, screen.y - current.lastScreen.y) >= 0.8) current.samples.push(world);
        const node = freehandNode(current.tool, current.samples, current.zoom, crypto.randomUUID(), toolDefaults);
        transact({ label: current.tool === "pen" ? "วาดปากกา" : "วาดไฮไลต์", affectedSlideId: slide.id, commands: [{ type: "nodes.insert", slideId: slide.id, nodes: [node] }] });
        return;
      }
      case "erasing": {
        setErasing(null);
        const ids = [...current.hits].filter((id) => slide.nodes.some((node) => node.id === id && !node.locked));
        if (ids.length) transact({ label: "ลบเส้นด้วยยางลบ", affectedSlideId: slide.id, commands: [{ type: "nodes.remove", slideId: slide.id, ids }] });
        return;
      }
      case "click": {
        if (current.dragging && isStepTool(tool)) {
          setStepDraft(null); // a drag too small to make a shape just disappears
          finishStep(tool, current.start, event.shiftKey ? constrainPoint(tool, current.start, world) : world);
          return;
        }
        if (Math.hypot(screen.x - current.screen.x, screen.y - current.screen.y) > 6) return;
        if (tool === "text") {
          const hit = nodeAt(screen);
          if (hit?.type === "text") { startEditingText(hit); return; }
          setSelectedIds([]);
          const text = toolDefaults.text;
          openText({
            slideId: slide.id, before: null,
            draft: {
              id: crypto.randomUUID(), type: "text", x: world.x, y: world.y, rotation: 0, opacity: 1, locked: false,
              text: "", width: DEFAULTS.textWidth, fontFamily: DEFAULTS.fontFamily, fontSize: text.fontSize, lineHeight: DEFAULTS.lineHeight,
              color: text.color, align: "left",
            },
          });
          return;
        }
        if (!isStepTool(tool)) return;
        const active = stepDraft && stepDraft.slideId === slide.id && stepDraft.tool === tool && stepDraft.toolVersion === toolVersion ? stepDraft : null;
        if (!active) {
          setSelectedIds([]);
          setStepDraft({ slideId: slide.id, tool, toolVersion, start: world, current: world });
          return;
        }
        finishStep(active.tool, active.start, event.shiftKey ? constrainPoint(active.tool, active.start, world) : world);
        return;
      }
    }
  };

  const onPointerCancel = () => cancelGesture();

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // Pointer capture retargets the click/dblclick to the viewport container.
    if (tool !== "select" || !(event.target instanceof HTMLCanvasElement || event.target === event.currentTarget)) return;
    const hit = nodeAt(pointerOf(event));
    if (hit?.type === "text") startEditingText(hit);
  };

  const onWheel = useCallback((event: WheelEvent) => {
    if (!(event.target instanceof HTMLCanvasElement)) return;
    event.preventDefault();
    // Keep the coordinate frame stable during any gesture (draw, move, transform handles, nudge).
    if (gesture.current || useEditorStore.getState().gestureActive) return;
    const state = useEditorStore.getState();
    const current = cameraRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    const pointer = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (rect?.height ?? 800) : 1;
    let dx = event.deltaX * unit, dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      state.setCamera(slide.id, zoomAt(current, pointer, current.zoom * Math.exp(-dy * 0.01)));
      return;
    }
    if (event.shiftKey && dx === 0) { dx = dy; dy = 0; }
    state.setCamera(slide.id, { ...current, x: current.x - dx, y: current.y - dy });
  }, [slide.id]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  // ------------------------------------------------------------------ keyboard (Space, Escape, nudge)
  const commitNudge = useCallback(() => {
    const active = nudge.current;
    nudge.current = null;
    setNudgePreview(null);
    const state = useEditorStore.getState();
    if (active) state.setGestureActive(false);
    if (!active || (active.dx === 0 && active.dy === 0)) return;
    state.transact({ label: "ขยับวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.replace", slideId: slide.id, nodes: translateNodes(active.start, active.dx, active.dy) }] });
  }, [slide.id]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!canvasOwnsKeys(event) || event.metaKey || event.ctrlKey) return;
      if (event.code === "Space") { if (!event.repeat) setSpaceDown(true); event.preventDefault(); return; }
      if (event.key === "Escape") {
        if (gesture.current || stepDraft || nudge.current) {
          event.preventDefault(); event.stopImmediatePropagation();
          cancelGesture();
          setStepDraft(null);
          if (nudge.current) { nudge.current = null; setNudgePreview(null); useEditorStore.getState().setGestureActive(false); }
        }
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = arrows[event.key];
      if (!direction) return;
      const state = useEditorStore.getState();
      if (!state.writable || gesture.current) return;
      const nodes = slide.nodes.filter((node) => state.selectedIds.includes(node.id) && !node.locked);
      if (!nodes.length) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (!nudge.current) state.setGestureActive(true);
      nudge.current ??= { start: nodes, dx: 0, dy: 0 };
      nudge.current.dx += direction[0] * step;
      nudge.current.dy += direction[1] * step;
      setNudgePreview(translateNodes(nudge.current.start, nudge.current.dx, nudge.current.dy));
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
      if (event.key.startsWith("Arrow") && nudge.current) commitNudge();
    };
    const blur = () => { setSpaceDown(false); cancelGesture(); if (nudge.current) commitNudge(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [slide.nodes, stepDraft, cancelGesture, commitNudge]);

  // Changing tool or slide cancels a pending two-click draft.
  const activeStep = stepDraft && stepDraft.slideId === slide.id && stepDraft.tool === tool && stepDraft.toolVersion === toolVersion ? stepDraft : null;

  // ------------------------------------------------------------------ render
  const stepPreview = activeStep ? stepNode(activeStep.tool, activeStep.start, activeStep.current, camera.zoom, "preview", toolDefaults) : null;
  const clonePreview = movePreview?.clone ? displayNodes.filter((node) => movePreview.ids.includes(node.id)).map((node) => ({ ...node, x: node.x + movePreview.dx, y: node.y + movePreview.dy } as CanvasNode)) : [];
  const showHandles = selectable && writable && !movePreview && !textSession && selectedNodes.length > 0;
  // File editor and commit buttons of the one selected Git widget (hidden while it is being moved/resized).
  const selectedGit = tool === "select" && selectedNodes.length === 1 && selectedNodes[0].type === "git-simulator" && !selectedNodes[0].locked
    && !movePreview && !transformPreview && !nudgePreview && !textSession ? selectedNodes[0] : null;
  const handleNodes = transformPreview ?? selectedNodes;
  const freehandStyle = freehandPreview ? (freehandPreview.tool === "pen" ? toolDefaults.pen : toolDefaults.highlighter) : null;
  const cursor = spaceDown || tool === "hand" ? "grab" : tool === "laser" ? "none" : tool === "select" ? "default" : tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair";

  return <div ref={containerRef} data-testid="canvas-viewport" className="relative h-full w-full touch-none select-none overflow-hidden outline-none"
    style={{ background: slide.background, cursor }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onLostPointerCapture={(event) => { if (gesture.current?.pointerId === event.pointerId) cancelGesture(); }}
    onPointerLeave={() => laserRef.current?.hide()}
    onDoubleClick={onDoubleClick}
    onDragOver={(event) => { if (writable && [...event.dataTransfer.items].some((item) => item.kind === "file")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
    onDrop={(event) => {
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      event.preventDefault();
      onImageFiles(files, screenToWorld(pointerOf(event), camera));
    }}>
    {size.width > 0 && <Stage ref={stageRef} width={size.width} height={size.height}>
      <GridLayer camera={camera} size={size} />
      <Layer x={camera.x} y={camera.y} scaleX={camera.zoom} scaleY={camera.zoom}>
        {displayNodes.map((node) => {
          if (textSession?.draft.id === node.id || erasing?.has(node.id)) return null;
          const moving = movePreview?.ids.includes(node.id);
          if (!moving && !selectedIds.includes(node.id) && !intersects(cachedBounds(node), viewportWorld)) return null;
          const git = node.type === "git-simulator";
          return <DocNode key={node.id} node={withGitDraft(node, pendingEdit)} listening={selectable && !node.locked} hitWidth={hitWidth}
            gitTab={git ? gitTabs[node.id] ?? "A" : null}
            gitTransfer={git ? gitTransfers[node.id] ?? null : null}
            gitPreview={git ? gitPreviews[node.id] ?? null : null}
            flowPlay={isFlowWidget(node) ? flowPlays[node.id] ?? null : null} />;
        })}
      </Layer>
      <Layer x={camera.x} y={camera.y} scaleX={camera.zoom} scaleY={camera.zoom} listening={false}>
        {clonePreview.map((node) => <Group key={`clone-${node.id}`} x={node.x} y={node.y} rotation={node.rotation} opacity={node.opacity}><NodeBody node={node} /></Group>)}
        {stepPreview && <Group x={stepPreview.x} y={stepPreview.y} opacity={0.85}><NodeBody node={stepPreview} /></Group>}
        {freehandStyle && <Line ref={previewLineRef} stroke={freehandStyle.stroke} strokeWidth={freehandStyle.strokeWidth}
          opacity={freehandPreview?.tool === "pen" ? DEFAULTS.penOpacity : DEFAULTS.highlighterOpacity} lineCap="round" lineJoin="round" tension={0} />}
        {selectedNodes.length > 50 && (() => {
          const union = getContentBounds(transformPreview ?? selectedNodes, konvaFontMetrics);
          return union && <Rect x={union.x} y={union.y} width={union.width} height={union.height} stroke="#2563EB" strokeWidth={1.5 / camera.zoom} dash={[5 / camera.zoom, 4 / camera.zoom]} />;
        })()}
        {/* Per-node outlines only for small selections; large selections show one union frame. */}
        {selectedNodes.length <= 50 && selectedNodes.map((node) => {
          const shown = transformPreview?.find((item) => item.id === node.id) ?? node;
          const frameBox = getNodeFrame(shown, konvaFontMetrics);
          return <Group key={`sel-${node.id}`} x={frameBox.center.x} y={frameBox.center.y} rotation={frameBox.rotation}>
            <Rect x={-frameBox.width / 2} y={-frameBox.height / 2} width={frameBox.width} height={frameBox.height}
              stroke="#2563EB" strokeWidth={1.5 / camera.zoom} dash={[5 / camera.zoom, 4 / camera.zoom]} />
          </Group>;
        })}
        {marquee && <Rect x={Math.min(marquee.start.x, marquee.current.x)} y={Math.min(marquee.start.y, marquee.current.y)}
          width={Math.abs(marquee.current.x - marquee.start.x)} height={Math.abs(marquee.current.y - marquee.start.y)}
          stroke="#2563EB" strokeWidth={1 / camera.zoom} fill="rgba(37,99,235,0.1)" dash={[6 / camera.zoom, 4 / camera.zoom]} />}
      </Layer>
    </Stage>}
    {showHandles && <TransformOverlay nodes={handleNodes} camera={camera} metrics={konvaFontMetrics} containerRef={containerRef}
      onPreview={setTransformPreview} onGesture={setGestureActive}
      onCommit={(nodes) => transact({ label: "ปรับขนาด/หมุนวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.replace", slideId: slide.id, nodes }] })} />}
    {tool === "laser" && <LaserPointer handleRef={laserRef} />}
    {/* The file editor is for the Select tool; with pen/shapes/text/eraser the board underneath takes the clicks. */}
    {selectedGit && tool === "select" && <GitCanvasOverlay node={selectedGit} slideId={slide.id} camera={camera} writable={writable} />}
    {activeStep && <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-slate-300 bg-white/95 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">{activeStep.drag ? "ปล่อยเพื่อจบ" : "คลิกจุดที่ 2 เพื่อจบ"} · Shift จัดมุม · Esc ยกเลิก</div>}
    {textSession && <TextEditorOverlay session={textSession} camera={camera}
      onChange={(draft) => {
        const next = { ...textSession, draft };
        textSessionRef.current = next;
        setTextSession(next);
        setPendingEdit({ kind: "text", slideId: next.slideId, nodeId: draft.id, before: next.before, draft });
      }}
      onFinish={finishText} />}
    <FavoriteToolbar favorites={favorites} position={toolbarPosition} viewport={size} onPositionChange={onToolbarPositionChange} onImage={onRequestImagePicker} />
    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm">{Math.round(camera.zoom * 100)}% · scroll เลื่อน · ⌘/pinch ซูม · Space ลากเลื่อน</div>
    <div className="absolute bottom-4 right-4 flex gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm" role="group" aria-label="การซูม">
      <button className="app-button icon-button" aria-label="ซูมออก" title="ซูมออก" onClick={() => setCamera(slide.id, zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, camera.zoom / 1.25))}>−</button>
      <button className="app-button px-3" title="รีเซ็ตเป็น 100% โดยคงจุดกลางจอ" onClick={() => setCamera(slide.id, zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, 1))}>100%</button>
      <button className="app-button px-3" title="ย่อ/ขยายให้เห็นทุกวัตถุ รวมวัตถุที่ล็อก" onClick={() => setCamera(slide.id, fitBounds(content, size, DEFAULTS.padding))}>พอดีเนื้อหา</button>
      <button className="app-button icon-button" aria-label="ซูมเข้า" title="ซูมเข้า" onClick={() => setCamera(slide.id, zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, camera.zoom * 1.25))}>+</button>
    </div>
  </div>;
}
