import { enablePatches, produceWithPatches, type Patch } from "immer";
import { assetSchema, canvasNodeSchema, colorSchema, documentInvariantIssues, slideSchema, titleSchema } from "./schema";
import type { AssetReference, CanvasNode, ProjectContent, SlideDocument } from "./model";

enablePatches();

export type DocumentCommand =
  | { type: "project.rename"; title: string }
  | { type: "slide.insert"; slide: SlideDocument; at: number }
  | { type: "slide.update"; slideId: string; name?: string; background?: string }
  | { type: "slide.reorder"; orderedIds: string[] }
  | { type: "slide.remove"; slideId: string }
  | { type: "nodes.insert"; slideId: string; nodes: CanvasNode[] }
  | { type: "nodes.replace"; slideId: string; nodes: CanvasNode[] }
  | { type: "nodes.remove"; slideId: string; ids: string[] }
  | { type: "nodes.reorder"; slideId: string; orderedIds: string[] }
  | { type: "nodes.lock"; slideId: string; ids: string[]; locked: boolean }
  | { type: "assets.register"; assets: AssetReference[] };
export type DocumentTransaction = {
  label: string;
  affectedSlideId: string | null;
  commands: DocumentCommand[];
};
export type CommandResult =
  | { status: "applied"; changed: true; content: ProjectContent; patches: Patch[]; inversePatches: Patch[] }
  | { status: "noop"; changed: false; content: ProjectContent }
  | { status: "invalid"; changed: false; content: ProjectContent; code: string; message: string };

class InvalidCommand extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function requireCondition(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new InvalidCommand(code, message);
}

function exactOrder(existing: string[], ordered: string[]): boolean {
  return existing.length === ordered.length && new Set(ordered).size === ordered.length && existing.every((id) => ordered.includes(id));
}

function applyOne(content: ProjectContent, command: DocumentCommand): void {
  if (command.type === "project.rename") {
    if (content.title !== command.title) content.title = command.title;
    return;
  }
  if (command.type === "assets.register") {
    for (const asset of command.assets) {
      requireCondition(!content.document.assets[asset.id], "ASSET_EXISTS", "Asset ID already exists");
      content.document.assets[asset.id] = asset;
    }
    return;
  }
  if (command.type === "slide.insert") {
    requireCondition(Number.isInteger(command.at) && command.at >= 0 && command.at <= content.document.slides.length, "BAD_INDEX", "Invalid slide position");
    content.document.slides.splice(command.at, 0, command.slide);
    return;
  }
  if (command.type === "slide.reorder") {
    requireCondition(exactOrder(content.document.slides.map((slide) => slide.id), command.orderedIds), "BAD_ORDER", "Slide order does not match current slides");
    if (content.document.slides.every((slide, index) => slide.id === command.orderedIds[index])) return;
    content.document.slides.sort((a, b) => command.orderedIds.indexOf(a.id) - command.orderedIds.indexOf(b.id));
    return;
  }
  const slide = content.document.slides.find((item) => item.id === command.slideId);
  requireCondition(slide, "SLIDE_MISSING", "Slide does not exist");
  if (command.type === "slide.update") {
    if (command.name !== undefined && command.name !== slide.name) slide.name = command.name;
    if (command.background !== undefined && command.background !== slide.background) slide.background = command.background;
    return;
  }
  if (command.type === "slide.remove") {
    requireCondition(content.document.slides.length > 1, "LAST_SLIDE", "The last slide cannot be deleted");
    content.document.slides.splice(content.document.slides.indexOf(slide), 1);
    return;
  }
  if (command.type === "nodes.insert") {
    slide.nodes.push(...command.nodes);
    return;
  }
  if (command.type === "nodes.reorder") {
    requireCondition(exactOrder(slide.nodes.map((node) => node.id), command.orderedIds), "BAD_ORDER", "Node order does not match current nodes");
    if (slide.nodes.every((node, index) => node.id === command.orderedIds[index])) return;
    slide.nodes.sort((a, b) => command.orderedIds.indexOf(a.id) - command.orderedIds.indexOf(b.id));
    return;
  }
  if (command.type === "nodes.replace") {
    requireCondition(new Set(command.nodes.map((node) => node.id)).size === command.nodes.length, "DUPLICATE_ID", "Duplicate replacement IDs");
    for (const replacement of command.nodes) {
      const index = slide.nodes.findIndex((node) => node.id === replacement.id);
      requireCondition(index >= 0, "NODE_MISSING", "Node does not exist");
      const current = slide.nodes[index];
      requireCondition(!current.locked && current.locked === replacement.locked && current.type === replacement.type, "NODE_LOCKED", "Locked node or invalid replacement");
      // Identical replacements are skipped so an unchanged document keeps its reference (no-op).
      if (JSON.stringify(current) !== JSON.stringify(replacement)) slide.nodes[index] = replacement;
    }
    return;
  }
  if (command.type === "nodes.remove" || command.type === "nodes.lock") {
    requireCondition(new Set(command.ids).size === command.ids.length, "DUPLICATE_ID", "Duplicate node IDs");
    for (const id of command.ids) {
      const node = slide.nodes.find((item) => item.id === id);
      requireCondition(node, "NODE_MISSING", "Node does not exist");
      if (command.type === "nodes.remove") requireCondition(!node.locked, "NODE_LOCKED", "Locked node cannot be deleted");
      else if (node.locked !== command.locked) node.locked = command.locked;
    }
    if (command.type === "nodes.remove") slide.nodes = slide.nodes.filter((node) => !command.ids.includes(node.id));
    return;
  }
  command satisfies never;
}

