import type { FlowFrame, FlowTone, Hop, Mark } from "../data/model";
import { FACT_LABEL, clip, factsFrom, factsIn, puzzleOf, replyTo } from "./chat";
import { createInitialAiState } from "./initial";
import { AI_LIMITS, type AiAction, type AiOutcome, type AiState, type AiTransition, type ChatMsg, type CcSay, type MemoryItem, type PuzzleId } from "./model";

// Pure scenarios of the AI simulator (plan 07 §5): the final state plus the frames the board plays.
// Nothing here calls an AI: answers come from the scripted rules in chat.ts.

const codePoints = (value: string) => [...value].length;
const hop = (from: string, to: string, label: string, tone: FlowTone = "data"): Hop => ({ from, to, label, tone });

class Flow {
  readonly frames: FlowFrame<AiState>[] = [];
  constructor(public state: AiState) {}
  step(move: Hop | null, caption: string, update?: (state: AiState) => AiState, marks: Mark[] = []): this {
    if (update) this.state = update(this.state);
    this.frames.push({ hop: move, caption, state: this.state, marks });
    return this;
  }
}
function finish(start: AiState, flow: Flow, outcome: AiOutcome, message: string): AiTransition {
  const changed = outcome !== "rejected" && JSON.stringify(flow.state) !== JSON.stringify(start);
  return { nextState: changed ? flow.state : start, changed, outcome: outcome === "success" && !changed ? "noop" : outcome, message, frames: flow.frames };
}
const noop = (state: AiState, message: string, outcome: AiOutcome = "noop"): AiTransition => ({ nextState: state, changed: false, outcome, message, frames: [] });

function validInput(raw: string): string | null {
  const text = raw.trim().replace(/\s+/gu, " ");
  return text && codePoints(text) <= AI_LIMITS.inputCodePoints ? text : null;
}
const INVALID_INPUT = `พิมพ์ข้อความ 1–${AI_LIMITS.inputCodePoints} ตัวอักษร`;

/** Keeps at most `AI_LIMITS.messages` bubbles (the oldest go first; they are out of the window anyway). */
function trimMessages(messages: ChatMsg[], shown: number): { messages: ChatMsg[]; shown: number } {
  const extra = Math.max(0, messages.length - AI_LIMITS.messages);
  return { messages: messages.slice(extra), shown: Math.max(0, shown - extra) };
}

// ---------------------------------------------------------------------------
// Step 1 — why the AI “remembers” the chat: the app sends the whole history every time
// ---------------------------------------------------------------------------

/** The messages the app sends to the model: the newest ones that fit the context window. */
export function contextWindow(messages: ChatMsg[]): ChatMsg[] {
  return messages.slice(Math.max(0, messages.length - AI_LIMITS.window));
}
function markOut(messages: ChatMsg[]): ChatMsg[] {
  const first = Math.max(0, messages.length - AI_LIMITS.window);
  return messages.map((message, index): ChatMsg => index < first ? { role: message.role, text: message.text, out: true } : { role: message.role, text: message.text });
}

