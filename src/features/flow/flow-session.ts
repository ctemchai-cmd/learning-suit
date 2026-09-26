import { create } from "zustand";
import type { FlowFrame } from "@/domain/data/model";

/**
 * Session-only playback of flow simulators (plan 07 §2): which frame of the last action each widget
 * shows, whether its packet is still travelling, and the teacher's playback preferences.
 * Never saved and never part of Undo; Undo/Redo/load clear every play.
 */

export type FlowPhase = "moving" | "landed";
export type FlowPlay = {
  key: number;
  /** Board state before the first frame. */
  initial: unknown;
  frames: FlowFrame<unknown>[];
  index: number;
  phase: FlowPhase;
};
export type FlowSpeed = "normal" | "slow";
export type FlowResult = { outcome: "success" | "rejected" | "noop" | "failed"; message: string };

/** Travel time of one packet and the pause after it lands (auto play), per speed. */
export const FLOW_TIMING: Record<FlowSpeed, { travel: number; pause: number }> = {
  normal: { travel: 1100, pause: 1100 },
  slow: { travel: 2000, pause: 1900 },
};

type FlowSession = {
  plays: Record<string, FlowPlay | undefined>;
  results: Record<string, FlowResult | undefined>;
  /** true = frames advance by themselves; false = the teacher presses “ถัดไป” after each frame. */
  auto: boolean;
  speed: FlowSpeed;
  start: (nodeId: string, initial: unknown, frames: FlowFrame<unknown>[]) => void;
  /** The packet of frame `key`/`index` arrived (ignored if the play changed meanwhile). */
  land: (nodeId: string, key: number, index: number) => void;
  next: (nodeId: string) => void;
  /** Play the last action again from its first frame (visual only; the document is unchanged). */
  replay: (nodeId: string) => void;
  /** Jump to the last frame. */
  finish: (nodeId: string) => void;
  stop: (nodeId: string) => void;
  setResult: (nodeId: string, result: FlowResult | undefined) => void;
  setAuto: (auto: boolean) => void;
  setSpeed: (speed: FlowSpeed) => void;
  clearAll: () => void;
};

let playKey = 0;
const phaseOf = (frame: FlowFrame<unknown> | undefined): FlowPhase => frame?.hop ? "moving" : "landed";

export const useFlowSession = create<FlowSession>()((set, get) => ({
  plays: {},
  results: {},
  auto: true,
  speed: "normal",
  start: (nodeId, initial, frames) => {
    if (!frames.length) return;
    playKey += 1;
    set((state) => ({ plays: { ...state.plays, [nodeId]: { key: playKey, initial, frames, index: 0, phase: phaseOf(frames[0]) } } }));
  },
  land: (nodeId, key, index) => {
    const play = get().plays[nodeId];
    if (!play || play.key !== key || play.index !== index || play.phase === "landed") return;
    set((state) => ({ plays: { ...state.plays, [nodeId]: { ...play, phase: "landed" } } }));
  },
  next: (nodeId) => {
    const play = get().plays[nodeId];
    if (!play || play.phase !== "landed" || play.index >= play.frames.length - 1) return;
    const index = play.index + 1;
    set((state) => ({ plays: { ...state.plays, [nodeId]: { ...play, index, phase: phaseOf(play.frames[index]) } } }));
  },
  replay: (nodeId) => {
    const play = get().plays[nodeId];
    if (!play) return;
    playKey += 1;
    set((state) => ({ plays: { ...state.plays, [nodeId]: { ...play, key: playKey, index: 0, phase: phaseOf(play.frames[0]) } } }));
  },
  finish: (nodeId) => {
    const play = get().plays[nodeId];
    if (!play) return;
    set((state) => ({ plays: { ...state.plays, [nodeId]: { ...play, index: play.frames.length - 1, phase: "landed" } } }));
  },
  stop: (nodeId) => set((state) => {
    if (!state.plays[nodeId]) return state;
    const plays = { ...state.plays };
    delete plays[nodeId];
    return { plays };
  }),
  setResult: (nodeId, result) => set((state) => ({ results: { ...state.results, [nodeId]: result } })),
  setAuto: (auto) => set({ auto }),
  setSpeed: (speed) => set({ speed }),
  clearAll: () => set({ plays: {}, results: {} }),
}));

/** What the board shows for a play: the state before the moving packet lands, or the landed frame's state. */
export function playView<S>(play: FlowPlay | undefined, fallback: S): { state: S; frame: FlowFrame<S> | null; landed: boolean } {
  if (!play) return { state: fallback, frame: null, landed: false };
  const frame = play.frames[play.index] as FlowFrame<S>;
  if (play.phase === "landed") return { state: frame.state, frame, landed: true };
  const before = play.index === 0 ? play.initial as S : (play.frames[play.index - 1] as FlowFrame<S>).state;
  return { state: before, frame, landed: false };
}

export type Waiting = "load" | "save" | "refresh";

/**
 * Whether the app at `spot` shows a spinner right now: from the moment it sends something (or an answer
 * starts travelling to it) until that answer lands; `refresh` while its app restarts. The spinner is tied
 * to the moving packet, so the list on the screen changes exactly when the packet arrives.
 */
export function waitingAt(play: FlowPlay | null | undefined, spot: string): Waiting | null {
  if (!play) return null;
  const { frames, index, phase } = play;
  const current = frames[index];
  if (current?.marks.some((mark) => mark.spot === spot && mark.tone === "refresh")) return "refresh";
  const pending = (i: number) => i > index || (i === index && phase === "moving");
  const answerLater = frames.findIndex((frame, i) => pending(i) && frame.hop?.to === spot);
  if (answerLater < 0) return null;
  // The request this app is waiting for: the last thing it sent before the answer arrives.
  let sent = -1;
  for (let i = 0; i <= Math.min(index, answerLater); i++) if (frames[i].hop?.from === spot) sent = i;
  const arriving = answerLater === index && phase === "moving";
  if (sent < 0 && !arriving) return null;
  if (sent < 0) return "load";
  return frames[sent].hop!.tone === "request" ? "load" : "save";
}
