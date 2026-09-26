import type { Hop, Spot } from "@/domain/data/model";
import type { AiView } from "@/domain/ai/model";

// Pure geometry of the AI widget (plan 07 §5), widget base coordinates 1120×680 like the other flow widgets.

export type Box = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

export const AI_W = 1120;
export const AI_H = 680;
export const CAPTION_BOX: Box = { x: 24, y: 620, w: 1072, h: 46 };

export const AI_VIEWS: { id: AiView; label: string; description: string }[] = [
  { id: "history", label: "ทำไม AI จำแชทได้", description: "ทุกครั้งที่ส่ง แอปแชทส่งบทสนทนาทั้งหมดให้ AI อ่านใหม่ ถ้ายาวเกินจะหลุด" },
  { id: "thinking", label: "คิดก่อนตอบ (Chain of Thought)", description: "เขียนความคิดทีละขั้นก่อนตอบ: ช้ากว่าแต่ถูกกว่า" },
  { id: "memory", label: "Memory ของ AI บนเว็บ", description: "แอปจดเรื่องของเราไว้นอกตัว AI แล้วแนบไปกับแชทใหม่" },
  { id: "agent", label: "AI บนเว็บ vs Claude Code", description: "Claude Code ใช้เครื่องมือในเครื่องเรา: อ่านไฟล์ → รันเทสต์ → แก้โค้ด วนจนเสร็จ" },
  { id: "ccMemory", label: "ความจำของ Claude Code", description: "ทุกข้อความส่ง CLAUDE.md + ความจำ + บทสนทนาไปให้ AI ปิด session แล้วเหลือแค่ไฟล์" },
];

export type Scene = {
  /** The chat app the learner types in (it also keeps the history). One place, so “browser vs app” never splits. */
  chat?: Box;
  /** Step 3: the chat app as a whole, holding the conversation and its memory. */
  appFrame?: Box;
  /** The app's memory store (step 3). */
  memory?: Box;
  model: Box;
  /** Chain of thought box inside the model (step 2). */
  thoughts?: Box;
  /** Step 4 (web chat | AI | machine); `machine` is also step 5's frame. */
  machine?: Box;
  web?: Box;
  cc?: Box;
  files?: Box;
  tests?: Box;
  permission?: Box;
  /** Step 5. */
  claudeMd?: Box;
  memoryDir?: Box;
  pipes: { from: Pt; to: Pt; label?: string }[];
};

const center = (box: Box): Pt => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const right = (box: Box, y = box.y + box.h / 2): Pt => ({ x: box.x + box.w, y });
const left = (box: Box, y = box.y + box.h / 2): Pt => ({ x: box.x, y });

function historyScene(): Scene {
  const chat = { x: 40, y: 76, w: 480, h: 528 };
  const model = { x: 680, y: 76, w: 400, h: 528 };
  return { chat, model, pipes: [{ from: right(chat, 340), to: left(model, 340) }] };
}

function thinkingScene(): Scene {
  const chat = { x: 40, y: 76, w: 330, h: 528 };
  const model = { x: 440, y: 76, w: 640, h: 528 };
  const thoughts = { x: 466, y: 176, w: 588, h: 300 };
  return { chat, model, thoughts, pipes: [{ from: right(chat, 340), to: left(model, 340) }] };
}

function memoryScene(): Scene {
  const appFrame = { x: 24, y: 62, w: 640, h: 546 };
  const chat = { x: 40, y: 120, w: 370, h: 474 };
  const memory = { x: 426, y: 120, w: 222, h: 474 };
  const model = { x: 720, y: 76, w: 376, h: 528 };
  return { appFrame, chat, memory, model, pipes: [{ from: right(appFrame, 340), to: left(model, 340) }] };
}

function agentScene(): Scene {
  // Three columns: the web chat | the same AI in the middle | our machine with Claude Code.
  const web = { x: 24, y: 70, w: 316, h: 536 };
  const model = { x: 404, y: 150, w: 312, h: 380 };
  const machine = { x: 780, y: 70, w: 316, h: 536 };
  const cc = { x: 794, y: 132, w: 288, h: 214 };
  const files = { x: 794, y: 358, w: 288, h: 96 };
  const tests = { x: 794, y: 466, w: 288, h: 60 };
  const permission = { x: 794, y: 538, w: 288, h: 56 };
  return {
    web, model, machine, cc, files, tests, permission,
    pipes: [{ from: right(web, 340), to: left(model, 340) }, { from: right(model, 340), to: left(machine, 340) }],
  };
}

function ccMemoryScene(): Scene {
  // Files on disk (permanent) | the Claude Code session (temporary) | the AI.
  const machine = { x: 24, y: 70, w: 300, h: 536 };
  const claudeMd = { x: 38, y: 126, w: 272, h: 190 };
  const memoryDir = { x: 38, y: 330, w: 272, h: 262 };
  const cc = { x: 356, y: 70, w: 348, h: 536 };
  const model = { x: 736, y: 70, w: 360, h: 536 };
  return {
    machine, claudeMd, memoryDir, cc, model,
    pipes: [
      { from: right(claudeMd, 221), to: left(cc, 221) },
      { from: right(memoryDir, 461), to: left(cc, 461) },
      { from: right(cc, 338), to: left(model, 338) },
    ],
  };
}

const SCENES: Record<AiView, Scene> = { history: historyScene(), thinking: thinkingScene(), memory: memoryScene(), agent: agentScene(), ccMemory: ccMemoryScene() };
export const sceneOf = (view: AiView): Scene => SCENES[view];

/** Where a named place is drawn in a step (null = not drawn in this step: the packet lands at once). */
export function spotPoint(view: AiView, spot: Spot): Pt | null {
  const scene = sceneOf(view);
  const at = (box: Box | undefined) => (box ? center(box) : null);
  switch (spot) {
    case "chat": return at(scene.chat);
    case "memory": return at(scene.memory);
    case "model": return at(scene.model);
    case "thoughts": return at(scene.thoughts);
    case "web": return at(scene.web);
    case "cc": return at(scene.cc);
    case "files": return at(scene.files);
    case "tests": return at(scene.tests);
    case "gate": return at(scene.permission);
    case "claudeMd": return at(scene.claudeMd);
    case "memoryDir": return at(scene.memoryDir);
  }
  return null;
}

/** Polyline for a hop: straight between the two places (every step keeps its travellers on one line). */
export function hopPath(view: AiView, move: Hop): Pt[] | null {
  const start = spotPoint(view, move.from);
  const end = spotPoint(view, move.to);
  return start && end ? [start, end] : null;
}