function chatSend(state: AiState, raw: string): AiTransition {
  const text = validInput(raw);
  if (!text) return noop(state, INVALID_INPUT, "rejected");
  const flow = new Flow(state);
  const before = state.history.messages;
  flow.step(null, `คุณพิมพ์ “${text}” ในแอปแชท แล้วกดส่ง`,
    (s) => ({ ...s, history: trimMessages([...s.history.messages, { role: "user", text }], s.history.shown + 1) }), [{ spot: "chat", tone: "new" }]);
  const withNew = flow.state.history.messages;
  const newlyOut = markOut(withNew).filter((message, index) => message.out && !withNew[index].out).length;
  if (newlyOut) {
    flow.step(null, `แชทยาวเกินที่ AI รับได้ (${AI_LIMITS.window} ข้อความ) → ข้อความเก่าสุด ${newlyOut} ข้อความจะไม่ถูกส่งไปแล้ว`,
      (s) => ({ ...s, history: { ...s.history, messages: markOut(s.history.messages) } }), [{ spot: "chat", tone: "stale" }]);
  }
  const window = contextWindow(flow.state.history.messages);
  flow.step(hop("chat", "model", `ส่งทั้ง ${window.length} ข้อความ`),
    `แอปแชทส่ง “ทั้งบทสนทนา” ${window.length} ข้อความไปให้ AI ทุกครั้ง ไม่ใช่แค่ข้อความล่าสุด`,
    (s) => ({ ...s, history: { ...s.history, reading: true } }), [{ spot: "model", tone: "read" }]);
  const facts = factsFrom(window);
  const reply = replyTo(text, facts);
  // Did the fact exist earlier in the chat, but is no longer sent? That is the “forgetting” to show.
  const forgot = Boolean(reply.asked && !reply.known && factsFrom(before)[reply.asked]);
  flow.step(null,
    forgot ? `AI อ่านทั้ง ${window.length} ข้อความแล้วหา${FACT_LABEL[reply.asked!]}ไม่เจอ เพราะข้อความที่บอกไว้ไม่ได้ถูกส่งมา ✗`
      : `AI อ่านทั้ง ${window.length} ข้อความตั้งแต่ต้น แล้วเขียนคำตอบ`,
    undefined, [{ spot: "model", tone: forgot || !reply.known ? "blocked" : "changed" }]);
  flow.step(hop("model", "chat", "คำตอบ", reply.known ? "ok" : "blocked"), `AI ตอบ “${reply.text}” แล้วลืมทุกอย่างทันที (รอบหน้าแอปต้องส่งใหม่หมด)`,
    (s) => {
      // No `reading`: the model keeps nothing once it has answered.
      const next = trimMessages(markOut([...s.history.messages, { role: "ai", text: clip(reply.text) }]), s.history.shown);
      return { ...s, history: { messages: next.messages, shown: next.messages.length } };
    }, [{ spot: "chat", tone: reply.known ? "new" : "blocked" }, { spot: "model", tone: "removed" }]);
  if (forgot) return finish(state, flow, "failed", `AI ลืม${FACT_LABEL[reply.asked!]}แล้ว: ข้อความแรกหลุดออกจาก context window`);
  return finish(state, flow, reply.known ? "success" : "failed", `AI ตอบ: ${reply.text}`);
}

function chatNew(state: AiState): AiTransition {
  if (!state.history.messages.length) return noop(state, "แชทนี้ว่างอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มแชทใหม่: ประวัติว่างเปล่า AI จะไม่รู้อะไรจากแชทเก่าเลย",
    (s) => ({ ...s, history: { messages: [], shown: 0 } }), [{ spot: "chat", tone: "removed" }, { spot: "app", tone: "removed" }]);
  return finish(state, flow, "success", "เริ่มแชทใหม่แล้ว");
}

// ---------------------------------------------------------------------------
// Step 2 — chain of thought
// ---------------------------------------------------------------------------

function thinkSet(state: AiState, on: boolean): AiTransition {
  if (state.thinking.on === on) return noop(state, on ? "เปิดคิดก่อนตอบอยู่แล้ว" : "ปิดคิดก่อนตอบอยู่แล้ว");
  const flow = new Flow(state).step(null, on ? "เปิด “คิดก่อนตอบ”: AI จะเขียนความคิดทีละขั้นก่อนให้คำตอบ" : "ปิด “คิดก่อนตอบ”: AI ตอบทันที",
    (s) => ({ ...s, thinking: { ...s.thinking, on } }), [{ spot: "model", tone: "changed" }]);
  return finish(state, flow, "success", on ? "เปิดคิดก่อนตอบแล้ว" : "ปิดคิดก่อนตอบแล้ว");
}

