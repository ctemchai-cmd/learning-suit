import type { FlowFrame } from "@/domain/data/model";

/**
 * Test helper: runs action sequences through a reducer and returns every frame it produced, so tests can derive
 * "the places the scenarios use" from the reducer itself instead of from the layout under test.
 */
export function walkFrames<S, A>(start: S, actions: readonly A[], apply: (state: S, action: A) => { nextState: S; changed: boolean; frames: FlowFrame<S>[] }, depth = 3, width = 40): FlowFrame<S>[] {
  const frames: FlowFrame<S>[] = [];
  let frontier: S[] = [start];
  for (let level = 0; level < depth; level++) {
    const next: S[] = [];
    for (const state of frontier) for (const action of actions) {
      const result = apply(state, action);
      frames.push(...result.frames);
      if (result.changed) next.push(result.nextState);
    }
    frontier = next.slice(0, width);
  }
  return frames;
}

/** Every place a list of frames names: hop ends and marks. */
export function spotsOfFrames(frames: readonly FlowFrame<unknown>[]): Set<string> {
  const spots = new Set<string>();
  for (const frame of frames) {
    if (frame.hop) { spots.add(frame.hop.from); spots.add(frame.hop.to); }
    for (const mark of frame.marks) spots.add(mark.spot);
  }
  return spots;
}
