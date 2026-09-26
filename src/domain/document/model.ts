import type { DataState, DataView } from "../data/model";
import type { DeployState, DeployView } from "../deploy/model";
import type { GitSimulationState } from "../git/model";

export type Point = { x: number; y: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type StrokeStyle = {
  stroke: string;
  strokeWidth: number;
  strokeStyle: "solid" | "dashed";
};
export type NodeBase = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  locked: boolean;
};
export type RectNode = NodeBase & StrokeStyle & {
  type: "rectangle";
  width: number;
  height: number;
  fill: string;
};
export type EllipseNode = NodeBase & StrokeStyle & {
  type: "ellipse";
  width: number;
  height: number;
  fill: string;
};
export type LineNode = NodeBase & StrokeStyle & {
  type: "line";
  points: [Point, Point];
};
export type ArrowNode = NodeBase & StrokeStyle & {
  type: "arrow";
  points: [Point, Point];
  headLength: number;
  headWidth: number;
};
export type FreehandNode = NodeBase & StrokeStyle & {
  type: "pen" | "highlighter";
  points: Point[];
};
export type TextNode = NodeBase & {
  type: "text";
  text: string;
  width: number;
  fontFamily: "Noto Sans Thai";
  fontSize: number;
  lineHeight: number;
  color: string;
  align: "left" | "center" | "right";
};
export type ImageNode = NodeBase & {
  type: "image";
  assetId: string;
  width: number;
  height: number;
};
/**
 * Lesson step shown by a Git widget (display only; the full state is always kept):
 * `local` = A → Git, `remote` = A → Git → GitHub, `full` = A+Git → GitHub → B+Git.
 * Missing in older documents means `full`.
 */
export type GitView = "local" | "remote" | "full";
export type GitSimulatorNode = NodeBase & {
  type: "git-simulator";
  rotation: 0;
  scale: number;
  view?: GitView;
  state: GitSimulationState;
};
export const gitViewOf = (node: GitSimulatorNode): GitView => node.view ?? "full";
/**
 * Base (scale 1) size of a Git widget. The two-machine step is wider so each machine keeps a full-size
 * file/Git layout; bounds, transforms, hit testing and export all read this one function.
 */
export const GIT_BASE_SIZE = { width: 1120, fullWidth: 1600, height: 680 } as const;
export function gitBaseSize(view: GitView): { width: number; height: number } {
  return { width: view === "full" ? GIT_BASE_SIZE.fullWidth : GIT_BASE_SIZE.width, height: GIT_BASE_SIZE.height };
}
export const gitNodeSize = (node: GitSimulatorNode) => gitBaseSize(gitViewOf(node));

/** Data-storage teaching simulator (plan 07 §3); `view` is its lesson step. */
export type DataSimulatorNode = NodeBase & {
  type: "data-simulator";
  rotation: 0;
  scale: number;
  view: DataView;
  state: DataState;
};
export const DATA_BASE_SIZE = { width: 1120, height: 680 } as const;

/** Deploy teaching simulator (plan 07 §4); `view` is its lesson step. */
export type DeploySimulatorNode = NodeBase & {
  type: "deploy-simulator";
  rotation: 0;
  scale: number;
  view: DeployView;
  state: DeployState;
};

/** Teaching widgets: drawn by their own renderer, uniform scale only, never rotated. */
export type WidgetNode = GitSimulatorNode | DataSimulatorNode | DeploySimulatorNode;
export const isWidgetNode = (node: CanvasNode): node is WidgetNode =>
  node.type === "git-simulator" || node.type === "data-simulator" || node.type === "deploy-simulator";
/** Widgets whose actions play as a flow (packets on pipes). */
export const isFlowWidget = (node: CanvasNode): node is DataSimulatorNode | DeploySimulatorNode => node.type === "data-simulator" || node.type === "deploy-simulator";
/** Base (scale 1) size of any teaching widget: the single source for bounds, transforms and export. */
export function widgetNodeSize(node: WidgetNode): { width: number; height: number } {
  // Data and deploy widgets share the 1120×680 frame in every step.
  return node.type === "git-simulator" ? gitNodeSize(node) : { ...DATA_BASE_SIZE };
}

export type CanvasNode =
  | RectNode | EllipseNode | LineNode | ArrowNode
  | FreehandNode | TextNode | ImageNode | GitSimulatorNode | DataSimulatorNode | DeploySimulatorNode;

export type SlideDocument = {
  id: string;
  name: string;
  background: string;
  nodes: CanvasNode[];
};
export type AssetReference = {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  storagePath: string;
};
export type ProjectDocument = {
  schemaVersion: 1;
  slides: SlideDocument[];
  assets: Record<string, AssetReference>;
};
export type ProjectContent = { title: string; document: ProjectDocument };
export type ProjectRecord = ProjectContent & {
  id: string;
  ownerId: string;
  revision: number;
  lastMutationId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type ProjectSummary = Pick<ProjectRecord, "id" | "ownerId" | "title" | "revision" | "updatedAt" | "createdAt">;

export function createSlide(name = "สไลด์ 1"): SlideDocument {
  return { id: crypto.randomUUID(), name, background: DEFAULT_BACKGROUND, nodes: [] };
}

const DEFAULT_BACKGROUND = "#FFFFFF";

export function createProjectContent(title = "บทเรียนใหม่"): ProjectContent {
  return { title, document: { schemaVersion: 1, slides: [createSlide()], assets: {} } };
}

const codePoints = (value: string) => [...value];

/** Appends a suffix while keeping the name within the 120 code point limit. */
export function withSuffix(name: string, suffix: string, limit = 120): string {
  const base = codePoints(name);
  const tail = codePoints(suffix);
  return base.slice(0, Math.max(1, limit - tail.length)).join("").trimEnd() + suffix;
}

/** Next automatic `สไลด์ N` name that does not collide with existing automatic names. */
export function nextSlideName(slides: SlideDocument[]): string {
  const used = new Set(slides.map((slide) => slide.name));
  let number = slides.length + 1;
  while (used.has(`สไลด์ ${number}`)) number++;
  return `สไลด์ ${number}`;
}

/** Deep copy of a slide with new slide/node IDs; assets are shared inside the same project. */
export function duplicateSlide(slide: SlideDocument): SlideDocument {
  return {
    ...structuredClone(slide),
    id: crypto.randomUUID(),
    name: withSuffix(slide.name, " สำเนา"),
    nodes: slide.nodes.map((node) => ({ ...structuredClone(node), id: crypto.randomUUID() })),
  };
}

/** Deep copies nodes with fresh IDs and an offset; Git state is copied independently. */
export function cloneNodes(nodes: CanvasNode[], dx: number, dy: number): CanvasNode[] {
  return nodes.map((node) => ({ ...structuredClone(node), id: crypto.randomUUID(), x: node.x + dx, y: node.y + dy }));
}