function thinkAsk(state: AiState, id: PuzzleId): AiTransition {
  const puzzle = puzzleOf(id);
  const flow = new Flow(state);
  flow.step(hop("chat", "model", "คำถาม", "request"), `ถาม: ${puzzle.question}`,
    (s) => ({ ...s, thinking: { ...s.thinking, puzzle: id, thoughts: [], answer: null, correct: null, seconds: 0 } }), [{ spot: "chat", tone: "new" }]);
  if (!state.thinking.on) {
    flow.step(hop("model", "chat", `ตอบ ${puzzle.quick}`, "blocked"), `ตอบทันทีโดยไม่คิดก่อน → ${puzzle.quick} ✗ ผิด! โจทย์หลอกแบบนี้ตอบผิดง่าย`,
      (s) => ({ ...s, thinking: { ...s.thinking, answer: puzzle.quick, correct: false, seconds: 1 } }), [{ spot: "chat", tone: "blocked" }]);
    return finish(state, flow, "failed", `ตอบเร็วแต่ผิด (${puzzle.quick}) ลองเปิด “คิดก่อนตอบ” แล้วถามใหม่`);
  }
  puzzle.thoughts.forEach((thought, index) => {
    flow.step(null, `คิดขั้นที่ ${index + 1}: ${thought}`,
      (s) => ({ ...s, thinking: { ...s.thinking, thoughts: [...s.thinking.thoughts, thought], seconds: 2 + index * 2 } }), [{ spot: "thoughts", tone: "new" }]);
  });
  flow.step(hop("model", "chat", `ตอบ ${puzzle.answer}`, "ok"), `คิดครบแล้วค่อยตอบ → ${puzzle.answer} ✓ ความคิดก็คือข้อความที่ AI เขียนแล้วอ่านต่อเอง`,
    (s) => ({ ...s, thinking: { ...s.thinking, answer: puzzle.answer, correct: true, seconds: 2 + puzzle.thoughts.length * 2 } }), [{ spot: "chat", tone: "allowed" }]);
  return finish(state, flow, "success", `คิดทีละขั้นแล้วตอบถูก (${puzzle.answer}) แลกกับเวลาที่นานขึ้น`);
}

// ---------------------------------------------------------------------------
// Step 3 — memory of a web AI: the app keeps notes and attaches them to new chats
// ---------------------------------------------------------------------------

function saveFacts(items: MemoryItem[], text: string): { items: MemoryItem[]; saved: MemoryItem[] } {
  const saved = Object.entries(factsIn(text)).map(([key, value]) => ({ key, value: clip(value, 40) }) as MemoryItem);
  const next = items.filter((item) => !saved.some((entry) => entry.key === item.key));
  return { items: [...next, ...saved], saved };
}

function memorySend(state: AiState, raw: string): AiTransition {
  const text = validInput(raw);
  if (!text) return noop(state, INVALID_INPUT, "rejected");
  const { on, items } = state.memory;
  const flow = new Flow(state);
  flow.step(null, `แชท #${state.memory.chat}: คุณพิมพ์ “${text}” แล้วกดส่ง`,
    (s) => ({ ...s, memory: { ...s.memory, ...trimMessages([...s.memory.messages, { role: "user", text }], s.memory.shown + 1) } }), [{ spot: "chat", tone: "new" }]);
  const attached = on && items.length > 0;
  const count = flow.state.memory.messages.length;
  flow.step(hop("chat", "model", attached ? `ความจำ + ${count} ข้อความ` : `${count} ข้อความ`),
    attached ? `แอปแนบ “ความจำ” (${items.map((item) => `${FACT_LABEL[item.key]} ${item.value}`).join(", ")}) ไปพร้อมข้อความในแชทนี้`
      : on ? "ยังไม่มีความจำ แอปส่งแค่ข้อความในแชทนี้" : "Memory ปิดอยู่: แอปส่งแค่ข้อความในแชทนี้",
    (s) => ({ ...s, memory: { ...s.memory, reading: true } }), [{ spot: "model", tone: "read" }, ...(attached ? [{ spot: "memory", tone: "read" as const }] : [])]);
  const facts = factsFrom(flow.state.memory.messages, on ? items : []);
  const reply = replyTo(text, facts);
  flow.step(hop("model", "chat", "คำตอบ", reply.known ? "ok" : "blocked"),
    reply.known ? `AI ตอบ “${reply.text}” จากสิ่งที่ได้รับ แล้วลืมทันที` : `AI ไม่รู้ เพราะเรื่องนี้ไม่ได้ถูกส่งมา: “${reply.text}”`,
    (s) => {
      const { on: memoryOn, items: memoryItems, chat } = s.memory;
      const next = trimMessages([...s.memory.messages, { role: "ai", text: clip(reply.text) }], s.memory.shown);
      return { ...s, memory: { on: memoryOn, items: memoryItems, chat, messages: next.messages, shown: next.messages.length } };
    }, [{ spot: "chat", tone: reply.known ? "new" : "blocked" }, { spot: "model", tone: "removed" }]);
  const { items: nextItems, saved } = saveFacts(items, text);
  if (saved.length && on) {
    flow.step(hop("chat", "memory", `จด: ${saved.map((item) => item.value).join(", ")}`), "แอปจดเรื่องสำคัญลง “Memory ของแอป” (เก็บที่แอป ไม่ได้อยู่ในตัว AI)",
      (s) => ({ ...s, memory: { ...s.memory, items: nextItems } }), [{ spot: "memory", tone: "new" }]);
  }
  return finish(state, flow, reply.known ? "success" : "failed", reply.known ? `AI ตอบ: ${reply.text}` : `AI ไม่รู้: ${on ? "ยังไม่มีเรื่องนี้ในความจำ" : "Memory ปิดอยู่"}`);
}

