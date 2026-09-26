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
  { id: "ccMemory", label: "ความจำของ Claude Code", description: "CLAUDE.md + ไฟล์ความจำโหลดทุก session บทสนทนายาวถูกสรุปย่อ" },
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
  /** Step 4. */
  webBand?: Box;
  machine?: Box;
  web?: Box;
  webNote?: Box;
  cc?: Box;
  files?: Box;
  tests?: Box;
  gate?: Pt;
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
  const webBand = { x: 24, y: 62, w: 800, h: 216 };
  const web = { x: 40, y: 94, w: 470, h: 172 };
  const webNote = { x: 530, y: 104, w: 278, h: 140 };
  const machine = { x: 24, y: 290, w: 800, h: 318 };
  const cc = { x: 40, y: 330, w: 330, h: 262 };
  const files = { x: 460, y: 330, w: 348, h: 150 };
  const tests = { x: 460, y: 496, w: 348, h: 96 };
  const model = { x: 860, y: 62, w: 236, h: 546 };
  const gate = { x: 415, y: 405 };
  return {
    webBand, web, webNote, machine, cc, files, tests, model, gate,
    pipes: [
      { from: right(web, 174), to: left(model, 174) },
      { from: { x: cc.x + cc.w, y: 405 }, to: gate },
      { from: gate, to: left(files, 405) },
      { from: { x: cc.x + cc.w, y: 544 }, to: left(tests, 544) },
      { from: { x: cc.x + cc.w, y: 488 }, to: left(model, 488) },
    ],
  };
}

function ccMemoryScene(): Scene {
  const machine = { x: 24, y: 62, w: 800, h: 546 };
  const claudeMd = { x: 44, y: 104, w: 300, h: 180 };
  const memoryDir = { x: 44, y: 302, w: 300, h: 290 };
  const cc = { x: 390, y: 104, w: 414, h: 488 };
  const model = { x: 860, y: 150, w: 236, h: 380 };
  return {
    machine, claudeMd, memoryDir, cc, model,
    pipes: [
      { from: right(claudeMd, 194), to: left(cc, 194) },
      { from: right(memoryDir, 446), to: left(cc, 446) },
      { from: right(cc, 340), to: left(model, 340) },
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
    case "gate": return scene.gate ?? null;
    case "claudeMd": return at(scene.claudeMd);
    case "memoryDir": return at(scene.memoryDir);
  }
  return null;
}

/** Polyline for a hop. Claude Code ↔ files passes the permission gate; Claude Code ↔ model leaves the machine on the right. */
export function hopPath(view: AiView, move: Hop): Pt[] | null {
  const start = spotPoint(view, move.from);
  const end = spotPoint(view, move.to);
  if (!start || !end) return null;
  const scene = sceneOf(view);
  if (view === "agent" && scene.gate) {
    const pair = `${move.from}>${move.to}`;
    if (pair === "cc>files" || pair === "files>cc") return [start, { x: 370, y: 405 }, scene.gate, { x: 460, y: 405 }, end];
    if (pair === "cc>tests" || pair === "tests>cc") return [start, { x: 370, y: 544 }, { x: 460, y: 544 }, end];
    // Between the files and the tests cards, out of the machine to the model.
    if (pair === "cc>model") return [start, { x: 370, y: 488 }, { x: 860, y: 488 }, end];
    if (pair === "model>cc") return [start, { x: 860, y: 488 }, { x: 370, y: 488 }, end];
  }
  return [start, end];
}
