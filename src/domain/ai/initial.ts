import type { AiState } from "./model";

/** Starting point of the AI lesson (plan 07 §5). Fresh objects on every call; also the Reset target. */
export function createInitialAiState(): AiState {
  return {
    version: 1,
    history: { messages: [], shown: 0 },
    thinking: { on: false, puzzle: null, thoughts: [], answer: null, correct: null, seconds: 0 },
    memory: { on: true, items: [], messages: [], shown: 0, chat: 1 },
    agent: { code: "bug", tests: "unknown", web: { asked: false, answer: null }, log: [] },
    cc: { rules: ["ใช้ pnpm ติดตั้งแพ็กเกจ", "เขียนเทสต์ทุกครั้งที่แก้โค้ด"], memories: [], session: 0, context: 0, chat: [], summarized: false },
  };
}