function memoryNewChat(state: AiState): AiTransition {
  const chat = state.memory.chat + 1;
  const flow = new Flow(state).step(null, `เปิดแชทใหม่ #${chat}: ข้อความแชทเก่าไม่ถูกส่งไปแล้ว แต่ความจำของแอปยังอยู่`,
    (s) => ({ ...s, memory: { ...s.memory, messages: [], shown: 0, chat } }), [{ spot: "chat", tone: "removed" }]);
  return finish(state, flow, "success", `เปิดแชทใหม่ #${chat} แล้ว`);
}

function memorySet(state: AiState, on: boolean): AiTransition {
  if (state.memory.on === on) return noop(state, on ? "Memory เปิดอยู่แล้ว" : "Memory ปิดอยู่แล้ว");
  const flow = new Flow(state).step(null, on ? "เปิด Memory: แอปจะจดเรื่องสำคัญและแนบไปกับทุกแชท" : "ปิด Memory: แอปไม่จดและไม่แนบความจำ",
    (s) => ({ ...s, memory: { ...s.memory, on } }), [{ spot: "memory", tone: on ? "allowed" : "removed" }]);
  return finish(state, flow, "success", on ? "เปิด Memory แล้ว" : "ปิด Memory แล้ว");
}

function memoryClear(state: AiState): AiTransition {
  if (!state.memory.items.length) return noop(state, "ยังไม่มีความจำให้ลบ");
  const flow = new Flow(state).step(null, "ลบความจำของแอปทั้งหมด: แชทใหม่จะไม่รู้เรื่องของคุณอีก",
    (s) => ({ ...s, memory: { ...s.memory, items: [] } }), [{ spot: "memory", tone: "removed" }]);
  return finish(state, flow, "success", "ลบความจำแล้ว");
}

// ---------------------------------------------------------------------------
// Step 4 — web AI vs Claude Code: tools that run on our machine, in a loop
// ---------------------------------------------------------------------------

const log = (state: AiState, line: string): AiState => ({ ...state, agent: { ...state.agent, log: [...state.agent.log, line].slice(-AI_LIMITS.log) } });

const CODE_BUG = ["def add(a, b):", "    return a - b"];
const withDetail = (move: Hop, detail: string[]): Hop => ({ ...move, detail });

function agentWeb(state: AiState): AiTransition {
  if (state.agent.web.asked && state.agent.web.answer) return noop(state, "ถาม AI บนเว็บไปแล้ว ลองสั่ง Claude Code ต่อ");
  const flow = new Flow(state);
  flow.step(withDetail(hop("web", "model", "คำถาม + โค้ดที่ก๊อปมาวาง", "request"), ["👤 ทำไมเทสต์ไม่ผ่าน?", ...CODE_BUG.map((line) => `📋 ${line.trim()}`)]),
    "บนเว็บ: เราต้องก๊อปโค้ดไปวางเอง เพราะ AI มองไม่เห็นไฟล์ในเครื่องเรา",
    (s) => ({ ...s, agent: { ...s.agent, web: { asked: true, answer: null } } }), [{ spot: "model", tone: "read" }]);
  flow.step(withDetail(hop("model", "web", "คำแนะนำ", "ok"), ["💬 ลองเปลี่ยน a - b เป็น a + b"]),
    "AI ตอบเป็นคำแนะนำ → เราต้องไปเปิดไฟล์ แก้เอง และรันเทสต์เอง ✋",
    (s) => ({ ...s, agent: { ...s.agent, web: { asked: true, answer: "ลองเปลี่ยน a - b เป็น a + b ในบรรทัดที่ 2" } } }), [{ spot: "web", tone: "changed" }]);
  return finish(state, flow, "success", "AI บนเว็บให้คำแนะนำ (ไฟล์ในเครื่องยังไม่เปลี่ยน เราต้องทำเอง)");
}

/**
 * Claude Code's loop, one packet at a time between Claude Code and the AI: the AI asks for a tool,
 * Claude Code runs it on our machine and sends the result back, until the AI answers “done”.
 */
