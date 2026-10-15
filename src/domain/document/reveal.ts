import type { FlowFrame } from "../data/model";
import type { DocumentTransaction } from "./commands";
import type { WidgetNode } from "./model";

// Progressive reveal of teaching widgets (plan 07 §2): the teacher shows the scene part by part while explaining.
// A widget stores one number, `reveal` = how many of its step's ordered parts are shown (missing = mode off, all shown).
// Everything here is pure; each simulator declares its parts next to its layout code and passes them in.

/** One part of a simulator step, in the order the teacher reveals them. Ids are stable within a step; labels are Thai. */
export type RevealPart = { id: string; label: string };
/** Largest `reveal` the schema accepts (more parts than this in one step is too many to click through). */
export const REVEAL_MAX = 12;

/** Whether the mode is on for this widget. */
export const revealOn = (reveal: number | undefined): reveal is number => reveal !== undefined;
/** How many parts are shown (all of them when the mode is off). */
export const revealedCount = (parts: readonly RevealPart[], reveal: number | undefined): number => revealOn(reveal) ? Math.min(reveal, parts.length) : parts.length;
/** `shows(partId)`: false for hidden parts and for ids the step does not have. Mode off = everything is shown, even undeclared ids. */
export function partFilter(parts: readonly RevealPart[], reveal: number | undefined): (id: string) => boolean {
  if (!revealOn(reveal)) return () => true;
  const shown = new Set(parts.slice(0, Math.min(reveal, parts.length)).map((part) => part.id));
  return (id) => shown.has(id);
}
/** The part a press of “แสดงส่วนถัดไป” shows, or null when none is left (or the mode is off). */
export const nextPart = (parts: readonly RevealPart[], reveal: number | undefined): RevealPart | null =>
  revealOn(reveal) ? parts[Math.min(reveal, parts.length)] ?? null : null;
/** Whether there is a part left to show. */
export const hasPartsLeft = (parts: readonly RevealPart[], reveal: number | undefined): boolean => nextPart(parts, reveal) !== null;

/** Result of a transition: the new `reveal` value (undefined = mode off). */
export const revealToggle = (on: boolean): number | undefined => on ? 0 : undefined;
export const revealNext = (parts: readonly RevealPart[], reveal: number | undefined): number | undefined =>
  revealOn(reveal) ? Math.min(parts.length, revealedCount(parts, reveal) + 1) : undefined;
export const revealAll = (parts: readonly RevealPart[], reveal: number | undefined): number | undefined => revealOn(reveal) ? parts.length : undefined;
export const revealHide = (reveal: number | undefined): number | undefined => revealOn(reveal) ? 0 : undefined;
/** A new lesson step starts hidden again when the mode is on. */
export const revealOnStepChange = revealHide;
/**
 * Shows what an action needs. Parts are revealed in order, so the count rises to the last needed part
 * (never falls). Ids the step does not have are ignored; mode off stays off.
 */
export function revealForParts(parts: readonly RevealPart[], reveal: number | undefined, needed: Iterable<string>): number | undefined {
  if (!revealOn(reveal)) return undefined;
  let count = reveal;
  for (const id of needed) {
    const index = parts.findIndex((part) => part.id === id);
    if (index >= 0) count = Math.max(count, index + 1);
  }
  return Math.min(count, parts.length);
}
/** The widget with `reveal` set (the key is dropped when undefined, so old documents stay byte-identical). */
export function withReveal<N extends WidgetNode>(node: N, reveal: number | undefined): N {
  const { reveal: _previous, ...rest } = node;
  void _previous;
  return (reveal === undefined ? rest : { ...rest, reveal }) as N;
}

/**
 * Parts a flow action touches: for every frame, the parts of the places its packet leaves/enters and of its marks,
 * plus `along(hop)` (parts a packet passes on the way, e.g. a gate). `partOfSpot` returns null for places in no part.
 */
export function partsOfFrames(frames: readonly FlowFrame<unknown>[], partOfSpot: (spot: string) => string | null,
  along?: (hop: NonNullable<FlowFrame<unknown>["hop"]>) => string[]): string[] {
  const ids = new Set<string>();
  const add = (spot: string) => { const id = partOfSpot(spot); if (id) ids.add(id); };
  for (const frame of frames) {
    if (frame.hop) { add(frame.hop.from); add(frame.hop.to); for (const id of along?.(frame.hop) ?? []) ids.add(id); }
    for (const mark of frame.marks) add(mark.spot);
  }
  return [...ids];
}

/** One undoable step that sets a widget's `reveal` (the drawing room sees it too, the widget lives in the document). */
export const revealTransaction = (slideId: string, node: WidgetNode, reveal: number | undefined, label: string): DocumentTransaction => ({
  label, affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [withReveal(node, reveal)] }],
});
