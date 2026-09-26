"use client";

import { useEffect } from "react";
import type { FlowFrame, Hop, Mark } from "@/domain/data/model";
import { FLOW_TIMING, playView, useFlowSession, type FlowPlay } from "./flow-session";

/**
 * Shared playback of a flow widget (plan 07 §2): what to draw for the current frame, the packet that is
 * travelling, and the timers — auto play advances after each landing; a hop whose places are not drawn in
 * this step lands at once. Export passes `play = null` and gets the stored state without timers.
 */
export function useFlowPlayback<S, P>(nodeId: string, play: FlowPlay | null, stored: S, pathOf: (before: S, after: S, move: Hop) => P[] | null) {
  const auto = useFlowSession((s) => s.auto);
  const speed = useFlowSession((s) => s.speed);
  const shown = playView<S>(play ?? undefined, stored);
  const frame: FlowFrame<S> | null = shown.frame;
  const marks = new Map<string, Mark>((shown.landed && frame ? frame.marks : []).map((mark) => [mark.spot, mark]));
  const moving = play && frame?.hop && !shown.landed ? frame.hop : null;
  const path = moving && frame ? pathOf(shown.state, frame.state, moving) : null;
  const last = play ? play.frames.length - 1 : 0;

  useEffect(() => {
    if (!play || play.phase !== "landed" || !auto || play.index >= last) return;
    const timer = setTimeout(() => useFlowSession.getState().next(nodeId), FLOW_TIMING[speed].pause);
    return () => clearTimeout(timer);
  }, [play, auto, speed, last, nodeId]);
  useEffect(() => {
    if (play && moving && !path) useFlowSession.getState().land(nodeId, play.key, play.index);
  }, [play, moving, path, nodeId]);

  return {
    state: shown.state,
    frame,
    marks,
    moving,
    path,
    travel: FLOW_TIMING[speed].travel,
    step: play ? `${play.index + 1}/${play.frames.length}` : null,
    runKey: play ? `${play.key}-${play.index}` : "",
    onLanded: () => { if (play) useFlowSession.getState().land(nodeId, play.key, play.index); },
  };
}