function agentCc(state: AiState): AiTransition {
  if (state.agent.code === "fixed" && state.agent.tests === "pass") return noop(state, "เทสต์ผ่านแล้ว กด “ใส่บั๊กกลับ” เพื่อลองใหม่");
  const flow = new Flow(state);
  flow.step(null, "คุณพิมพ์ใน Claude Code: “แก้บั๊กให้เทสต์ผ่าน”",
    (s) => log({ ...s, agent: { ...s.agent, log: [] } }, "> แก้บั๊กให้เทสต์ผ่าน"), [{ spot: "cc", tone: "new" }]);
  flow.step(withDetail(hop("cc", "model", "งาน + เครื่องมือ", "request"), ["📝 งาน: แก้บั๊กให้เทสต์ผ่าน", "🔧 ใช้ได้: อ่านไฟล์ · รันคำสั่ง · แก้ไฟล์"]),
    "Claude Code ส่งงานไปให้ AI พร้อมบอกว่ามีเครื่องมืออะไรให้ใช้", undefined, [{ spot: "model", tone: "read" }]);
  // Round 1: read the file.
  flow.step(withDetail(hop("model", "cc", "ขอใช้เครื่องมือ", "request"), ["🔧 อ่านไฟล์ main.py"]),
    "AI ยังไม่ตอบ แต่ “ขอใช้เครื่องมือ”: อ่านไฟล์ → Claude Code อ่านในเครื่องเรา",
    (s) => log(s, "🔧 อ่านไฟล์ main.py"), [{ spot: "files", tone: "read" }]);
  flow.step(withDetail(hop("cc", "model", "เนื้อหาไฟล์"), CODE_BUG),
    "เนื้อหาไฟล์ถูกส่งไปให้ AI อ่าน (ข้อมูลในเครื่องเราเดินทางออกไปหา AI)", undefined, [{ spot: "model", tone: "read" }]);
  // Round 2: run the tests.
  flow.step(withDetail(hop("model", "cc", "ขอใช้เครื่องมือ", "request"), ["🔧 รันเทสต์"]),
    "AI ขอรันเทสต์ → Claude Code รันในเครื่องเรา: ✗ ไม่ผ่าน",
    (s) => log({ ...s, agent: { ...s.agent, tests: "fail" } }, "🔧 รันเทสต์ → ✗ ไม่ผ่าน"), [{ spot: "tests", tone: "blocked" }]);
  flow.step(withDetail(hop("cc", "model", "ผลเทสต์", "blocked"), ["✗ add(2, 3) ได้ −1 (ต้องได้ 5)"]),
    "ส่งผลเทสต์กลับไปให้ AI คิดต่อ", undefined, [{ spot: "model", tone: "read" }]);
  // Round 3: edit — Claude Code asks us first.
  flow.step(withDetail(hop("model", "cc", "ขอใช้เครื่องมือ", "request"), ["✏️ แก้ main.py: a - b → a + b"]),
    "AI ขอแก้ไฟล์ → Claude Code ถามเราก่อน", undefined, [{ spot: "gate", tone: "read" }]);
  flow.step(null, "คุณกด “อนุญาต” ✓ → Claude Code แก้ไฟล์ในเครื่องเรา",
    (s) => log(log({ ...s, agent: { ...s.agent, code: "fixed" } }, "🔐 ขอแก้ไฟล์ → คุณอนุญาต"), "✏️ แก้ main.py แล้ว"),
    [{ spot: "gate", tone: "allowed" }, { spot: "files", tone: "changed" }]);
  flow.step(withDetail(hop("cc", "model", "แก้แล้ว"), ["✓ แก้ main.py เรียบร้อย"]), "บอก AI ว่าแก้ไฟล์แล้ว");
  // Round 4: test again.
  flow.step(withDetail(hop("model", "cc", "ขอใช้เครื่องมือ", "request"), ["🔧 รันเทสต์อีกรอบ"]),
    "AI ขอรันเทสต์อีกรอบ: ✓ ผ่าน",
    (s) => log({ ...s, agent: { ...s.agent, tests: "pass" } }, "🔧 รันเทสต์ → ✓ ผ่าน"), [{ spot: "tests", tone: "allowed" }]);
  flow.step(withDetail(hop("cc", "model", "ผลเทสต์", "ok"), ["✓ ผ่านทั้งหมด"]), "ส่งผลให้ AI อีกรอบ", undefined, [{ spot: "model", tone: "read" }]);
  flow.step(withDetail(hop("model", "cc", "เสร็จแล้ว", "ok"), ["✅ แก้แล้ว: a - b → a + b", "เทสต์ผ่านทั้งหมด"]),
    "AI เห็นว่าเทสต์ผ่าน จึงตอบคำตอบสุดท้าย วงจร “ขอใช้เครื่องมือ → ทำในเครื่อง → ส่งผล” จบ",
    (s) => log(s, "✅ เสร็จ: แก้ a - b เป็น a + b"), [{ spot: "cc", tone: "allowed" }]);
  return finish(state, flow, "success", "Claude Code แก้ไฟล์และรันเทสต์ในเครื่องเราเอง (วน 4 รอบ) จนเทสต์ผ่าน");
}

