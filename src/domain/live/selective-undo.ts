import type { DocumentCommand, DocumentTransaction } from "../document/commands";
import type { CanvasNode, ProjectContent, SlideDocument } from "../document/model";

// Per-person Undo in a shared lesson (plan 08 §undo): undoing reverts only what THIS person changed, on top of
// whatever the others did since. One step is described by the document before and after it (cheap: Immer shares
// everything that did not change); the inverse is computed against the current document:
// - objects I added are removed, objects I removed come back, and for objects I changed only the fields I changed
//   get their old values (someone else's move of the same object stays);
// - the same for slides (added/removed/renamed/background/order) and the lesson title.
// Redo is the same computation on the step the Undo made.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Current ids sorted by their position in `reference` (ids it does not know keep their relative place at the end). */
function orderLike(current: string[], reference: string[]): string[] {
  const rank = new Map(reference.map((id, index) => [id, index]));
  return [...current].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}
const relativeOrderChanged = (before: string[], after: string[]) => {
  const common = before.filter((id) => after.includes(id));
  return !same(common, after.filter((id) => before.includes(id)));
};

/** `current` with the fields that differ between `from` and `to` set back to their `from` value (lock excluded). */
function revertFields(current: CanvasNode, from: CanvasNode, to: CanvasNode): CanvasNode | null {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)].filter((key) => key !== "locked" && key !== "id" && key !== "type"));
  const next: Record<string, unknown> = { ...current };
  let changed = false;
  for (const key of keys) {
    const before = (from as unknown as Record<string, unknown>)[key];
    const after = (to as unknown as Record<string, unknown>)[key];
    if (same(before, after)) continue;
    if (same(next[key], before)) continue;
    if (before === undefined) delete next[key];
    else next[key] = before;
    changed = true;
  }
  return changed ? (next as unknown as CanvasNode) : null;
}

function nodeCommands(slideId: string, before: SlideDocument, after: SlideDocument, current: SlideDocument): DocumentCommand[] {
  const commands: DocumentCommand[] = [];
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  const currentById = new Map(current.nodes.map((node) => [node.id, node]));

  const remove = after.nodes.filter((node) => !beforeById.has(node.id) && currentById.has(node.id) && !currentById.get(node.id)!.locked).map((node) => node.id);
  if (remove.length) commands.push({ type: "nodes.remove", slideId, ids: remove });

  const restore = before.nodes.filter((node) => !afterById.has(node.id) && !currentById.has(node.id));
  if (restore.length) commands.push({ type: "nodes.insert", slideId, nodes: restore });

  const unlock: string[] = [], lock: string[] = [], replace: CanvasNode[] = [];
  for (const [id, from] of beforeById) {
    const to = afterById.get(id), now = currentById.get(id);
    if (!to || !now || same(from, to)) continue;
    // Lock state: I locked it → unlock first (so the fields can be reverted); I unlocked it → lock again at the end.
    const lockChanged = from.locked !== to.locked && now.locked === to.locked;
    const lockedAfterUnlock = lockChanged && !from.locked ? false : now.locked;
    if (lockChanged && !from.locked) unlock.push(id);
    const reverted = revertFields(now, from, to);
    if (reverted && !lockedAfterUnlock) replace.push({ ...reverted, locked: false });
    if (lockChanged && from.locked) lock.push(id);
  }
  if (unlock.length) commands.push({ type: "nodes.lock", slideId, ids: unlock, locked: false });
  if (replace.length) commands.push({ type: "nodes.replace", slideId, nodes: replace });
  if (lock.length) commands.push({ type: "nodes.lock", slideId, ids: lock, locked: true });

  // Order (bring to front / send back): put the current objects back in the order they had before my step.
  const beforeOrder = before.nodes.map((node) => node.id), afterOrder = after.nodes.map((node) => node.id);
  if (relativeOrderChanged(beforeOrder, afterOrder)) {
    const ids = [...current.nodes.filter((node) => !remove.includes(node.id)).map((node) => node.id), ...restore.map((node) => node.id)];
    const ordered = orderLike(ids, beforeOrder);
    if (!same(ordered, ids)) commands.push({ type: "nodes.reorder", slideId, orderedIds: ordered });
  }
  return commands;
}

/**
 * The transaction that undoes the step `before → after` on top of `current`, or null when nothing is left to undo
 * (everything was already changed back or removed by someone else).
 */
export function inverseTransaction(before: ProjectContent, after: ProjectContent, current: ProjectContent, label: string, affectedSlideId: string | null): DocumentTransaction | null {
  const commands: DocumentCommand[] = [];
  if (before.title !== after.title && current.title === after.title) commands.push({ type: "project.rename", title: before.title });

  const beforeSlides = before.document.slides, afterSlides = after.document.slides;
  const beforeById = new Map(beforeSlides.map((slide) => [slide.id, slide]));
  const afterById = new Map(afterSlides.map((slide) => [slide.id, slide]));
  const currentSlides = current.document.slides;
  const currentById = new Map(currentSlides.map((slide) => [slide.id, slide]));

  // Slides I added go away (never the last one).
  let remaining = currentSlides.length;
  for (const slide of afterSlides) {
    if (beforeById.has(slide.id) || !currentById.has(slide.id) || remaining <= 1) continue;
    commands.push({ type: "slide.remove", slideId: slide.id });
    remaining -= 1;
  }
  // Slides I removed come back where they were.
  beforeSlides.forEach((slide, index) => {
    if (afterById.has(slide.id) || currentById.has(slide.id)) return;
    commands.push({ type: "slide.insert", slide, at: Math.min(index, remaining) });
    remaining += 1;
  });
  for (const [id, from] of beforeById) {
    const to = afterById.get(id), now = currentById.get(id);
    if (!to || !now || from === to) continue;
    const update: { type: "slide.update"; slideId: string; name?: string; background?: string } = { type: "slide.update", slideId: id };
    if (from.name !== to.name && now.name !== from.name) update.name = from.name;
    if (from.background !== to.background && now.background !== from.background) update.background = from.background;
    if (update.name !== undefined || update.background !== undefined) commands.push(update);
    if (from.nodes !== to.nodes) commands.push(...nodeCommands(id, from, to, now));
  }
  const beforeOrder = beforeSlides.map((slide) => slide.id), afterOrder = afterSlides.map((slide) => slide.id);
  if (relativeOrderChanged(beforeOrder, afterOrder)) {
    // Simulate the slide additions/removals above to know the order the reorder applies to.
    const removed = new Set(commands.flatMap((command) => (command.type === "slide.remove" ? [command.slideId] : [])));
    let ids = currentSlides.map((slide) => slide.id).filter((slideId) => !removed.has(slideId));
    for (const command of commands) if (command.type === "slide.insert") ids = [...ids.slice(0, command.at), command.slide.id, ...ids.slice(command.at)];
    const ordered = orderLike(ids, beforeOrder);
    if (!same(ordered, ids)) commands.push({ type: "slide.reorder", orderedIds: ordered });
  }
  return commands.length ? { label, affectedSlideId, commands } : null;
}