/**
 * Incremental validation: every object a command brings in is checked with its schema, then the
 * document-wide invariants run. Untouched objects were validated when the document was loaded
 * (parseProjectContent) or by the transaction that introduced them, so the document stays valid
 * without re-parsing 100k path points on every edit (PERF-03).
 */
function validateIncoming(command: DocumentCommand): void {
  const check = (result: { success: boolean; error?: { message: string } }) => {
    if (!result.success) throw new InvalidCommand("VALIDATION", result.error?.message ?? "Invalid value");
  };
  switch (command.type) {
    case "project.rename": return check(titleSchema.safeParse(command.title));
    case "slide.insert": return check(slideSchema.safeParse(command.slide));
    case "slide.update":
      if (command.name !== undefined) check(titleSchema.safeParse(command.name));
      if (command.background !== undefined) check(colorSchema.safeParse(command.background));
      return;
    case "nodes.insert":
    case "nodes.replace":
      for (const node of command.nodes) check(canvasNodeSchema.safeParse(node));
      return;
    case "nodes.lock":
      if (typeof command.locked !== "boolean") throw new InvalidCommand("VALIDATION", "locked must be boolean");
      return;
    case "assets.register":
      for (const asset of command.assets) check(assetSchema.safeParse(asset));
      return;
    default:
      return;
  }
}

export function applyDocumentCommand(content: ProjectContent, transaction: DocumentTransaction): CommandResult {
  try {
    requireCondition(transaction.commands.length > 0, "EMPTY", "Transaction must contain a command");
    for (const command of transaction.commands) validateIncoming(command);
    const [next, patches, inversePatches] = produceWithPatches(content, (draft) => {
      for (const command of transaction.commands) applyOne(draft, command);
    });
    if (next === content || patches.length === 0) return { status: "noop", changed: false, content };
    const issues = documentInvariantIssues(next);
    if (issues.length) throw new InvalidCommand("VALIDATION", issues[0]);
    return { status: "applied", changed: true, content: next, patches, inversePatches };
  } catch (error) {
    const reason = error instanceof InvalidCommand ? error : null;
    return { status: "invalid", changed: false, content, code: reason?.code ?? "VALIDATION", message: reason?.message ?? (error instanceof Error ? error.message : "Invalid document") };
  }
}