function agentReset(state: AiState): AiTransition {
  const initial = createInitialAiState().agent;
  if (JSON.stringify(state.agent) === JSON.stringify(initial)) return noop(state, "โปรเจกต์มีบั๊กอยู่แล้ว");
  const flow = new Flow(state).step(null, "ใส่บั๊กกลับเข้าไปใน main.py เพื่อลองอีกครั้ง", (s) => ({ ...s, agent: initial }), [{ spot: "files", tone: "blocked" }]);
  return finish(state, flow, "success", "ใส่บั๊กกลับแล้ว");
}

// ---------------------------------------------------------------------------
// Step 5 — Claude Code's memory: CLAUDE.md + memory files, loaded into every session; long chats get summarized
// ---------------------------------------------------------------------------

const THAI_MEMORY = "ตอบเป็นภาษาไทยเสมอ";
const baseContext = (state: AiState) => state.cc.rules.length + state.cc.memories.length;
/** Everything Claude Code sends with each message: CLAUDE.md, the memory files and the whole session so far. */
export function ccContextLines(state: AiState): string[] {
  return [...state.cc.rules.map((rule) => `📄 ${rule}`), ...state.cc.memories.map((memory) => `📌 ${memory}`), ...state.cc.chat.map((line) => `💬 ${line}`)];
}
/** The model holds what it was sent while answering (`on`), and nothing afterwards. */
const ccRead = (on: boolean) => (s: AiState): AiState => {
  const { rules, memories, session, context, chat, summarized } = s.cc;
  const cc = { rules, memories, session, context, chat, summarized };
  return { ...s, cc: on ? { ...cc, reading: true } : cc };
};

function ccStart(state: AiState): AiTransition {
  const session = state.cc.session + 1;
  const flow = new Flow(state);
  flow.step(null, `เปิด Claude Code session #${session}: เริ่มบทสนทนาใหม่ ของ session ก่อนไม่ติดมาด้วย`,
    (s) => ({ ...s, cc: { rules: s.cc.rules, memories: s.cc.memories, session, context: 0, chat: [], summarized: false } }), [{ spot: "cc", tone: "refresh" }]);
  flow.step(withDetail(hop("claudeMd", "cc", "อ่าน CLAUDE.md"), state.cc.rules.map((rule) => `📄 ${rule}`)),
    "Claude Code อ่าน CLAUDE.md (คำสั่งโปรเจกต์ที่เราเขียน) ทุกครั้งที่เปิด session",
    (s) => ({ ...s, cc: { ...s.cc, context: s.cc.rules.length } }), [{ spot: "claudeMd", tone: "read" }]);
  const count = state.cc.memories.length;
  flow.step(withDetail(hop("memoryDir", "cc", count ? "อ่านไฟล์ความจำ" : "ไฟล์ความจำว่าง", count ? "data" : "lost"), count ? state.cc.memories.map((memory) => `📌 ${memory}`) : ["(ยังไม่มี)"]),
    count ? "อ่านไฟล์ความจำที่ Claude จดไว้จาก session ก่อนๆ ทั้งสองอย่างจะถูกส่งไปกับทุกข้อความ" : "ยังไม่มีไฟล์ความจำ",
    (s) => ({ ...s, cc: { ...s.cc, context: baseContext(s) } }), count ? [{ spot: "memoryDir", tone: "read" }] : []);
  return finish(state, flow, "success", `เปิด session #${session} แล้ว (โหลด CLAUDE.md${count ? ` + ความจำ ${count} เรื่อง` : ""})`);
}

