import { applyPatches, freeze, type Patch } from "immer";
import { LIMITS } from "./limits";
import { applyDocumentCommand, type DocumentTransaction, type CommandResult } from "./commands";
import type { ProjectContent } from "./model";

type HistoryEntry = { label: string; affectedSlideId: string | null; patches: Patch[]; inversePatches: Patch[] };
export type HistoryState = {
  content: ProjectContent;
  past: HistoryEntry[];
  future: HistoryEntry[];
};
/** Deep-freezes the loaded document once so later Immer transactions only freeze what they change. */
export function createHistory(content: ProjectContent): HistoryState { return { content: freeze(content, true), past: [], future: [] }; }
export function commitTransaction(history: HistoryState, transaction: DocumentTransaction): { history: HistoryState; result: CommandResult } {
  const result = applyDocumentCommand(history.content, transaction);
  if (!result.changed) return { history, result };
  const entry = { label: transaction.label, affectedSlideId: transaction.affectedSlideId, patches: result.patches, inversePatches: result.inversePatches };
  return {
    result,
    history: { content: result.content, past: [...history.past, entry].slice(-LIMITS.history), future: [] },
  };
}
export function undo(history: HistoryState): { history: HistoryState; affectedSlideId: string | null } {
  const entry = history.past.at(-1);
  if (!entry) return { history, affectedSlideId: null };
  return {
    affectedSlideId: entry.affectedSlideId,
    history: { content: applyPatches(history.content, entry.inversePatches), past: history.past.slice(0, -1), future: [entry, ...history.future] },
  };
}
export function redo(history: HistoryState): { history: HistoryState; affectedSlideId: string | null } {
  const [entry, ...rest] = history.future;
  if (!entry) return { history, affectedSlideId: null };
  return {
    affectedSlideId: entry.affectedSlideId,
    history: { content: applyPatches(history.content, entry.patches), past: [...history.past, entry], future: rest },
  };
}
