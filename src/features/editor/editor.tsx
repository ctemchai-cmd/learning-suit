"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, BetweenHorizontalEnd, Group as GroupIcon, Ungroup, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, BringToFront, ChevronLeft, ChevronRight, ClipboardPaste, Copy, CopyPlus, Download, Eraser, Expand, GraduationCap, Keyboard, Lock, PanelRightClose, PanelRightOpen, Pencil, Redo2, Save, SendToBack, SeparatorHorizontal, SquareDashedMousePointer, TextCursorInput, Trash2, Undo2, X } from "lucide-react";
import Canvas from "@/features/canvas/canvas";
import { ImageCache, ImageCacheContext } from "@/features/canvas/image-cache";
import { konvaFontMetrics } from "@/features/canvas/font-metrics";
import { DataPanel } from "@/features/data-simulator/data-panel";
import { DeployPanel } from "@/features/deploy-simulator/deploy-panel";
import { AiPanel } from "@/features/ai-simulator/ai-panel";
import { useFlowSession } from "@/features/flow/flow-session";
import { GitPanel } from "@/features/git-simulator/git-panel";
import { flushGitDraft } from "@/features/git-simulator/git-draft";
import { useGitSessionStore } from "@/features/git-simulator/session-store";
import { isWidgetNode, widgetNodeSize, type AssetReference, type CanvasNode, type Point, type CodeNode, type SlideDocument, type StencilNode, type TableNode, type TextNode, type WidgetNode } from "@/domain/document/model";
import { createSlide, duplicateSlide, nextSlideName } from "@/domain/document/model";
import { fitBounds, screenToWorld } from "@/domain/document/camera";
import { getContentBounds } from "@/domain/document/geometry";
import { initialImageSize } from "@/domain/document/image-rules";
import { DEFAULTS, LIMITS } from "@/domain/document/limits";
import { reorderNodeIds, type ZOrderAction } from "@/domain/document/z-order";
import { createInitialDataState } from "@/domain/data/initial";
import { createInitialDeployState } from "@/domain/deploy/initial";
import { createInitialAiState } from "@/domain/ai/initial";
import { createInitialGitState } from "@/domain/git/initial";
import { ingestImage } from "@/services/assets/ingest";
import { getLocalAsset, putLocalAsset, putThumbnail } from "@/services/persistence/local-db";
import { renderSlidePng } from "@/services/export/render";
import { onHistoryNavigate, useEditorStore, type CloudStatusView, type EditorTool, type LocalStatus, type ProjectOpener } from "./store";
import { DEFAULT_FAVORITES, TOOL_ITEMS, isActionTool } from "./tools";
import { favoriteForKey } from "./favorites";
import LeftPanel from "./left-panel";
import type { ToolbarPosition } from "@/features/canvas/favorite-toolbar";
import ObjectsPanel from "./objects-panel";
import PropertiesPanel from "./properties-panel";
import ExportDialog, { type ArchiveExporter } from "./export-dialog";
import { copyToClipboard, preparePaste } from "./clipboard";
import ShortcutHelp from "./shortcut-help";
import ContextMenu, { type MenuEntry } from "./context-menu";
import { EditorSkeleton } from "@/features/loading/skeletons";
import StencilPicker from "./stencil-picker";
import type { StencilSpec } from "@/domain/document/stencils";
import { codeLayout, DEFAULT_CODE } from "@/domain/document/code";
import { expandToGroups, groupNodes, isGrouped, ungroupNodes, withFreshGroups } from "@/domain/document/groups";
import { createClassBox, createGridTable, insertColumn, insertRow, removeColumn, removeRow, tableCellAt, tableLayout, toggleDivider } from "@/domain/document/table";

export type CloudUi = {
  useCloudVersion: () => Promise<void>;
  keepLocalCopy: () => Promise<void>;
  openLogin: () => void;
};

/** Simulator tab without a selected widget: pick an existing one first (a new widget is a new, empty lesson). */
function WidgetPanelEmpty({ slide, writable, onSelect, onInsert }: {
  slide: SlideDocument | undefined; writable: boolean; onSelect: (id: string) => void; onInsert: (kind: WidgetKind) => void;
}) {
  const unlocked = slide?.nodes.filter((node) => isWidgetNode(node) && !node.locked) ?? [];
  const git = unlocked.filter((node) => node.type === "git-simulator");
  const data = unlocked.filter((node) => node.type === "data-simulator");
  const deploy = unlocked.filter((node) => node.type === "deploy-simulator");
  const ai = unlocked.filter((node) => node.type === "ai-simulator");
  const pick = (list: CanvasNode[], name: string) => list.map((node, index) => <button key={node.id} className="app-button app-button-primary w-full" onClick={() => onSelect(node.id)}>
    {list.length > 1 ? `เลือก${name} ชิ้นที่ ${index + 1}` : `เลือก${name}ที่มีอยู่`}</button>);
  return <div className="space-y-3 p-4 text-sm">
    <p className="muted">{unlocked.length ? "เลือกตัวจำลองบนสไลด์นี้เพื่อใช้งาน" : "ยังไม่มีตัวจำลองบนสไลด์นี้"}</p>
    {pick(git, "ตัวจำลอง Git ")}
    {pick(data, "ตัวจำลองข้อมูล")}
    {pick(deploy, "ตัวจำลอง Deploy ")}
    {pick(ai, "ตัวจำลอง AI ")}
    <button className="app-button w-full" disabled={!writable} onClick={() => onInsert("git")}>{git.length ? "เพิ่มตัวจำลอง Git ใหม่" : "เพิ่มตัวจำลอง Git กลางจอ"}</button>
    <button className="app-button w-full" disabled={!writable} onClick={() => onInsert("data")}>{data.length ? "เพิ่มตัวจำลองข้อมูลใหม่" : "เพิ่มตัวจำลองข้อมูลกลางจอ"}</button>
    <button className="app-button w-full" disabled={!writable} onClick={() => onInsert("deploy")}>{deploy.length ? "เพิ่มตัวจำลอง Deploy ใหม่" : "เพิ่มตัวจำลอง Deploy กลางจอ"}</button>
    <button className="app-button w-full" disabled={!writable} onClick={() => onInsert("ai")}>{ai.length ? "เพิ่มตัวจำลอง AI ใหม่" : "เพิ่มตัวจำลอง AI กลางจอ"}</button>
  </div>;
}

type WidgetKind = "git" | "data" | "deploy" | "ai";

function reorderSelection(action: ZOrderAction) {
  const state = useEditorStore.getState();
  const slide = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
  if (!slide || !state.selectedIds.length) return;
  const orderedIds = reorderNodeIds(slide.nodes, state.selectedIds, action);
  if (orderedIds.every((id, index) => id === slide.nodes[index].id)) return;
  state.transact({ label: "จัดลำดับวัตถุ", affectedSlideId: slide.id, commands: [{ type: "nodes.reorder", slideId: slide.id, orderedIds }] });
}

/** What “ล้าง…” in the board menu removes (locked objects always stay). */
const CLEARABLE: Record<"freehand" | "drawings", ReadonlySet<CanvasNode["type"]>> = {
  freehand: new Set(["pen", "highlighter"]),
  drawings: new Set(["pen", "highlighter", "rectangle", "ellipse", "line", "arrow", "text", "stencil", "table", "code"]),
};