function compact(flow: Flow, auto: boolean) {
  flow.step(null, auto ? "context ใกล้เต็ม → Claude Code สรุปย่อบทสนทนาอัตโนมัติ (compact) รายละเอียดเก่าบางอย่างอาจหายไป"
    : "/compact: สรุปย่อบทสนทนาให้สั้นลง เหลือที่ว่างใน context",
  (s) => ({ ...s, cc: { ...s.cc, chat: [clip(`สรุป: ${s.cc.chat.map((line) => line.replace(/^(คุณ|Claude): /u, "")).join(" / ")}`, 90)], context: baseContext(s) + 1, summarized: true } }),
  [{ spot: "cc", tone: "changed" }]);
}

/** One message in Claude Code: typed → the whole context travels to the AI → the answer comes back (and is forgotten there). */
function ccSay(state: AiState, say: CcSay): AiTransition {
  if (state.cc.session === 0) return noop(state, "เปิด session ก่อน (กด “เปิด session ใหม่”)", "rejected");
  const flow = new Flow(state);
  const add = (line: string, context: number) => (s: AiState): AiState =>
    ({ ...s, cc: { ...s.cc, chat: [...s.cc.chat, line].slice(-AI_LIMITS.ccChat), context: s.cc.context + context } });
  const typed = say === "thai" ? "ตอบเป็นภาษาไทยเสมอนะ" : say === "work" ? "ทำระบบ login ให้หน่อย" : "ต้องตอบเป็นภาษาอะไร?";
  flow.step(null, `คุณพิมพ์ใน Claude Code: “${typed}”`, add(`คุณ: ${typed}`, 1), [{ spot: "cc", tone: "new" }]);
  const sent = ccContextLines(flow.state);
  const fromMemory = state.cc.memories.includes(THAI_MEMORY);
  const fromChat = !state.cc.summarized && state.cc.chat.some((line) => line.includes("ภาษาไทย"));
  flow.step(withDetail(hop("cc", "model", `ส่ง context ทั้งหมด (${sent.length} ชิ้น)`), sent),
    say === "ask"
      ? fromMemory ? "ส่งทุกอย่างไปให้ AI — ในนั้นมี “📌 ตอบเป็นภาษาไทยเสมอ” จากไฟล์ความจำ" : fromChat ? "ส่งทุกอย่างไปให้ AI — ในบทสนทนานี้มีบอกไว้ว่าให้ตอบภาษาไทย" : "ส่งทุกอย่างไปให้ AI — แต่ไม่มีเรื่องภาษาอยู่เลย"
      : "ส่งทุกอย่างไปให้ AI: CLAUDE.md + ความจำ + บทสนทนาทั้งหมด (ไม่ใช่แค่ข้อความล่าสุด)",
    ccRead(true), [{ spot: "model", tone: "read" }]);
  if (say === "thai") {
    const known = fromMemory;
    flow.step(withDetail(hop("model", "cc", known ? "รับทราบ" : "ขอจดความจำ", known ? "ok" : "request"), [known ? "💬 รับทราบครับ (มีในความจำแล้ว)" : `📝 จดลงไฟล์ความจำ: ${THAI_MEMORY}`]),
      known ? "AI เห็นว่ามีในความจำแล้ว ตอบรับทราบ แล้วลืมทันที" : "AI เห็นว่าเป็นเรื่องที่ควรจำข้าม session จึงขอให้จดลงไฟล์ แล้วลืมทันที",
      (s) => add("Claude: รับทราบครับ", 1)(ccRead(false)(s)), [{ spot: "model", tone: "removed" }]);
    if (!known) {
      flow.step(withDetail(hop("cc", "memoryDir", "เขียนไฟล์ความจำ"), [`📌 ${THAI_MEMORY}`]), "Claude Code เขียนไฟล์ความจำลงเครื่องเรา (อยู่ถาวร เปิดอ่าน/ลบเองได้)",
        (s) => ({ ...s, cc: { ...s.cc, memories: [...s.cc.memories, THAI_MEMORY].slice(-AI_LIMITS.ccMemories) } }), [{ spot: "memoryDir", tone: "new" }]);
    }
  } else if (say === "work") {
    flow.step(withDetail(hop("model", "cc", "คำตอบยาว", "ok"), ["💬 เขียนโค้ด login 5 ไฟล์", "💬 + อธิบาย + ผลรันเทสต์ยาวๆ"]),
      "คำตอบยาว (โค้ดหลายไฟล์ + ผลของเครื่องมือ) ถูกต่อท้ายบทสนทนา → context ถูกใช้ไปเยอะ",
      (s) => add("Claude: เขียนโค้ด login 5 ไฟล์ + รันเทสต์", 4)(ccRead(false)(s)), [{ spot: "cc", tone: "changed" }, { spot: "model", tone: "removed" }]);
  } else {
    const known = fromMemory || fromChat;
    flow.step(withDetail(hop("model", "cc", known ? "ภาษาไทย ✓" : "ไม่รู้ ✗", known ? "ok" : "blocked"), [known ? "💬 ภาษาไทยครับ" : "💬 ไม่มีข้อมูลครับ"]),
      fromMemory ? "AI ตอบได้เพราะในสิ่งที่ส่งมามีไฟล์ความจำ ✓" : fromChat ? "ตอบได้จากบทสนทนาใน session นี้ ✓ (ปิด session แล้วจะหาย)" : "ในสิ่งที่ส่งมาไม่มีเรื่องนี้ AI จึงไม่รู้ ✗",
      (s) => add(known ? "Claude: ภาษาไทยครับ" : "Claude: ไม่มีข้อมูลครับ", 1)(ccRead(false)(s)), [{ spot: "cc", tone: known ? "allowed" : "blocked" }, { spot: "model", tone: "removed" }]);
    if (flow.state.cc.context > AI_LIMITS.ccContext) compact(flow, true);
    return finish(state, flow, known ? "success" : "failed", known ? `Claude ตอบได้ (${fromMemory ? "จากไฟล์ความจำ" : "จากบทสนทนานี้"})` : "Claude ไม่รู้: ไม่มีในความจำ");
  }
  if (flow.state.cc.context > AI_LIMITS.ccContext) compact(flow, true);
  return finish(state, flow, "success", say === "thai" ? "Claude จดลงไฟล์ความจำแล้ว" : flow.state.cc.summarized && !state.cc.summarized ? "context เต็มจึงสรุปย่อบทสนทนาแล้ว" : "ทำงานแล้ว (context ถูกใช้ไปเยอะ)");
}

