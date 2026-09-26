import { create } from "zustand";
import type { GitOutcome, GitResultCode, MachineId, RepositoryId } from "../../domain/git/model";

/**
 * Session-only UI state of Git widgets (plan 04 §3): selected machine, latest result text, transfer animation,
 * commit preview and the commit message draft. Never persisted and never part of undo history.
 */

export type GitTab = "A" | "remote" | "B";
export type GitTransferAnimation = { from: RepositoryId; to: RepositoryId; commitIds: string[]; key: number };
export type GitResultMessage = { code: GitResultCode; outcome: GitOutcome; message: string };
/** Commit whose snapshot is shown (read-only) in a repository's file area. Session only; export never shows it. */
export type GitPreview = { repository: RepositoryId; commitId: string };

/** Long enough to follow on a projector; prefers-reduced-motion skips the animation. */
export const GIT_TRANSFER_DURATION_MS = 900;

type GitSessionState = {
  tabs: Record<string, GitTab>;
  results: Record<string, GitResultMessage | undefined>;
  transfers: Record<string, GitTransferAnimation | undefined>;
  preview: Record<string, GitPreview | undefined>;
  /** Commit message input per `${nodeId}:${machine}` (session input, not saved until Commit). */
  messages: Record<string, string | undefined>;
  setTab: (nodeId: string, tab: GitTab) => void;
  setResult: (nodeId: string, result: GitResultMessage | undefined) => void;
  startTransfer: (nodeId: string, transfer: GitTransferAnimation) => void;
  setPreview: (nodeId: string, preview: GitPreview | undefined) => void;
  setMessage: (nodeId: string, machine: MachineId, message: string) => void;
  /** Clears result, animation and preview of one widget (e.g. after its Reset demo). */
  clearNode: (nodeId: string) => void;
  /** Clears results, animations and previews for every widget (Undo/Redo/load/Reset). Tabs and message inputs stay. */
  clearAll: () => void;
};

let transferKey = 0;
/** Monotonic key for a new transfer animation (session only). */
export function nextTransferKey(): number {
  transferKey += 1;
  return transferKey;
}

export const messageKey = (nodeId: string, machine: MachineId) => `${nodeId}:${machine}`;

const omit = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

export const useGitSessionStore = create<GitSessionState>()((set, get) => ({
  tabs: {},
  results: {},
  transfers: {},
  preview: {},
  messages: {},
  setTab: (nodeId, tab) => set((state) => (state.tabs[nodeId] === tab ? state : { tabs: { ...state.tabs, [nodeId]: tab } })),
  setResult: (nodeId, result) => set((state) => ({ results: { ...state.results, [nodeId]: result } })),
  startTransfer: (nodeId, transfer) => {
    set((state) => ({ transfers: { ...state.transfers, [nodeId]: transfer } }));
    // Drop the finished animation so a remounted widget does not replay it.
    setTimeout(() => {
      if (get().transfers[nodeId]?.key === transfer.key) set((state) => ({ transfers: omit(state.transfers, nodeId) }));
    }, GIT_TRANSFER_DURATION_MS + 100);
  },
  setPreview: (nodeId, preview) => set((state) => ({ preview: { ...state.preview, [nodeId]: preview } })),
  setMessage: (nodeId, machine, message) => set((state) => ({ messages: { ...state.messages, [messageKey(nodeId, machine)]: message } })),
  clearNode: (nodeId) => set((state) => ({
    results: omit(state.results, nodeId),
    transfers: omit(state.transfers, nodeId),
    preview: omit(state.preview, nodeId),
  })),
  clearAll: () => set({ results: {}, transfers: {}, preview: {} }),
}));
