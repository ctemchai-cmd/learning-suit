import { AI_LIMITS, type ChatMsg, type FactKey, type MemoryItem, type PuzzleId } from "./model";

// Scripted "AI" of the simulator: finds simple facts in Thai sentences and answers from the facts it
// was given. Deterministic on purpose — the lesson is about what the model receives, not how it thinks.

export type Facts = Partial<Record<FactKey, string>>;
export const FACT_LABEL: Record<FactKey, string> = { name: "ชื่อ", job: "อาชีพ", like: "ชอบ" };

const clean = (value: string) => value.replace(/[?？!.,ๆ]+$/u, "").trim();
const isQuestion = (text: string) => /อะไร|ไหม|หรือเปล่า|[?？]/u.test(text);

/** Facts stated in one sentence, e.g. “ผมชื่อต้น เป็นครู” → { name: "ต้น", job: "ครู" }. Questions state nothing. */
export function factsIn(text: string): Facts {
  if (isQuestion(text)) return {};
  const facts: Facts = {};
  const name = /ชื่อ\s*([^\s,]+)/u.exec(text);
  if (name) facts.name = clean(name[1]);
  const job = /(?:เป็น|อาชีพ|ทำงาน(?:เป็น)?)\s*([^\s,]+)/u.exec(text);
  if (job && !/ชื่อ/u.test(job[1])) facts.job = clean(job[1]);
  const like = /ชอบ\s*([^\s,]+)/u.exec(text);
  if (like) facts.like = clean(like[1]);
  for (const key of Object.keys(facts) as FactKey[]) if (!facts[key]) delete facts[key];
  return facts;
}

/** Facts known from what the model received: the user's messages in order (later ones win) plus memory. */
export function factsFrom(messages: ChatMsg[], memory: MemoryItem[] = []): Facts {
  const facts: Facts = {};
  for (const item of memory) facts[item.key] = item.value;
  for (const message of messages) if (message.role === "user") Object.assign(facts, factsIn(message.text));
  return facts;
}

export type Reply = { text: string; asked: FactKey | null; known: boolean };

/** The scripted answer to `text` given the facts the model received. */
export function replyTo(text: string, facts: Facts): Reply {
  const asked: FactKey | null = /ชื่อ/u.test(text) && isQuestion(text) ? "name"
    : /(ทำงาน|อาชีพ|เป็นอะไร)/u.test(text) && isQuestion(text) ? "job"
      : /ชอบ/u.test(text) && isQuestion(text) ? "like" : null;
  if (asked) {
    const value = facts[asked];
    if (!value) return { text: `ขอโทษครับ ผมไม่รู้${FACT_LABEL[asked] === "ชอบ" ? "ว่าคุณชอบอะไร" : `${FACT_LABEL[asked]}ของคุณ`} (ไม่มีในข้อความที่ได้รับ)`, asked, known: false };
    const answer = asked === "name" ? `คุณชื่อ${value}ครับ` : asked === "job" ? `คุณเป็น${value}ครับ` : `คุณชอบ${value}ครับ`;
    return { text: answer, asked, known: true };
  }
  const stated = factsIn(text);
  if (stated.name) return { text: `ยินดีที่ได้รู้จักครับ คุณ${stated.name}!`, asked: null, known: true };
  if (stated.job || stated.like) return { text: `จดไว้แล้วครับ ${stated.job ? `คุณเป็น${stated.job}` : `คุณชอบ${stated.like}`}`, asked: null, known: true };
  if (/แมว/u.test(text)) return { text: "แมวนอนวันละ 12–16 ชั่วโมงเลยครับ", asked: null, known: true };
  return { text: "เข้าใจแล้วครับ", asked: null, known: true };
}

/** Presets the panel offers (the teacher can also type). */
export const CHAT_PRESETS = ["สวัสดี ผมชื่อต้น", "ผมชอบลาเต้", "เล่าเรื่องแมวหน่อย", "ผมชื่ออะไรนะ?", "ผมชอบกินอะไร?"] as const;
export const MEMORY_PRESETS = ["ผมชื่อต้น เป็นครูสอนเขียนโปรแกรม", "ผมชอบลาเต้", "ผมชื่ออะไรนะ?", "ผมทำงานอะไร?"] as const;

/** Keeps a code-point limit (for lines shown in bubbles). */
export function clip(text: string, max: number = AI_LIMITS.lineCodePoints): string {
  const points = [...text];
  return points.length <= max ? text : `${points.slice(0, max - 1).join("")}…`;
}

// ---------------------------------------------------------------------------
// Chain of thought: trick questions a quick answer often gets wrong.
// ---------------------------------------------------------------------------

export type Puzzle = { id: PuzzleId; label: string; question: string; quick: string; thoughts: string[]; answer: string };
export const PUZZLES: Puzzle[] = [
  {
    id: "pen", label: "ปากกากับยางลบ",
    question: "ปากกากับยางลบรวม 110 บาท ปากกาแพงกว่ายางลบ 100 บาท ยางลบราคาเท่าไร?",
    quick: "10 บาท",
    thoughts: ["ให้ยางลบราคา x บาท", "ปากกาแพงกว่า 100 → ปากกา = x + 100", "รวมกัน: x + (x + 100) = 110", "2x = 10 → x = 5"],
    answer: "5 บาท",
  },
  {
    id: "letters", label: "นับตัว r",
    question: "คำว่า strawberry มีตัว r กี่ตัว?",
    quick: "2 ตัว",
    thoughts: ["ไล่ทีละตัว: s-t-r-a-w-b-e-r-r-y", "ตัวที่ 3 เป็น r → 1", "ตัวที่ 8 และ 9 เป็น r → 2, 3", "นับครบแล้ว รวม 3 ตัว"],
    answer: "3 ตัว",
  },
  {
    id: "apples", label: "แอปเปิล",
    question: "มีแอปเปิล 23 ลูก ใช้ทำพาย 20 ลูก แล้วซื้อเพิ่ม 6 ลูก เหลือกี่ลูก?",
    quick: "29 ลูก",
    thoughts: ["เริ่มมี 23 ลูก", "ใช้ทำพาย 20 → 23 − 20 = 3", "ซื้อเพิ่ม 6 → 3 + 6", "= 9 ลูก"],
    answer: "9 ลูก",
  },
];
export const puzzleOf = (id: PuzzleId): Puzzle => PUZZLES.find((item) => item.id === id)!;
