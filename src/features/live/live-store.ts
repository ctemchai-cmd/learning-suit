"use client";

import { create } from "zustand";
import type { Participant } from "@/domain/live/protocol";

// UI state of a drawing room, kept apart from the editor store so cursors do not re-render the editor.

export type RoomStatus = "connecting" | "live" | "waiting-host" | "closed" | "error";
export type RemoteCursor = { slideId: string; x: number; y: number; at: number };

type LiveUiState = {
  role: "host" | "guest" | null;
  roomId: string | null;
  status: RoomStatus;
  me: Participant | null;
  participants: Participant[];
  cursors: Record<string, RemoteCursor>;
  /** Guest: switch slides together with the teacher. */
  follow: boolean;
  set: (patch: Partial<Omit<LiveUiState, "set">>) => void;
  setCursor: (id: string, cursor: RemoteCursor | null) => void;
};

export const useLiveStore = create<LiveUiState>((set) => ({
  role: null, roomId: null, status: "connecting", me: null, participants: [], cursors: {}, follow: true,
  set: (patch) => set(patch),
  setCursor: (id, cursor) => set((state) => {
    const cursors = { ...state.cursors };
    if (cursor) cursors[id] = cursor; else delete cursors[id];
    return { cursors };
  }),
}));