const FAVORITES_KEY = "learning-suit-favorites-v1";
const THUMBNAIL_NODE_LIMIT = 1500;
const TOOLBAR_KEY = "learning-suit-favorite-position-v1";
const RIGHT_PANEL_KEY = "learning-suit-right-panel-open-v1";
function readFavorites(): EditorTool[] {
  if (typeof window === "undefined") return DEFAULT_FAVORITES;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "null");
    if (Array.isArray(value) && value.every((id) => TOOL_ITEMS.some((item) => item.id === id))) return [...new Set(value)] as EditorTool[];
  } catch { /* Invalid local settings fall back to defaults. */ }
  return DEFAULT_FAVORITES;
}
function readToolbarPosition(): ToolbarPosition {
  if (typeof window === "undefined") return { x: 24, y: 20 };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TOOLBAR_KEY) ?? "null");
    if (value && typeof value === "object" && "x" in value && "y" in value && typeof value.x === "number" && typeof value.y === "number" && Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: value.x, y: value.y };
  } catch { /* Invalid local settings fall back to defaults. */ }
  return { x: 24, y: 20 };
}
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* device preference only */ } };

const timeFormat = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });
/** Status texts from plan01 "ข้อความสำคัญใน UI"; local and cloud states are never conflated. */
export function statusText(local: LocalStatus, cloud: CloudStatusView | null, editing: boolean, writable: boolean): { text: string; tone: "ok" | "busy" | "warn" | "error" } {
  if (!writable) return { text: "อ่านอย่างเดียว", tone: "warn" };
  if (local === "loading") return { text: "กำลังเปิด…", tone: "busy" };
  if (local === "error") return { text: "เก็บในเครื่องไม่สำเร็จ", tone: "error" };
  if (editing) return { text: "กำลังแก้ข้อความ", tone: "busy" };
  if (local === "writing") return { text: "กำลังเก็บในเครื่อง…", tone: "busy" };
  if (!cloud) return { text: "เก็บในเครื่องแล้ว", tone: "ok" };
  switch (cloud.kind) {
    case "pending": return { text: "กำลังบันทึก…", tone: "busy" };
    case "saved": return { text: cloud.at ? `บันทึกบน Cloud แล้ว ${timeFormat.format(new Date(cloud.at))}` : "บันทึกบน Cloud แล้ว", tone: "ok" };
    case "offline": return { text: "เก็บในเครื่องแล้ว · รอเชื่อมต่อ", tone: "warn" };
    case "error": return { text: "บันทึกบน Cloud ไม่สำเร็จ", tone: "error" };
    case "conflict": return { text: "มีงานจากอีกเครื่อง", tone: "error" };
    case "unavailable": return { text: "ไม่พบโปรเจกต์บน Cloud", tone: "error" };
    case "auth": return { text: "เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ", tone: "error" };
    case "stopped": return { text: "เก็บในเครื่องแล้ว", tone: "ok" };
  }
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => typeof window === "undefined" ? 1440 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export default function Editor({ ownerId, projectId, opener, resolveRemoteAsset, exportArchive, cloudUi }: {
  ownerId: string;
  projectId: string;
  opener?: ProjectOpener;
  resolveRemoteAsset?: (asset: AssetReference) => Promise<Blob | null>;
  exportArchive: ArchiveExporter;
  cloudUi?: CloudUi;
}) {
  const history = useEditorStore((state) => state.history);
  const activeSlideId = useEditorStore((state) => state.activeSlideId);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const localStatus = useEditorStore((state) => state.localStatus);
  const localError = useEditorStore((state) => state.localError);
  const loadError = useEditorStore((state) => state.loadError);
  const cloudStatus = useEditorStore((state) => state.cloudStatus);
  const notice = useEditorStore((state) => state.notice);
  const writable = useEditorStore((state) => state.writable);
  const readOnlyReason = useEditorStore((state) => state.readOnlyReason);
  const pendingEdit = useEditorStore((state) => state.pendingEdit);
  const recoveredEdit = useEditorStore((state) => state.recoveredEdit);
  const tool = useEditorStore((state) => state.tool);
  const teachingMode = useEditorStore((state) => state.teachingMode);
  const rightPanel = useEditorStore((state) => state.rightPanel);
  const {
    load, transact, undo, redo, setTool, setSelectedIds, switchSlide, save, requestWriter, setNotice,
    setTeachingMode, setRightPanel, registerFlusher, setPendingEdit, consumeRecoveredEdit, retryCloud,
  } = useEditorStore.getState();

  const fileInput = useRef<HTMLInputElement>(null);
  const [favorites, setFavorites] = useState<EditorTool[]>(readFavorites);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>(readToolbarPosition);
  const [exportRequest, setExportRequest] = useState<{ kind: "png-slide" | "archive"; nonce: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stencilOpen, setStencilOpen] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "rename-project" | "rename-slide" | "delete-slide"; value: string }>(null);
  const [rightOpenPreference, setRightOpenPreference] = useState(() => typeof window === "undefined" || localStorage.getItem(RIGHT_PANEL_KEY) !== "false");
  const [overlayPanel, setOverlayPanel] = useState(false);
  const viewportWidth = useViewportWidth();
  const narrowLayout = viewportWidth < 1100;
  const tooNarrow = viewportWidth < 1024;

  useEffect(() => { store(FAVORITES_KEY, JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { store(TOOLBAR_KEY, JSON.stringify(toolbarPosition)); }, [toolbarPosition]);
  const toggleFavorite = (id: EditorTool) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  // Keys 1–8 read the latest favorites without re-binding the keyboard listener.
  const favoritesRef = useRef(favorites);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  // Images: local blobs first, then authenticated cloud download (cached locally).
  const images = useMemo(() => new ImageCache(async (assetId) => {
    const local = await getLocalAsset(ownerId, projectId, assetId).catch(() => null);
    if (local) return local;
    const asset = useEditorStore.getState().history?.content.document.assets[assetId];
    if (!asset || !resolveRemoteAsset) return null;
    const remote = await resolveRemoteAsset(asset);
    if (remote) await putLocalAsset(ownerId, projectId, asset, remote).catch(() => undefined);
    return remote;
  }), [ownerId, projectId, resolveRemoteAsset]);
  useEffect(() => { images.retain(); return () => images.release(); }, [images]);

  useEffect(() => {
    void load(ownerId, projectId, opener);
    // Deferred close owned by the store: StrictMode's replay or the next page's load cancels it.
    return () => useEditorStore.getState().scheduleClose(projectId);
  }, [ownerId, projectId, opener, load]);
  useEffect(() => onHistoryNavigate(() => { useGitSessionStore.getState().clearAll(); useFlowSession.getState().clearAll(); }), []);

  // Recovered draft on another slide: open that slide so the canvas/Git panel can restore the editor.
  useEffect(() => {
    if (recoveredEdit && recoveredEdit.slideId !== activeSlideId) switchSlide(recoveredEdit.slideId);
  }, [recoveredEdit, activeSlideId, switchSlide]);
  // The file typed into a Git widget on the board is applied (or refused) before any other change.
  useEffect(() => registerFlusher(flushGitDraft), [registerFlusher]);
  // Recovered Git file draft: select the widget so the board editor shows the draft again.
  useEffect(() => {
    if (recoveredEdit?.kind !== "git-file" || recoveredEdit.slideId !== activeSlideId) return;
    // Selection first: it flushes pending edits, and the recovered draft must not be flushed yet.
    if (!setSelectedIds([recoveredEdit.nodeId])) return;
    const edit = consumeRecoveredEdit();
    if (edit?.kind === "git-file") setPendingEdit(edit);
  }, [recoveredEdit, activeSlideId, setSelectedIds, consumeRecoveredEdit, setPendingEdit]);

  // Local-only thumbnails after a transaction settles; never on pointer move (plan01, M3.3).
  const thumbnailSlides = useRef(new WeakSet<object>());
  useEffect(() => {
    if (!history || !writable) return;
    let idle: number | null = null;
    const timer = setTimeout(() => {
      const slides = history.content.document.slides;
      const run = () => void (async () => {
        for (const slide of slides.slice(0, 1).concat(slides.filter((item) => item.id === activeSlideId))) {
          if (thumbnailSlides.current.has(slide)) continue;
          thumbnailSlides.current.add(slide);
          // Very large slides keep the placeholder: an offscreen render of thousands of nodes would
          // block the main thread during live teaching (PERF-02). The thumbnail is only a cache.
          if (slide.nodes.length > THUMBNAIL_NODE_LIMIT || useEditorStore.getState().gestureActive) continue;
          try {
            const bounds = getContentBounds(slide.nodes, konvaFontMetrics);
            const width = (bounds?.width ?? 1280) + 96, height = (bounds?.height ?? 720) + 96;
            const scale = Math.min(0.5, 320 / width, 200 / height);
            const result = await renderSlidePng(slide, { padding: DEFAULTS.padding, scale, transparent: false, images });
            await putThumbnail(ownerId, projectId, slide.id, { blob: result.blob, localSequence: 0, updatedAt: new Date().toISOString() });
          } catch { /* Thumbnails are a rebuildable cache. */ }
        }
      })();
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(run, { timeout: 5000 });
      else run();
    }, 1500);
    return () => { clearTimeout(timer); if (idle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(idle); };
  }, [history, activeSlideId, writable, images, ownerId, projectId]);

  const content = history?.content;
  const slides = content?.document.slides ?? [];
  const slide = slides.find((item) => item.id === activeSlideId) ?? slides[0];
  const selected = slide?.nodes.filter((node) => selectedIds.includes(node.id) && !node.locked) ?? [];
  const activeIndex = slide ? slides.findIndex((item) => item.id === slide.id) : -1;
  const selectedWidget = selected.length === 1 && isWidgetNode(selected[0]) ? selected[0] : null;
  const editingText = pendingEdit?.kind === "text" || pendingEdit?.kind === "code";
  const status = statusText(localStatus, cloudStatus, editingText, writable);

  const viewportCenterWorld = (): Point => {
    const state = useEditorStore.getState();
    const camera = state.cameras[state.activeSlideId ?? ""] ?? { x: state.viewport.width / 2, y: state.viewport.height / 2, zoom: 1 };
    return screenToWorld({ x: state.viewport.width / 2, y: state.viewport.height / 2 }, camera);
  };

  // ------------------------------------------------------------------ slide operations
  const addSlide = () => {
    if (!slide) return;
    const next = createSlide(nextSlideName(slides));
    if (transact({ label: "เพิ่มสไลด์", affectedSlideId: next.id, commands: [{ type: "slide.insert", slide: next, at: activeIndex + 1 }] })) switchSlide(next.id);
  };
  const copySlide = () => {
    if (!slide) return;
    const next = duplicateSlide(slide);
    const state = useEditorStore.getState();
    const camera = state.cameras[slide.id];
    if (transact({ label: "ทำสำเนาสไลด์", affectedSlideId: next.id, commands: [{ type: "slide.insert", slide: next, at: activeIndex + 1 }] })) {
      if (camera) state.setCamera(next.id, camera);
      switchSlide(next.id);
    }
  };
  const moveSlide = (direction: -1 | 1) => {
    if (!slide || activeIndex + direction < 0 || activeIndex + direction >= slides.length) return;
    const ordered = slides.map((item) => item.id);
    [ordered[activeIndex], ordered[activeIndex + direction]] = [ordered[activeIndex + direction], ordered[activeIndex]];
    transact({ label: "จัดลำดับสไลด์", affectedSlideId: slide.id, commands: [{ type: "slide.reorder", orderedIds: ordered }] });
  };
  const submitDialog = () => {
    if (!dialog || !slide) return;
    const value = dialog.value.trim();
    if (dialog.kind === "delete-slide") {
      // plan01: after deleting, open the next slide, or the previous one when it was the last.
      const neighbour = slides[activeIndex + 1] ?? slides[activeIndex - 1];
      if (transact({ label: "ลบสไลด์", affectedSlideId: slide.id, commands: [{ type: "slide.remove", slideId: slide.id }] }) && neighbour) switchSlide(neighbour.id);
    } else {
      if (!value || [...value].length > LIMITS.titleCodePoints) return;
      if (dialog.kind === "rename-project") transact({ label: "เปลี่ยนชื่อบทเรียน", affectedSlideId: null, commands: [{ type: "project.rename", title: value }] });
      else transact({ label: "เปลี่ยนชื่อสไลด์", affectedSlideId: slide.id, commands: [{ type: "slide.update", slideId: slide.id, name: value }] });
    }
    setDialog(null);
  };

  // ------------------------------------------------------------------ objects
  const removeSelected = useCallback(() => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    if (!current || !state.selectedIds.length) return;
    if (state.transact({ label: "ลบวัตถุ", affectedSlideId: current.id, commands: [{ type: "nodes.remove", slideId: current.id, ids: state.selectedIds }] })) state.setSelectedIds([]);
  }, []);
  const lockSelected = useCallback(() => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    if (!current || !state.selectedIds.length) return;
    if (state.transact({ label: "ล็อกวัตถุ", affectedSlideId: current.id, commands: [{ type: "nodes.lock", slideId: current.id, ids: state.selectedIds, locked: true }] })) state.setSelectedIds([]);
  }, []);
  const insertNodes = useCallback((nodes: CanvasNode[], assets: AssetReference[], label: string, target?: { projectId: string; slideId: string }) => {
    const state = useEditorStore.getState();
    // Async inserts (image decode, paste) go to the project/slide they started on, never elsewhere.
    if (target && state.projectId !== target.projectId) return false;
    const current = state.history?.content.document.slides.find((item) => item.id === (target?.slideId ?? state.activeSlideId));
    if (!current) return false;
    const commands = [
      ...(assets.length ? [{ type: "assets.register" as const, assets }] : []),
      { type: "nodes.insert" as const, slideId: current.id, nodes },
    ];
    if (!state.transact({ label, affectedSlideId: current.id, commands })) return false;
    state.setTool("select");
    if (current.id === state.activeSlideId) state.setSelectedIds(nodes.map((node) => node.id));
    return true;
  }, []);
  /** Puts the selection into one group (⌘G) / dissolves the groups it touches (⌘⇧G); one Undo step each. */
  const groupSelected = useCallback((group: boolean) => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    if (!current || !state.writable) return;
    const nodes = group ? groupNodes(current.nodes, state.selectedIds, crypto.randomUUID()) : ungroupNodes(current.nodes, state.selectedIds);
    if (nodes) state.transact({ label: group ? "จับกลุ่ม" : "แยกกลุ่ม", affectedSlideId: current.id, commands: [{ type: "nodes.replace", slideId: current.id, nodes }] });
  }, []);
  const duplicateSelected = useCallback(() => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    const source = current?.nodes.filter((node) => state.selectedIds.includes(node.id) && !node.locked) ?? [];
    if (!source.length) return;
    const copies = withFreshGroups(source.map((node) => ({ ...structuredClone(node), id: crypto.randomUUID(), x: node.x + DEFAULTS.pasteOffset, y: node.y + DEFAULTS.pasteOffset }) as CanvasNode));
    insertNodes(copies, [], "ทำสำเนาวัตถุ");
  }, [insertNodes]);
  /**
   * Clears what was drawn on this slide in one Undo step: `freehand` = pen/highlighter strokes only,
   * `drawings` = strokes + shapes + lines/arrows + text + ready-made pictures + tables. Locked objects, images and simulators stay.
   */
  const clearSlide = useCallback((what: "freehand" | "drawings") => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    if (!current) return;
    const ids = current.nodes.filter((node) => !node.locked && CLEARABLE[what].has(node.type)).map((node) => node.id);
    if (!ids.length) return;
    if (state.transact({ label: what === "freehand" ? "ล้างเส้นปากกา/ไฮไลต์" : "ล้างสิ่งที่วาดทั้งหมด", affectedSlideId: current.id, commands: [{ type: "nodes.remove", slideId: current.id, ids }] })) {
      state.setSelectedIds([]);
    }
  }, []);

  /** Opens the right panel on the simulator tab, wherever it lives in this layout (docked, overlay, teaching mode). */
  const showWidgetPanel = () => {
    setRightPanel("git");
    if (narrowLayout || teachingMode) setOverlayPanel(true);
    else if (!rightOpenPreference) { setRightOpenPreference(true); store(RIGHT_PANEL_KEY, "true"); }
  };
  const insertWidget = (kind: WidgetKind) => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    const center = viewportCenterWorld();
    const base = { id: crypto.randomUUID(), rotation: 0 as const, opacity: 1, locked: false, scale: 1, x: 0, y: 0 };
    // New widgets start at lesson step 1; the panel switches steps.
    const draft: WidgetNode = kind === "git"
      ? { ...base, type: "git-simulator", view: "local", state: createInitialGitState() }
      : kind === "data"
        ? { ...base, type: "data-simulator", view: "where", state: createInitialDataState() }
        : kind === "deploy"
          ? { ...base, type: "deploy-simulator", view: "local", state: createInitialDeployState() }
          : { ...base, type: "ai-simulator", view: "history", state: createInitialAiState() };
    const size = widgetNodeSize(draft);
    // Never stack a new widget exactly on top of an existing one (it would hide the lesson so far).
    let x = center.x - size.width / 2, y = center.y - size.height / 2;
    const others = current?.nodes.filter(isWidgetNode) ?? [];
    while (others.some((node) => Math.abs(node.x - x) < 40 && Math.abs(node.y - y) < 40)) { x += 64; y += 64; }
    const node = { ...draft, x, y } as WidgetNode;
    if (!insertNodes([node], [], { git: "เพิ่มตัวจำลอง Git", data: "เพิ่มตัวจำลองข้อมูล", deploy: "เพิ่มตัวจำลอง Deploy", ai: "เพิ่มตัวจำลอง AI" }[kind])) return;
    showWidgetPanel();
    // Zoom out (never in) so the whole widget is visible beside the panel, not under it.
    const slideId = state.activeSlideId;
    if (!slideId || state.viewport.width <= 0) return;
    const panelCovers = narrowLayout || teachingMode ? 280 : 0;
    const visible = { width: Math.max(200, state.viewport.width - panelCovers), height: state.viewport.height };
    const camera = useEditorStore.getState().cameras[slideId] ?? { x: state.viewport.width / 2, y: state.viewport.height / 2, zoom: 1 };
    const fit = fitBounds({ x, y, width: size.width, height: size.height }, visible, 24);
    if (fit.zoom < camera.zoom) state.setCamera(slideId, fit);
    // Fits already: keep the zoom but centre it in the part of the board the overlay panel leaves free.
    else if (panelCovers) state.setCamera(slideId, { ...camera, x: visible.width / 2 - (x + size.width / 2) * camera.zoom });
  };
  /** Places a ready-made picture in the middle of the view (offset if one already sits exactly there). */
  const insertStencil = (spec: StencilSpec) => {
    setStencilOpen(false);
    const current = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === useEditorStore.getState().activeSlideId);
    const center = viewportCenterWorld();
    let x = center.x - spec.width / 2, y = center.y - spec.height / 2;
    while (current?.nodes.some((node) => node.type === "stencil" && Math.abs(node.x - x) < 8 && Math.abs(node.y - y) < 8)) { x += 32; y += 32; }
    const node: StencilNode = {
      id: crypto.randomUUID(), type: "stencil", kind: spec.kind, x, y, rotation: 0, opacity: 1, locked: false,
      width: spec.width, height: spec.height, color: spec.color, label: spec.label,
    };
    insertNodes([node], [], `เพิ่มภาพประกอบ: ${spec.name}`);
  };
  /** A new table (or class box) in the middle of the view, typing straight into its first cell. */
  const insertTable = (variant: "grid" | "class") => {
    setStencilOpen(false);
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    const draft = variant === "grid" ? createGridTable() : createClassBox();
    const size = tableLayout({ ...draft, id: "", x: 0, y: 0 }, konvaFontMetrics);
    const center = viewportCenterWorld();
    let x = center.x - size.width / 2, y = center.y - size.height / 2;
    while (current?.nodes.some((node) => node.type === "table" && Math.abs(node.x - x) < 8 && Math.abs(node.y - y) < 8)) { x += 32; y += 32; }
    const node: TableNode = { ...draft, id: crypto.randomUUID(), x, y };
    if (!current || !insertNodes([node], [], variant === "grid" ? "เพิ่มตาราง" : "เพิ่มกล่องคลาส")) return;
    useEditorStore.getState().setTableEdit({ slideId: current.id, nodeId: node.id, row: 0, col: 0, selectAll: true });
  };
  /** A Python code block in the middle of the view, sample code selected so typing replaces it. */
  const insertCode = () => {
    setStencilOpen(false);
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    const draft = { type: "code" as const, code: DEFAULT_CODE.python, language: "python" as const, theme: "dark" as const, fontSize: 18, lineNumbers: true, rotation: 0, opacity: 1, locked: false };
    const size = codeLayout({ ...draft, id: "", x: 0, y: 0 }, konvaFontMetrics);
    const center = viewportCenterWorld();
    let x = center.x - size.width / 2, y = center.y - size.height / 2;
    while (current?.nodes.some((node) => node.type === "code" && Math.abs(node.x - x) < 8 && Math.abs(node.y - y) < 8)) { x += 32; y += 32; }
    const node: CodeNode = { ...draft, id: crypto.randomUUID(), x, y };
    if (!current || !insertNodes([node], [], "เพิ่มบล็อกโค้ด")) return;
    useEditorStore.getState().setCodeEdit({ slideId: current.id, nodeId: node.id, selectAll: true });
  };
  const insertCodeRef = useRef(insertCode);
  useEffect(() => { insertCodeRef.current = insertCode; });
  const insertTableRef = useRef(insertTable);
  useEffect(() => { insertTableRef.current = insertTable; });
  /** Tool entries that open a picker instead of becoming a canvas mode (image file, ready-made pictures). */
  const runToolAction = useCallback((tool: EditorTool) => {
    if (!useEditorStore.getState().writable) return;
    if (tool === "image") fileInput.current?.click();
    else if (tool === "stencil") setStencilOpen(true);
    else if (tool === "table") insertTableRef.current("grid");
    else if (tool === "code") insertCodeRef.current();
  }, [setStencilOpen]);
  const insertImages = useCallback(async (files: File[], world: Point | null) => {
    const state = useEditorStore.getState();
    if (!state.writable || !state.activeSlideId) return;
    const target = { projectId, slideId: state.activeSlideId };
    const zoom = state.cameras[state.activeSlideId]?.zoom ?? 1;
    let anchor = world ?? viewportCenterWorld();
    for (const file of files) {
      try {
        const { asset, blob } = await ingestImage(file, { ownerId, projectId });
        // Blob must be stored locally before the document references the asset.
        await putLocalAsset(ownerId, projectId, asset, blob);
        images.seed(asset.id, blob);
        const size = initialImageSize(asset, { width: state.viewport.width / zoom, height: state.viewport.height / zoom });
        const node: CanvasNode = { id: crypto.randomUUID(), type: "image", assetId: asset.id, x: anchor.x - size.width / 2, y: anchor.y - size.height / 2, width: size.width, height: size.height, rotation: 0, opacity: 1, locked: false };
        if (!insertNodes([node], [asset], "แทรกรูปภาพ", target)) return;
        anchor = { x: anchor.x + DEFAULTS.pasteOffset, y: anchor.y + DEFAULTS.pasteOffset };
      } catch (error) {
        useEditorStore.getState().setNotice(error instanceof Error ? error.message : "แทรกรูปไม่สำเร็จ");
      }
    }
  }, [ownerId, projectId, images, insertNodes]);
  const pasteInternal = useCallback(async () => {
    const slideId = useEditorStore.getState().activeSlideId;
    if (!slideId) return;
    try {
      const plan = await preparePaste({ ownerId, projectId });
      if (plan) insertNodes(plan.nodes, plan.assets, "วางวัตถุ", { projectId, slideId });
    } catch (error) {
      useEditorStore.getState().setNotice(error instanceof Error ? error.message : "วางวัตถุไม่สำเร็จ");
    }
  }, [ownerId, projectId, insertNodes]);

  const [copied, setCopied] = useState<number | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; world?: Point } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), [setMenuAt]);
  const copySelected = useCallback(() => {
    const state = useEditorStore.getState();
    const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
    if (!current || !state.selectedIds.length) return;
    const count = copyToClipboard(ownerId, projectId, current.nodes.filter((node) => state.selectedIds.includes(node.id) && !node.locked), state.history!.content.document.assets);
    state.setNotice(null);
    if (count) setCopied(count);
  }, [ownerId, projectId]);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  // ------------------------------------------------------------------ keyboard
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      // Physical key (event.code) so shortcuts also work while the Thai input source is active.
      const key = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
      const state = useEditorStore.getState();
      // Cmd+S everywhere (inputs, Git editor, dialogs): flush drafts and save; never the browser's Save Page.
      if (modifier && key === "s" && !event.altKey) { event.preventDefault(); void state.save(); return; }
      if (editable(event.target) || document.querySelector("[role=dialog]") || event.defaultPrevented) return;
      // During a pointer gesture / nudge only Cmd+S (above) and Escape (canvas) are honoured.
      if (state.gestureActive) { if (modifier || event.key.length === 1 || /^(Delete|Backspace|Page(Up|Down))$/.test(event.key)) event.preventDefault(); return; }
      const current = state.history?.content.document.slides.find((item) => item.id === state.activeSlideId);
      if (modifier) {
        if (key === "z") { event.preventDefault(); if (event.shiftKey) state.redo(); else state.undo(); return; }
        if (key === "y" && event.ctrlKey && !event.metaKey) { event.preventDefault(); state.redo(); return; }
        if (key === "a" && current) { event.preventDefault(); state.setSelectedIds(current.nodes.filter((node) => !node.locked).map((node) => node.id)); return; }
        if (event.code === "BracketRight" || event.code === "BracketLeft") { event.preventDefault(); reorderSelection(event.code === "BracketRight" ? event.shiftKey ? "front" : "forward" : event.shiftKey ? "back" : "backward"); return; }
        if (key === "l" && current && state.selectedIds.length) { event.preventDefault(); lockSelected(); return; }
        if (key === "c" && current && state.selectedIds.length) { event.preventDefault(); copySelected(); return; }
        if (key === "d" && current) { event.preventDefault(); duplicateSelected(); return; }
        if (key === "g" && current) { event.preventDefault(); groupSelected(!event.shiftKey); return; }
        if (key === "b" && current) {
          // ⌘B: selected text boxes bold (or back to normal when all already are).
          const texts = current.nodes.filter((node): node is TextNode => state.selectedIds.includes(node.id) && node.type === "text" && !node.locked);
          if (!texts.length || !state.writable) return;
          event.preventDefault();
          const bold = !texts.every((node) => node.bold);
          state.transact({ label: bold ? "ตัวหนา" : "ตัวปกติ", affectedSlideId: current.id, commands: [{ type: "nodes.replace", slideId: current.id, nodes: texts.map((node) => ({ ...node, bold })) }] });
          return;
        }
        if (key === "v") {
          // Let the native paste event deliver system images; fall back to the in-app clipboard.
          if (pasteTimer.current) clearTimeout(pasteTimer.current);
          pasteTimer.current = setTimeout(() => { pasteTimer.current = null; void pasteInternal(); }, 80);
          return;
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selectedIds.length) { event.preventDefault(); removeSelected(); }
        return;
      }
      if (event.key === "Escape") { state.setSelectedIds([]); return; }
      if (event.key === "PageDown" || event.key === "PageUp") {
        const all = state.history?.content.document.slides ?? [];
        const index = all.findIndex((item) => item.id === current?.id);
        const next = all[index + (event.key === "PageDown" ? 1 : -1)];
        event.preventDefault();
        if (next) state.switchSlide(next.id);
        return;
      }
      if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) { event.preventDefault(); setHelpOpen(true); return; }
      if (event.altKey) return;
      // 1–8 = the favorites in toolbar order (event.code, so it also works with the Thai keyboard layout).
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit && !event.shiftKey) {
        const favorite = favoriteForKey(favoritesRef.current, Number(digit[1]));
        if (!favorite) return;
        event.preventDefault();
        if (isActionTool(favorite)) runToolAction(favorite);
        else state.setTool(favorite);
        return;
      }
      if (key === "i") { event.preventDefault(); runToolAction("stencil"); return; }
      const shortcuts: Record<string, EditorTool> = { v: "select", h: "hand", p: event.shiftKey ? "highlighter" : "pen", r: "rectangle", o: "ellipse", a: "arrow", l: "line", t: "text", e: "eraser", k: "laser" };
      if (shortcuts[key]) { event.preventDefault(); state.setTool(shortcuts[key]); }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target) || document.querySelector("[role=dialog]")) return;
      if (pasteTimer.current) { clearTimeout(pasteTimer.current); pasteTimer.current = null; }
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      event.preventDefault();
      if (files.length) void insertImages(files, null);
      else void pasteInternal();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("paste", onPaste); };
  }, [ownerId, projectId, insertImages, insertNodes, pasteInternal, removeSelected, lockSelected, copySelected, duplicateSelected, runToolAction, groupSelected]);


  // Some browsers keep a navigated-away page alive (bfcache) with its Web Lock; release it explicitly.
  useEffect(() => {
    const onPageHide = () => useEditorStore.getState().suspendWriter();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void useEditorStore.getState().requestWriter(); };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => { window.removeEventListener("pagehide", onPageHide); window.removeEventListener("pageshow", onPageShow); };
  }, []);

  // Warn only when something is not yet safely in IndexedDB (memory-only or pending write).
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = useEditorStore.getState();
      if (state.writable && (state.localStatus === "writing" || state.localStatus === "error")) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const openExport = (kind: "png-slide" | "archive" = "png-slide") => {
    if (!useEditorStore.getState().flushPendingEdits()) return;
    setExportRequest({ kind, nonce: Date.now() });
  };

  if (loadError) {
    return <main className="flex h-dvh items-center justify-center p-6"><div className="card max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">เปิดบทเรียนไม่สำเร็จ</h1><p role="alert" className="muted mt-2">{loadError}</p>
      <Link href="/projects" className="app-button mt-5">กลับไปหน้าโปรเจกต์</Link>
    </div></main>;
  }
  // Same shape as the route loading state until the lesson is read from this device / the cloud.
  if (!history) return <EditorSkeleton />;

  const rightVisible = !teachingMode && rightPanel !== null && (narrowLayout ? overlayPanel : rightOpenPreference);
  const panelTab = rightPanel ?? "properties";
  const setPanelOpen = (open: boolean) => {
    if (narrowLayout || teachingMode) setOverlayPanel(open);
    else { setRightOpenPreference(open); store(RIGHT_PANEL_KEY, String(open)); }
    if (open && !rightPanel) setRightPanel("properties");
  };
  /** Rows/columns of the table cell under a right-click (one table selected). */
  const tableMenu = (current: SlideDocument, table: TableNode, world: Point | undefined): MenuEntry[] => {
    const cell = world ? tableCellAt(table, world, konvaFontMetrics) : null;
    if (!cell) return [];
    const state = useEditorStore.getState();
    const edit = !state.writable;
    const apply = (label: string, next: TableNode) => {
      if (next !== table) state.transact({ label, affectedSlideId: current.id, commands: [{ type: "nodes.replace", slideId: current.id, nodes: [next] }] });
    };
    const { row, col } = cell;
    const type: MenuEntry = { kind: "item", label: "พิมพ์ในช่องนี้", icon: <TextCursorInput size={15} />, shortcut: "ดับเบิลคลิก", disabled: edit,
      onSelect: () => state.setTableEdit({ slideId: current.id, nodeId: table.id, row, col }) };
    if (table.variant === "class") return [
      type,
      { kind: "item", label: "เพิ่มบรรทัดด้านล่าง", icon: <BetweenHorizontalEnd size={15} />, disabled: edit || table.rows.length >= LIMITS.tableRows, onSelect: () => apply("เพิ่มบรรทัด", insertRow(table, row + 1)) },
      ...(row > 0 ? [
        { kind: "item" as const, label: table.rows[row].divider ? "เอาเส้นแบ่งส่วนออก" : "ใส่เส้นแบ่งส่วนเหนือบรรทัดนี้", icon: <SeparatorHorizontal size={15} />, disabled: edit, onSelect: () => apply("เส้นแบ่งส่วน", toggleDivider(table, row)) },
        { kind: "item" as const, label: "ลบบรรทัดนี้", icon: <Trash2 size={15} />, danger: true, disabled: edit || table.rows.length <= 1, onSelect: () => apply("ลบบรรทัด", removeRow(table, row)) },
      ] : []),
      { kind: "separator" },
    ];
    return [
      type,
      { kind: "item", label: "เพิ่มแถวด้านบน", icon: <BetweenHorizontalStart size={15} />, disabled: edit || table.rows.length >= LIMITS.tableRows, onSelect: () => apply("เพิ่มแถว", insertRow(table, row)) },
      { kind: "item", label: "เพิ่มแถวด้านล่าง", icon: <BetweenHorizontalEnd size={15} />, disabled: edit || table.rows.length >= LIMITS.tableRows, onSelect: () => apply("เพิ่มแถว", insertRow(table, row + 1)) },
      { kind: "item", label: "เพิ่มคอลัมน์ทางซ้าย", icon: <BetweenVerticalStart size={15} />, disabled: edit || table.columns.length >= LIMITS.tableColumns, onSelect: () => apply("เพิ่มคอลัมน์", insertColumn(table, col)) },
      { kind: "item", label: "เพิ่มคอลัมน์ทางขวา", icon: <BetweenVerticalEnd size={15} />, disabled: edit || table.columns.length >= LIMITS.tableColumns, onSelect: () => apply("เพิ่มคอลัมน์", insertColumn(table, col + 1)) },
      { kind: "item", label: "ลบแถวนี้", icon: <Trash2 size={15} />, danger: true, disabled: edit || table.rows.length <= 1, onSelect: () => apply("ลบแถว", removeRow(table, row)) },
      { kind: "item", label: "ลบคอลัมน์นี้", icon: <Trash2 size={15} />, danger: true, disabled: edit || table.columns.length <= 1, onSelect: () => apply("ลบคอลัมน์", removeColumn(table, col)) },
      { kind: "separator" },
    ];
  };
  /** Right-click menu: table rows/columns, object actions for the selection, then clearing what was drawn on this slide. */
  const boardMenu = (current: SlideDocument, world?: Point): MenuEntry[] => {
    const state = useEditorStore.getState();
    const chosen = current.nodes.filter((node) => state.selectedIds.includes(node.id) && !node.locked);
    const table = chosen.length === 1 && chosen[0].type === "table" ? chosen[0] : null;
    const count = (what: "freehand" | "drawings") => current.nodes.filter((node) => !node.locked && CLEARABLE[what].has(node.type)).length;
    const freehand = count("freehand"), drawings = count("drawings");
    const edit = !state.writable;
    const grouped = isGrouped(current.nodes, chosen.map((node) => node.id));
    const groupItems: MenuEntry[] = [
      ...(chosen.length >= 2 && !(grouped && expandToGroups(current.nodes, [chosen[0].id]).length === chosen.length && chosen.every((node) => node.groupId === chosen[0].groupId))
        ? [{ kind: "item" as const, label: `จับกลุ่ม ${chosen.length} ชิ้น`, icon: <GroupIcon size={15} />, shortcut: "⌘G", disabled: edit, onSelect: () => groupSelected(true) }] : []),
      ...(grouped ? [{ kind: "item" as const, label: "แยกกลุ่ม", icon: <Ungroup size={15} />, shortcut: "⌘⇧G", disabled: edit, onSelect: () => groupSelected(false) }] : []),
    ];
    const objectItems: MenuEntry[] = chosen.length ? [
      ...groupItems,
      { kind: "item", label: chosen.length > 1 ? `ทำสำเนา ${chosen.length} ชิ้น` : "ทำสำเนา", icon: <CopyPlus size={15} />, shortcut: "⌘D", disabled: edit, onSelect: duplicateSelected },
      { kind: "item", label: "คัดลอก", icon: <Copy size={15} />, shortcut: "⌘C", onSelect: copySelected },
      { kind: "item", label: "นำขึ้นหน้าสุด", icon: <BringToFront size={15} />, shortcut: "⌘⇧]", disabled: edit, onSelect: () => reorderSelection("front") },
      { kind: "item", label: "ส่งไปหลังสุด", icon: <SendToBack size={15} />, shortcut: "⌘⇧[", disabled: edit, onSelect: () => reorderSelection("back") },
      { kind: "item", label: "ล็อก (ล้างแล้วไม่หาย)", icon: <Lock size={15} />, shortcut: "⌘L", disabled: edit, onSelect: lockSelected },
      { kind: "item", label: chosen.length > 1 ? `ลบ ${chosen.length} ชิ้น` : "ลบ", icon: <Trash2 size={15} />, shortcut: "⌫", disabled: edit, danger: true, onSelect: removeSelected },
      { kind: "separator" },
    ] : [
      { kind: "item", label: "วาง", icon: <ClipboardPaste size={15} />, shortcut: "⌘V", disabled: edit, onSelect: () => void pasteInternal() },
      { kind: "item", label: "เลือกทั้งหมด", icon: <SquareDashedMousePointer size={15} />, shortcut: "⌘A",
        disabled: !current.nodes.some((node) => !node.locked), onSelect: () => state.setSelectedIds(current.nodes.filter((node) => !node.locked).map((node) => node.id)) },
      { kind: "separator" },
    ];
    return [
      ...(table ? tableMenu(current, table, world) : []),
      ...objectItems,
      { kind: "item", label: `ล้างเส้นปากกา/ไฮไลต์ (${freehand})`, icon: <Eraser size={15} />, disabled: edit || !freehand, danger: true, onSelect: () => clearSlide("freehand") },
      { kind: "item", label: `ล้างสิ่งที่วาดทั้งหมด (${drawings})`, icon: <Eraser size={15} />, disabled: edit || !drawings, danger: true, onSelect: () => clearSlide("drawings") },
    ];
  };

  const panelContent = <>
    <div className="flex border-b border-slate-200 p-2" role="tablist" aria-label="แผงด้านขวา">
      {(["properties", "objects", "git"] as const).map((tab) => <button key={tab} role="tab" aria-selected={panelTab === tab}
        className={`flex-1 rounded-md py-2 text-sm ${panelTab === tab ? "bg-slate-100 font-semibold" : "muted"}`} onClick={() => setRightPanel(tab)}>
        {tab === "properties" ? "Properties" : tab === "objects" ? "Objects" : "ตัวจำลอง"}</button>)}
    </div>
    {panelTab === "objects"
      ? <ObjectsPanel slide={slide} selectedIds={selectedIds} setSelectedIds={setSelectedIds} writable={writable} transact={transact} onReorder={reorderSelection} />
      : panelTab === "git"
        ? selectedWidget && slide
          ? selectedWidget.type === "git-simulator"
            ? <GitPanel key={selectedWidget.id} node={selectedWidget} slideId={slide.id} writable={writable} transact={transact} />
            : selectedWidget.type === "data-simulator"
              ? <DataPanel key={selectedWidget.id} node={selectedWidget} slideId={slide.id} writable={writable} transact={transact} />
              : selectedWidget.type === "deploy-simulator"
                ? <DeployPanel key={selectedWidget.id} node={selectedWidget} slideId={slide.id} writable={writable} transact={transact} />
                : <AiPanel key={selectedWidget.id} node={selectedWidget} slideId={slide.id} writable={writable} transact={transact} />
          : <WidgetPanelEmpty slide={slide} writable={writable} onSelect={(id) => { if (setSelectedIds([id])) showWidgetPanel(); }} onInsert={insertWidget} />
        : <PropertiesPanel slide={slide} selected={selected} writable={writable} lockSelected={lockSelected} removeSelected={removeSelected} />}
  </>;

  return <ImageCacheContext.Provider value={images}>
    <div className="flex h-dvh min-h-[480px] flex-col overflow-hidden bg-slate-100">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <Link href="/projects" className="app-button icon-button" aria-label="กลับไปโปรเจกต์" title="กลับไปโปรเจกต์" onClick={() => { useEditorStore.getState().flushPendingEdits(); }}><ArrowLeft size={18} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate font-semibold">{content?.title ?? "กำลังเปิดบทเรียน…"}</h1>
            <button className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="เปลี่ยนชื่อบทเรียน" title="เปลี่ยนชื่อบทเรียน" disabled={!writable || !content}
              onClick={() => content && setDialog({ kind: "rename-project", value: content.title })}><Pencil size={13} /></button>
          </div>
          <p className={`truncate text-xs ${status.tone === "error" ? "text-red-600" : status.tone === "warn" ? "text-amber-700" : "muted"}`} role="status" aria-live="polite" data-testid="save-status">{status.text}</p>
        </div>
        {copied !== null && <span className="rounded-full bg-slate-900 px-3 py-1 text-xs text-white" role="status">คัดลอกวัตถุในแอป {copied} ชิ้น</span>}
        {teachingMode && slide && <div className="flex items-center gap-1" aria-label="เปลี่ยนสไลด์">
          <button className="app-button icon-button" aria-label="สไลด์ก่อนหน้า" title="สไลด์ก่อนหน้า (PageUp)" disabled={activeIndex <= 0} onClick={() => switchSlide(slides[activeIndex - 1].id)}><ChevronLeft size={18} /></button>
          <span className="min-w-16 text-center text-sm">{activeIndex + 1}/{slides.length}</span>
          <button className="app-button icon-button" aria-label="สไลด์ถัดไป" title="สไลด์ถัดไป (PageDown)" disabled={activeIndex >= slides.length - 1} onClick={() => switchSlide(slides[activeIndex + 1].id)}><ChevronRight size={18} /></button>
        </div>}
        <button className="app-button icon-button" aria-label="เลิกทำ" title="เลิกทำ (⌘Z)" disabled={!writable || !history?.past.length} onClick={undo}><Undo2 size={18} /></button>
        <button className="app-button icon-button" aria-label="ทำซ้ำ" title="ทำซ้ำ (⌘⇧Z)" disabled={!writable || !history?.future.length} onClick={redo}><Redo2 size={18} /></button>
        <button className="app-button" disabled={!writable} title="บันทึกบทเรียน (⌘S)" onClick={() => void save()}><Save size={17} /><span className="hidden lg:inline">บันทึกบทเรียน</span></button>
        <button className="app-button" disabled={!content} onClick={() => openExport()} title="ส่งออก PNG / PDF / ไฟล์โปรเจกต์"><Download size={17} /><span className="hidden lg:inline">Export</span></button>
        <button className={`app-button ${teachingMode ? "!border-slate-900 !bg-slate-900 !text-white" : ""}`} aria-pressed={teachingMode} title="โหมดสอน: ซ่อนแผงข้างเพื่อพื้นที่วาด" onClick={() => { setOverlayPanel(false); setTeachingMode(!teachingMode); }}><GraduationCap size={17} /><span className="hidden xl:inline">{teachingMode ? "ออกจากโหมดสอน" : "โหมดสอน"}</span></button>
        <button className="app-button icon-button" aria-label="เต็มจอ" title="เต็มจอ (กด Esc เพื่อออก)" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => undefined); }}><Expand size={17} /></button>
        <button className="app-button icon-button" aria-label="คีย์ลัด" title="คีย์ลัด (?)" onClick={() => setHelpOpen(true)}><Keyboard size={17} /></button>
        {teachingMode
          ? <><button className="app-button" onClick={() => { setRightPanel("properties"); setOverlayPanel(!overlayPanel || panelTab !== "properties"); }}>Properties</button>
            <button className="app-button" onClick={() => { setRightPanel("git"); setOverlayPanel(!overlayPanel || panelTab !== "git"); }}>ตัวจำลอง</button></>
          : <button className="app-button icon-button" aria-label={rightVisible ? "ซ่อนแผงด้านขวา" : "แสดงแผงด้านขวา"} title={rightVisible ? "ซ่อนแผงด้านขวา" : "แสดงแผงด้านขวา"} aria-expanded={rightVisible}
            onClick={() => setPanelOpen(!rightVisible)}>{rightVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>}
      </header>
      {localStatus === "error" && <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        <span className="flex-1">{localError ?? "เก็บในเครื่องไม่สำเร็จ"} — งานยังอยู่ในหน่วยความจำของแท็บนี้ อย่าปิดแท็บจนกว่าจะ Export สำรอง</span>
        <button className="app-button !py-1" onClick={() => openExport("archive")}>Export สำรอง</button>
      </div>}
      {cloudStatus?.kind === "error" && <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        <span className="flex-1">บันทึกบน Cloud ไม่สำเร็จ: {cloudStatus.message} (งานยังเก็บในเครื่อง)</span>
        <button className="app-button !py-1" onClick={retryCloud}>ลองใหม่</button>
      </div>}
      {cloudStatus?.kind === "conflict" && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        <span className="flex-1">มีงานจากอีกเครื่องบันทึกทับ revision นี้แล้ว จึงหยุดบันทึกบน Cloud เพื่อไม่ให้งานทับกัน</span>
        <button className="app-button !py-1" onClick={() => void cloudUi?.keepLocalCopy()}>เก็บงานนี้เป็นสำเนา</button>
        <button className="app-button !py-1" onClick={() => { if (window.confirm("ใช้ฉบับ Cloud จะทิ้งงานในเครื่องที่ยังไม่ได้บันทึก รวมข้อความที่กำลังพิมพ์ แนะนำให้ Export สำรองก่อน ดำเนินการต่อหรือไม่?")) void cloudUi?.useCloudVersion(); }}>ใช้ฉบับ Cloud</button>
      </div>}
      {cloudStatus?.kind === "auth" && <div role="alert" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <span className="flex-1">เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ — งานยังเก็บในเครื่องและไม่ถูกปิด</span>
        <button className="app-button !py-1" onClick={() => cloudUi?.openLogin()}>เข้าสู่ระบบ</button>
      </div>}
      {cloudStatus?.kind === "unavailable" && <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
        <span className="flex-1">ไม่พบโปรเจกต์นี้บน Cloud หรือไม่มีสิทธิ์แล้ว เก็บงานในเครื่องเป็นสำเนาใหม่ได้</span>
        <button className="app-button !py-1" onClick={() => void cloudUi?.keepLocalCopy()}>เก็บเป็นสำเนาใหม่</button>
      </div>}
      {!writable && history && <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        <span className="flex-1">{readOnlyReason === "unsupported" ? "Browser นี้ไม่รองรับ Web Locks จึงเปิดได้แบบอ่านอย่างเดียว กรุณาใช้ Chrome, Edge หรือ Safari รุ่นใหม่" : "โปรเจกต์นี้เปิดแก้ไขอยู่ในอีกแท็บ ปิด editor ในแท็บนั้นก่อน แล้วกดเปิดแก้ไข"}</span>
        {readOnlyReason !== "unsupported" && <button className="app-button !py-1" onClick={() => void requestWriter()}>เปิดแก้ไข</button>}
      </div>}
      {notice && <div role="alert" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"><span className="flex-1">{notice}</span><button className="app-button icon-button !h-7 !w-7" aria-label="ปิดข้อความ" onClick={() => setNotice(null)}><X size={14} /></button></div>}
      <div className="relative flex min-h-0 flex-1">
        {!teachingMode && <LeftPanel slides={slides} activeSlideId={slide?.id} tool={tool} setTool={setTool} favorites={favorites} toggleFavorite={toggleFavorite} writable={writable}
          autoCollapsed={narrowLayout}
          onSwitchSlide={(slideId) => { switchSlide(slideId); }} onAddSlide={addSlide} onCopySlide={copySlide}
          onRenameSlide={() => slide && setDialog({ kind: "rename-slide", value: slide.name })}
          onDeleteSlide={() => slides.length > 1 && setDialog({ kind: "delete-slide", value: "" })}
          onMoveSlide={moveSlide}
          onReorderSlides={(orderedIds) => slide && transact({ label: "จัดลำดับสไลด์", affectedSlideId: slide.id, commands: [{ type: "slide.reorder", orderedIds }] })}
          onInsertGit={() => insertWidget("git")} onInsertData={() => insertWidget("data")} onInsertDeploy={() => insertWidget("deploy")} onInsertAi={() => insertWidget("ai")} onAction={runToolAction} />}
        <div className="min-w-0 flex-1">{slide
          ? <Canvas key={slide.id} slide={slide} favorites={favorites} onFavoritesReorder={setFavorites} toolbarPosition={toolbarPosition} onToolbarPositionChange={setToolbarPosition}
            onImageFiles={(files, world) => void insertImages(files, world)} onToolAction={runToolAction} onWidgetSelected={showWidgetPanel} onContextMenu={setMenuAt} />
          : <div className="flex h-full items-center justify-center muted">กำลังโหลดกระดาน…</div>}</div>
        {rightVisible && <aside aria-label="แผงคุณสมบัติ" className={`w-[280px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white ${narrowLayout || teachingMode ? "absolute right-0 top-0 z-40 h-full shadow-2xl" : ""}`}>{panelContent}</aside>}
        {teachingMode && overlayPanel && <aside aria-label="แผงชั่วคราวระหว่างสอน" className="absolute right-0 top-0 z-40 h-full w-[280px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
          <div className="flex justify-end p-1"><button className="app-button icon-button !h-7 !w-7" aria-label="ปิดแผงชั่วคราว" onClick={() => setOverlayPanel(false)}><X size={14} /></button></div>{panelContent}</aside>}
      </div>
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-xs muted">
        <span className="truncate">{slide ? `${slide.name} · สไลด์ ${activeIndex + 1}/${slides.length}` : ""}</span>
        <span>{cloudStatus ? "บันทึกบทเรียน = เก็บในเครื่อง + Cloud · Commit/Push ในตัวจำลองเป็นคนละระบบ" : "โหมดพัฒนาในเครื่อง: เก็บเฉพาะ IndexedDB ของ browser นี้"}</span>
      </footer>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) void insertImages(files, null); }} />
      {content && exportRequest && <ExportDialog key={exportRequest.nonce} open onOpenChange={(open) => { if (!open) setExportRequest(null); }} initialKind={exportRequest.kind}
        getSnapshot={() => useEditorStore.getState().history?.content ?? null}
        activeSlideId={activeSlideId} selectedIds={selectedIds} images={images} exportArchive={exportArchive} />}
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      {menuAt && slide && <ContextMenu at={menuAt} onClose={closeMenu} entries={boardMenu(slide, menuAt.world)} />}
      <StencilPicker open={stencilOpen} onOpenChange={setStencilOpen} onPick={insertStencil} onPickTable={insertTable} onPickCode={insertCode} />
      <Dialog.Root open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
          <Dialog.Title className="text-xl font-semibold">{dialog?.kind === "rename-project" ? "เปลี่ยนชื่อบทเรียน" : dialog?.kind === "rename-slide" ? "เปลี่ยนชื่อสไลด์" : "ลบสไลด์"}</Dialog.Title>
          {dialog?.kind === "delete-slide"
            ? <Dialog.Description className="muted mt-3">ลบ “{slide?.name}” หรือไม่? ใช้ “เลิกทำ” เพื่อคืนสไลด์ได้</Dialog.Description>
            : <><Dialog.Description className="muted mt-3">ชื่อยาว 1–120 ตัวอักษร</Dialog.Description>
              <input className="field mt-4" autoFocus aria-label={dialog?.kind === "rename-project" ? "ชื่อบทเรียน" : "ชื่อสไลด์"} value={dialog?.value ?? ""}
                onChange={(event) => dialog && setDialog({ ...dialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) submitDialog(); }} /></>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close className="app-button">ยกเลิก</Dialog.Close>
            <button className={`app-button ${dialog?.kind === "delete-slide" ? "!border-red-700 !bg-red-700 !text-white" : "app-button-primary"}`}
              disabled={dialog?.kind !== "delete-slide" && (!dialog?.value.trim() || [...dialog.value.trim()].length > LIMITS.titleCodePoints)} onClick={submitDialog}>
              {dialog?.kind === "delete-slide" ? "ลบสไลด์" : "บันทึกชื่อ"}</button>
          </div>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
      {tooNarrow && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 p-6" role="alertdialog" aria-label="หน้าจอแคบเกินไป">
        <div className="card max-w-sm p-6 text-center"><h2 className="text-lg font-semibold">แนะนำให้ใช้คอมพิวเตอร์</h2>
          <p className="muted mt-2 text-sm">กระดานวาดออกแบบสำหรับหน้าจอกว้างตั้งแต่ 1024×700 px ขยายหน้าต่างหรือใช้คอมพิวเตอร์เพื่อแก้บทเรียนนี้</p>
          <Link href="/projects" className="app-button mt-4">ไปหน้าโปรเจกต์</Link></div>
      </div>}
    </div>
  </ImageCacheContext.Provider>;
}
