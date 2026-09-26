import type { FlowFrame } from "../data/model";

// AI teaching simulator (plan 07 §5). Pure types: no React, no Konva, no network — and no real AI:
// every answer is scripted so the lesson is the same every time and costs nothing.

/** Lesson steps: chat history → chain of thought → memory of a web AI → web AI vs Claude Code → Claude Code's memory. */
export type AiView = "history" | "thinking" | "memory" | "agent" | "ccMemory";

/** One chat bubble. `out` = fell out of the context window: still on the screen, but the AI no longer receives it. */
export type ChatMsg = { role: "user" | "ai"; text: string; out?: true };
export type FactKey = "name" | "job" | "like";
export type MemoryItem = { key: FactKey; value: string };
export type PuzzleId = "pen" | "letters" | "apples";

export type AiState = {
  version: 1;
  /**
   * Step 1: `messages` = the chat app's history; `shown` = how many bubbles its screen shows yet;
   * `reading` = the model is holding what it was sent this turn (it forgets it right after answering).
   */
  history: { messages: ChatMsg[]; shown: number; reading?: true };
  /** Step 2: the last question and how it was answered. */
  thinking: { on: boolean; puzzle: PuzzleId | null; thoughts: string[]; answer: string | null; correct: boolean | null; seconds: number };
  /** Step 3: the app's memory (outside the model) and the current chat (`chat` = its number). */
  memory: { on: boolean; items: MemoryItem[]; messages: ChatMsg[]; shown: number; chat: number; reading?: true };
  /** Step 4: one small project with a bug, the web chat, and Claude Code's terminal. */
  agent: { code: "bug" | "fixed"; tests: "unknown" | "fail" | "pass"; web: { asked: boolean; answer: string | null }; log: string[] };
  /**
   * Step 5: CLAUDE.md and memory files (on disk, permanent), one Claude Code session (temporary) with its
   * context usage; `reading` = the model holds what it was sent this turn.
   */
  cc: { rules: string[]; memories: string[]; session: number; context: number; chat: string[]; summarized: boolean; reading?: true };
};

export type AiAction =
  | { type: "chat.send"; text: string }
  | { type: "chat.new" }
  | { type: "think.set"; on: boolean }
  | { type: "think.ask"; puzzle: PuzzleId }
  | { type: "memory.set"; on: boolean }
  | { type: "memory.send"; text: string }
  | { type: "memory.newChat" }
  | { type: "memory.clear" }
  | { type: "agent.web" }
  | { type: "agent.cc" }
  | { type: "agent.reset" }
  | { type: "cc.start" }
  | { type: "cc.say"; say: CcSay }
  | { type: "cc.compact" }
  | { type: "cc.forget" }
  | { type: "reset" };
export type CcSay = "thai" | "work" | "ask";

/** `failed` = the flow ran and shows a problem on purpose (forgot, wrong answer …): red in the panel. */
export type AiOutcome = "success" | "rejected" | "noop" | "failed";
export type AiTransition = { nextState: AiState; changed: boolean; outcome: AiOutcome; message: string; frames: FlowFrame<AiState>[] };

export const AI_LIMITS = {
  /** What the teacher can type. */
  inputCodePoints: 80,
  /** Any stored line (bubbles, thoughts, log …). */
  lineCodePoints: 120,
  /** Stored chat bubbles per chat (older ones are dropped: they are out of the window anyway). */
  messages: 24,
  /** Step 1: the context window holds this many messages (a simplified stand-in for tokens). */
  window: 6,
  /** Step 5: context units of one Claude Code session before it summarizes. */
  ccContext: 10,
  ccMemories: 4,
  ccChat: 8,
  log: 10,
} as const;