function ccCompact(state: AiState): AiTransition {
  if (state.cc.session === 0) return noop(state, "เปิด session ก่อน", "rejected");
  if (!state.cc.chat.length || (state.cc.summarized && state.cc.chat.length === 1)) return noop(state, "ยังไม่มีบทสนทนาให้สรุป");
  const flow = new Flow(state);
  compact(flow, false);
  return finish(state, flow, "success", "สรุปย่อบทสนทนาแล้ว");
}

function ccForget(state: AiState): AiTransition {
  if (!state.cc.memories.length) return noop(state, "ยังไม่มีไฟล์ความจำ");
  const flow = new Flow(state).step(null, "ลบไฟล์ความจำ: session ถัดไปจะไม่รู้เรื่องที่เคยจดไว้",
    (s) => ({ ...s, cc: { ...s.cc, memories: [] } }), [{ spot: "memoryDir", tone: "removed" }]);
  return finish(state, flow, "success", "ลบไฟล์ความจำแล้ว");
}

function reset(state: AiState): AiTransition {
  const initial = createInitialAiState();
  if (JSON.stringify(initial) === JSON.stringify(state)) return noop(state, "เป็นค่าตั้งต้นอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มใหม่: ล้างแชท ความจำ และโปรเจกต์ตัวอย่างทั้งหมด", () => initial);
  return finish(state, flow, "success", "เริ่มใหม่แล้ว");
}

/** Applies one action. Never throws for user input; rejected actions change nothing. */
export function applyAiAction(state: AiState, action: AiAction): AiTransition {
  switch (action.type) {
    case "chat.send": return chatSend(state, action.text);
    case "chat.new": return chatNew(state);
    case "think.set": return thinkSet(state, action.on);
    case "think.ask": return thinkAsk(state, action.puzzle);
    case "memory.set": return memorySet(state, action.on);
    case "memory.send": return memorySend(state, action.text);
    case "memory.newChat": return memoryNewChat(state);
    case "memory.clear": return memoryClear(state);
    case "agent.web": return agentWeb(state);
    case "agent.cc": return agentCc(state);
    case "agent.reset": return agentReset(state);
    case "cc.start": return ccStart(state);
    case "cc.say": return ccSay(state, action.say);
    case "cc.compact": return ccCompact(state);
    case "cc.forget": return ccForget(state);
    case "reset": return reset(state);
  }
}
