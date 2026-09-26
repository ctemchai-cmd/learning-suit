"use client";

import type { JSX, ReactNode } from "react";
import { Group, Rect, Text } from "react-konva";
import type { MarkTone } from "@/domain/data/model";
import type { AiSimulatorNode } from "@/domain/document/model";
import type { AiState, AiView, ChatMsg } from "@/domain/ai/model";
import { AI_LIMITS } from "@/domain/ai/model";
import { FACT_LABEL, factsFrom, puzzleOf, type Facts } from "@/domain/ai/chat";
import { ccContextLines, contextWindow } from "@/domain/ai/reducer";
import { CaptionBar, Label, MARK_STYLE, Packet, Pipe, TONE_COLOR, type Pt } from "@/features/flow/flow-bits";
import { waitingAt, type FlowPlay } from "@/features/flow/flow-session";
import { useFlowPlayback } from "@/features/flow/use-flow-playback";
import { AI_H, AI_VIEWS, AI_W, CAPTION_BOX, hopPath, sceneOf, type Box } from "./ai-layout";

// Canvas rendering of the AI simulator (plan 07 §5). Draw inside a Group already translated to node.x/node.y.
// Deterministic for export: without a play it draws the stored state only. Nothing here talks to an AI.

const C = {
  frame: "#FFFFFF", frameStroke: "#CBD5E1", card: "#FFFFFF", cardStroke: "#E2E8F0", title: "#0F172A", text: "#1E293B", muted: "#64748B",
  user: "#2563EB", ai: "#F1F5F9", ok: "#15803D", bad: "#B91C1C", model: "#F5F3FF", modelStroke: "#C4B5FD", violet: "#6D28D9",
  terminal: "#0F172A", terminalText: "#E2E8F0", app: "#F8FAFC",
};
const IDLE: Record<AiView, string> = {
  history: "ส่งข้อความหลายๆ ครั้ง ดูว่าแอปส่งอะไรให้ AI แล้วลองถามชื่อหลังคุยยาว",
  thinking: "ถามโจทย์หลอกแบบปิด “คิดก่อนตอบ” แล้วเปิดแล้วถามใหม่",
  memory: "แนะนำตัว → เปิดแชทใหม่ → ถามชื่อ แล้วลองปิด Memory",
  agent: "ถาม AI บนเว็บ แล้วลองสั่ง Claude Code แก้บั๊ก",
  ccMemory: "เปิด session → บอกให้ตอบภาษาไทย → เปิด session ใหม่แล้วถาม",
};

type Marks = Map<string, { tone: MarkTone }>;
const toneOf = (marks: Marks, spot: string) => marks.get(spot)?.tone;

/** Wrapping text in a fixed box (at most the lines that fit, then “…”). */
function Para({ x, y, width, height, text, size, color = C.text, bold = false, align = "left", font }: {
  x: number; y: number; width: number; height: number; text: string; size: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; font: string;
}) {
  return <Text x={x} y={y} width={width} height={height} text={text} fontSize={size} fontFamily={font} fontStyle={bold ? "bold" : "normal"}
    fill={color} align={align} verticalAlign="middle" wrap="word" ellipsis lineHeight={1.25} listening={false} />;
}

function Card({ box, title, sub, mark, fill = C.card, stroke = C.cardStroke, dark = false, font, children }: {
  box: Box; title?: string; sub?: string; mark?: MarkTone; fill?: string; stroke?: string; dark?: boolean; font: string; children?: ReactNode;
}) {
  const style = mark ? MARK_STYLE[mark] : null;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={14} fill={style && !dark ? style.fill : fill} stroke={style?.stroke ?? stroke} strokeWidth={style ? 3 : 1.5} />
    {title && <Label x={box.x + 14} y={box.y + 12} width={box.w - 28} text={title} size={16} bold color={dark ? "#F8FAFC" : C.title} font={font} />}
    {sub && <Label x={box.x + 14} y={box.y + 34} width={box.w - 28} text={sub} size={11} color={dark ? "#94A3B8" : C.muted} font={font} />}
    {children}
  </Group>;
}

const BUBBLE_H = 46, BUBBLE_GAP = 6;
/** Chat bubbles (newest at the bottom). `out` bubbles are faded: still on screen, no longer sent to the AI. */
function Bubbles({ area, messages, typing, font }: { area: Box; messages: ChatMsg[]; typing: boolean; font: string }) {
  const rows = Math.max(1, Math.floor((area.h + BUBBLE_GAP) / (BUBBLE_H + BUBBLE_GAP)));
  const all: (ChatMsg | "typing")[] = typing ? [...messages, "typing"] : messages;
  const shown = all.slice(-rows);
  const hidden = all.length - shown.length;
  return <Group listening={false}>
    {hidden > 0 && <Label x={area.x} y={area.y - 18} width={area.w} text={`+${hidden} ข้อความก่อนหน้า`} size={11} color={C.muted} align="center" font={font} />}
    {shown.map((message, index) => {
      const y = area.y + index * (BUBBLE_H + BUBBLE_GAP);
      if (message === "typing") {
        return <Group key="typing">
          <Rect x={area.x} y={y} width={150} height={BUBBLE_H - 8} cornerRadius={14} fill={C.ai} />
          <Label x={area.x + 12} y={y} width={130} text="AI กำลังพิมพ์…" size={13} color={C.muted} font={font} lineHeight={BUBBLE_H - 8} />
        </Group>;
      }
      const user = message.role === "user";
      const w = area.w - 40;
      const x = user ? area.x + area.w - w : area.x;
      return <Group key={index} opacity={message.out ? 0.45 : 1}>
        <Rect x={x} y={y} width={w} height={BUBBLE_H} cornerRadius={14} fill={user ? C.user : C.ai}
          stroke={message.out ? "#94A3B8" : undefined} strokeWidth={message.out ? 1.5 : 0} dash={message.out ? [5, 4] : undefined} />
        <Para x={x + 12} y={y + 3} width={w - 24} height={BUBBLE_H - 6} text={message.text} size={13} color={user ? "#FFFFFF" : C.text} font={font} />
        {message.out && <Group x={user ? x - 4 : x + w - 92} y={y - 8}>
          <Rect width={96} height={18} cornerRadius={9} fill="#FEE2E2" stroke="#DC2626" strokeWidth={1} />
          <Label x={0} y={0} width={96} text="AI ไม่เห็นแล้ว" size={10} bold color="#991B1B" align="center" font={font} lineHeight={18} />
        </Group>}
      </Group>;
    })}
  </Group>;
}

function ChatScreen({ box, title, sub, messages, typing, mark, font, children }: {
  box: Box; title: string; sub?: string; messages: ChatMsg[]; typing: boolean; mark?: MarkTone; font: string; children?: ReactNode;
}) {
  const style = mark ? MARK_STYLE[mark] : null;
  const head = sub ? 58 : 40;
  return <Group listening={false}>
    <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={16} fill="#FFFFFF" stroke={style?.stroke ?? "#94A3B8"} strokeWidth={style ? 3 : 1.5} />
    <Rect x={box.x} y={box.y} width={box.w} height={head} cornerRadius={[16, 16, 0, 0]} fill="#E2E8F0" />
    <Label x={box.x + 14} y={box.y + (sub ? 8 : 0)} width={box.w - 28} text={title} size={sub ? 16 : 14} bold color={C.title} font={font} lineHeight={sub ? 22 : 40} />
    {sub && <Label x={box.x + 14} y={box.y + 32} width={box.w - 28} text={sub} size={12} color={C.muted} font={font} />}
    {children ?? <>
      {messages.length === 0 && !typing && <Label x={box.x + 14} y={box.y + head + 20} width={box.w - 28} text="ยังไม่มีข้อความ" size={13} color={C.muted} align="center" font={font} />}
      <Bubbles area={{ x: box.x + 12, y: box.y + head + 18, w: box.w - 24, h: box.h - head - 30 }} messages={messages} typing={typing} font={font} />
    </>}
  </Group>;
}

type Row = { icon: string; text: string; tone: "user" | "ai" | "memory" | "file" };
const ROW_FILL: Record<Row["tone"], { fill: string; text: string }> = {
  user: { fill: "#2563EB", text: "#FFFFFF" }, ai: { fill: "#E2E8F0", text: "#1E293B" }, memory: { fill: "#FEF3C7", text: "#92400E" }, file: { fill: "#DBEAFE", text: "#1E3A8A" },
};
/** A carried line coloured by what it is: 📄 CLAUDE.md, 📌 memory, 💬 คุณ… (us), other (the AI / plain). */
const rowOfLine = (line: string): Row => ({
  icon: "", text: line,
  tone: line.startsWith("📄") ? "file" : line.startsWith("📌") ? "memory" : line.startsWith("💬 คุณ") || line.startsWith("👤") ? "user" : "ai",
});
const rowsOf = (messages: ChatMsg[]): Row[] => messages.map((message) => ({ icon: message.role === "user" ? "👤" : "🤖", text: message.text, tone: message.role }));

/** Mini chat rows: what travels to the model, or what the model is holding right now. */
function Rows({ x, y, w, rows, font, size = 12, rowH = 26 }: { x: number; y: number; w: number; rows: Row[]; font: string; size?: number; rowH?: number }) {
  return <Group listening={false}>{rows.map((row, index) => {
    const style = ROW_FILL[row.tone];
    const inset = row.tone === "memory" || row.tone === "file" ? 0 : 36;
    return <Group key={index}>
      <Rect x={row.tone === "user" ? x + inset : x} y={y + index * (rowH + 4)} width={w - inset} height={rowH} cornerRadius={rowH / 2.6} fill={style.fill} />
      <Label x={(row.tone === "user" ? x + inset : x) + 10} y={y + index * (rowH + 4)} width={w - inset - 20} text={row.icon ? `${row.icon} ${row.text}` : row.text} size={size} color={style.text} font={font} lineHeight={rowH} />
    </Group>;
  })}</Group>;
}

/** The travelling card: everything that is sent, so learners see that the WHOLE conversation goes each time. */
function Payload({ title, rows, color = "#2563EB", font }: { title: string; rows: Row[]; color?: string; font: string }) {
  const w = 320, rowH = 26, h = 44 + rows.length * (rowH + 4);
  return <Group x={-w / 2} y={-h / 2} listening={false}>
    <Rect width={w} height={h} cornerRadius={14} fill="#FFFFFF" stroke={color} strokeWidth={3} shadowColor="#0F172A" shadowOpacity={0.35} shadowBlur={18} shadowOffsetY={6} />
    <Rect width={w} height={32} cornerRadius={[14, 14, 0, 0]} fill={color} />
    <Label x={12} y={0} width={w - 24} text={title} size={14} bold color="#FFFFFF" font={font} lineHeight={32} />
    <Rows x={10} y={40} w={w - 20} rows={rows} font={font} rowH={rowH} />
  </Group>;
}

/** The model: holds what it was sent only while answering, then is empty again. */
function ModelMind({ box, reading, received, facts, used, total, note, mark, font }: {
  box: Box; reading: boolean; received: Row[]; facts: Facts; used: number; total?: number; note: string; mark?: MarkTone; font: string;
}) {
  const shown = received.slice(-7);
  return <ModelCard box={box} sub="ไม่มีความจำของตัวเอง" mark={mark} font={font}>
    <Label x={box.x + 16} y={box.y + 64} width={box.w - 32} text={reading ? `📥 ได้รับรอบนี้ (${received.length} ชิ้น)` : "📥 ได้รับรอบนี้"} size={14} bold color={C.title} font={font} />
    <Rect x={box.x + 16} y={box.y + 90} width={box.w - 32} height={226} cornerRadius={12} fill="#FFFFFF" stroke="#DDD6FE" dash={reading ? undefined : [6, 5]} />
    {reading
      ? <Rows x={box.x + 26} y={box.y + 100} w={box.w - 52} rows={shown} font={font} />
      : <Para x={box.x + 26} y={box.y + 100} width={box.w - 52} height={206} text="ว่างเปล่า — ตอบเสร็จแล้วลืมหมด 🫥" size={15} color="#A78BFA" align="center" font={font} />}
    {total !== undefined && <Meter x={box.x + 16} y={box.y + 330} w={box.w - 32} used={used} total={total} label={`Context window: รับได้ ${total} ข้อความล่าสุด`} font={font} />}
    <Label x={box.x + 16} y={box.y + (total !== undefined ? 390 : 336)} width={box.w - 32} text="รู้อะไรตอนนี้:" size={13} bold color={C.title} font={font} />
    {reading
      ? <FactsList x={box.x + 16} y={box.y + (total !== undefined ? 414 : 360)} w={box.w - 32} facts={facts} empty="ไม่รู้อะไรเกี่ยวกับคุณเลย" font={font} />
      : <Label x={box.x + 16} y={box.y + (total !== undefined ? 414 : 360)} width={box.w - 32} text="ไม่รู้อะไรเลย (ไม่ได้ถืออะไรไว้)" size={13} color={C.muted} font={font} />}
    <Para x={box.x + 16} y={box.y + box.h - 66} width={box.w - 32} height={54} text={note} size={12} color={C.muted} font={font} />
  </ModelCard>;
}

/** Slots of the context window: filled = used. */
function Meter({ x, y, w, used, total, label, font, dark = false }: { x: number; y: number; w: number; used: number; total: number; label: string; font: string; dark?: boolean }) {
  const gap = 4, slot = (w - gap * (total - 1)) / total;
  const full = used >= total;
  return <Group listening={false}>
    <Label x={x} y={y} width={w} text={label} size={12} bold color={dark ? "#CBD5E1" : C.muted} font={font} />
    {Array.from({ length: total }, (_, index) => <Rect key={index} x={x + index * (slot + gap)} y={y + 20} width={slot} height={16} cornerRadius={4}
      fill={index < used ? (full ? "#F87171" : "#8B5CF6") : dark ? "#1E293B" : "#EDE9FE"} stroke={dark ? "#334155" : "#DDD6FE"} strokeWidth={1} />)}
  </Group>;
}

function FactsList({ x, y, w, facts, empty, font }: { x: number; y: number; w: number; facts: Facts; empty: string; font: string }) {
  const entries = Object.entries(facts) as [keyof typeof FACT_LABEL, string][];
  if (!entries.length) return <Label x={x} y={y} width={w} text={empty} size={13} color={C.muted} font={font} />;
  return <Group listening={false}>{entries.map(([key, value], index) =>
    <Label key={key} x={x} y={y + index * 24} width={w} text={`✓ ${FACT_LABEL[key]}: ${value}`} size={14} bold color={C.violet} font={font} />)}</Group>;
}

function ModelCard({ box, sub, mark, font, children }: { box: Box; sub: string; mark?: MarkTone; font: string; children?: ReactNode }) {
  return <Card box={box} title="🧠 โมเดล AI" sub={sub} mark={mark} fill={C.model} stroke={C.modelStroke} font={font}>{children}</Card>;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StepProps = { state: AiState; marks: Marks; play: FlowPlay | null; font: string };

function HistoryStep({ state, marks, play, font }: StepProps) {
  const scene = sceneOf("history");
  const { messages, shown, reading } = state.history;
  const window = contextWindow(messages);
  return <>
    <ChatScreen box={scene.chat!} title="💬 แอปแชท" sub="ที่เราพิมพ์คุยกับ AI · แอปเก็บประวัติแชทไว้เอง" messages={messages.slice(0, shown)}
      typing={Boolean(waitingAt(play, "chat"))} mark={toneOf(marks, "chat")} font={font} />
    <ModelMind box={scene.model} reading={Boolean(reading)} received={rowsOf(window)} facts={factsFrom(window)} used={window.length} total={AI_LIMITS.window}
      note="AI จำแชทได้เพราะแอปส่งทั้งบทสนทนามาให้อ่านใหม่ทุกครั้ง ถ้ายาวเกินที่รับได้ ข้อความเก่าจะไม่ถูกส่ง" mark={toneOf(marks, "model")} font={font} />
  </>;
}

function ThinkingStep({ state, marks, play, font }: StepProps) {
  const scene = sceneOf("thinking");
  const { on, puzzle, thoughts, answer, correct, seconds } = state.thinking;
  const question = puzzle ? puzzleOf(puzzle) : null;
  const chat = scene.chat!, model = scene.model, box = scene.thoughts!;
  const typing = Boolean(waitingAt(play, "chat"));
  return <>
    <ChatScreen box={chat} title="💬 หน้าแชท" messages={[]} typing={false} mark={toneOf(marks, "chat")} font={font}>
      {question ? <>
        {/* The whole question: a trick question only works if it can be read in full. */}
        <Rect x={chat.x + 40} y={chat.y + 58} width={chat.w - 52} height={112} cornerRadius={14} fill={C.user} />
        <Para x={chat.x + 52} y={chat.y + 62} width={chat.w - 76} height={104} text={question.question} size={14} color="#FFFFFF" font={font} />
        {(answer || typing) && <>
          <Rect x={chat.x + 12} y={chat.y + 184} width={chat.w - 100} height={46} cornerRadius={14} fill={answer ? (correct ? "#DCFCE7" : "#FEE2E2") : C.ai} />
          <Label x={chat.x + 26} y={chat.y + 184} width={chat.w - 128} text={answer ? `${answer} ${correct ? "✓" : "✗"}` : "AI กำลังคิด…"} size={answer ? 18 : 13} bold={Boolean(answer)}
            color={answer ? (correct ? C.ok : C.bad) : C.muted} font={font} lineHeight={46} />
        </>}
      </> : <Label x={chat.x + 14} y={chat.y + 60} width={chat.w - 28} text="เลือกโจทย์จากแผงด้านขวา" size={13} color={C.muted} align="center" font={font} />}
    </ChatScreen>
    <ModelCard box={model} sub="ความคิดคือข้อความที่ AI เขียนแล้วอ่านต่อเอง ก่อนให้คำตอบ" mark={toneOf(marks, "model")} font={font}>
      <Group x={model.x + model.w - 196} y={model.y + 14}>
        <Rect width={180} height={30} cornerRadius={15} fill={on ? "#16A34A" : "#94A3B8"} />
        <Label x={0} y={0} width={180} text={on ? "คิดก่อนตอบ: เปิด" : "คิดก่อนตอบ: ปิด"} size={13} bold color="#FFFFFF" align="center" font={font} lineHeight={30} />
      </Group>
    </ModelCard>
    <Card box={box} title="💭 ความคิด (Chain of Thought)" mark={toneOf(marks, "thoughts")} fill="#FFFFFF" stroke="#DDD6FE" font={font}>
      {thoughts.length === 0
        ? <Label x={box.x + 16} y={box.y + 60} width={box.w - 32} text={on ? "ยังไม่มีคำถาม" : "ปิดอยู่: AI ตอบทันทีโดยไม่เขียนความคิด"} size={14} color={C.muted} font={font} />
        : thoughts.map((thought, index) => <Group key={index}>
          <Rect x={box.x + 16} y={box.y + 48 + index * 58} width={30} height={30} cornerRadius={15} fill="#8B5CF6" />
          <Label x={box.x + 16} y={box.y + 48 + index * 58} width={30} text={String(index + 1)} size={14} bold color="#FFFFFF" align="center" font={font} lineHeight={30} />
          <Label x={box.x + 58} y={box.y + 52 + index * 58} width={box.w - 74} text={thought} size={17} color={C.text} font={font} />
        </Group>)}
    </Card>
    <Label x={model.x + 26} y={box.y + box.h + 18} width={model.w - 52}
      text={answer ? `⏱ ใช้เวลาประมาณ ${seconds} วินาที · ✍️ เขียนความคิด ${thoughts.length} ขั้น` : "⏱ คิดก่อนตอบ = ช้ากว่าและใช้ context มากกว่า แต่ถูกกว่าในโจทย์ที่ต้องคิดหลายขั้น"}
      size={14} bold={Boolean(answer)} color={answer ? (correct ? C.ok : C.bad) : C.muted} font={font} />
    {answer && <Label x={model.x + 26} y={box.y + box.h + 44} width={model.w - 52}
      text={correct ? `คำตอบ: ${answer} ✓ ถูกต้อง` : `คำตอบ: ${answer} ✗ ผิด (ที่ถูกคือ ${question!.answer})`} size={18} bold color={correct ? C.ok : C.bad} font={font} />}
  </>;
}

/** What the app sends in step 3: its memory (when on and not empty), then this chat's messages. */
function memoryRows(state: AiState): Row[] {
  const { on, items, messages } = state.memory;
  const memory: Row[] = on && items.length ? [{ icon: "🗂", text: `ความจำ: ${items.map((item) => `${FACT_LABEL[item.key]} ${item.value}`).join(", ")}`, tone: "memory" }] : [];
  return [...memory, ...rowsOf(messages)];
}

function MemoryStep({ state, marks, play, font }: StepProps) {
  const scene = sceneOf("memory");
  const { on, items, messages, shown, chat, reading } = state.memory;
  const memory = scene.memory!, frame = scene.appFrame!;
  return <>
    <Card box={frame} title="💬 แอปแชท" sub="ที่เราพิมพ์คุยกับ AI · มีแชทหลายห้อง และมี Memory ของแอปเอง" fill={C.app} font={font} />
    <ChatScreen box={scene.chat!} title={`แชท #${chat}`} messages={messages.slice(0, shown)} typing={Boolean(waitingAt(play, "chat"))} mark={toneOf(marks, "chat")} font={font} />
    <Card box={memory} title="🗂 Memory ของแอป" sub="เก็บที่แอป ไม่ได้อยู่ในตัว AI" mark={toneOf(marks, "memory")} fill={on ? "#FFFBEB" : "#F8FAFC"} stroke={on ? "#FCD34D" : "#CBD5E1"} font={font}>
      <Group x={memory.x + 14} y={memory.y + 58}>
        <Rect width={memory.w - 28} height={26} cornerRadius={13} fill={on ? "#16A34A" : "#94A3B8"} />
        <Label x={0} y={0} width={memory.w - 28} text={on ? "เปิด: จดและแนบไปทุกแชท" : "ปิด: ไม่จด ไม่แนบ"} size={12} bold color="#FFFFFF" align="center" font={font} lineHeight={26} />
      </Group>
      {items.length === 0
        ? <Label x={memory.x + 14} y={memory.y + 104} width={memory.w - 28} text="ยังไม่ได้จดอะไร" size={13} color={C.muted} font={font} />
        : items.map((item, index) => <Label key={item.key} x={memory.x + 14} y={memory.y + 100 + index * 30} width={memory.w - 28} text={`📌 ${FACT_LABEL[item.key]}: ${item.value}`} size={14} bold color="#92400E" font={font} />)}
      <Para x={memory.x + 14} y={memory.y + memory.h - 110} width={memory.w - 28} height={96}
        text="เปิดแชทใหม่ ข้อความเก่าไม่ถูกส่ง แต่แอปแนบความจำนี้ไปด้วยเสมอ" size={12} color={C.muted} font={font} />
    </Card>
    <ModelMind box={scene.model} reading={Boolean(reading)} received={memoryRows(state)} facts={factsFrom(messages, on ? items : [])} used={0}
      note="AI “จำเราได้” ข้ามแชท เพราะแอปแนบความจำมาให้อ่าน ไม่ใช่เพราะตัว AI เรียนรู้เพิ่ม" mark={toneOf(marks, "model")} font={font} />
  </>;
}

function AgentStep({ state, marks, play, font }: StepProps) {
  const scene = sceneOf("agent");
  const { code, tests, web, log } = state.agent;
  const webBox = scene.web!, model = scene.model, machine = scene.machine!, cc = scene.cc!, files = scene.files!, testBox = scene.tests!, gate = scene.permission!;
  const webMessages: ChatMsg[] = web.asked ? [{ role: "user", text: "(วางโค้ดที่ก๊อปมา) ทำไมเทสต์ไม่ผ่าน?" }, ...(web.answer ? [{ role: "ai" as const, text: web.answer }] : [])] : [];
  const gateMark = toneOf(marks, "gate");
  return <>
    {/* Left: the web chat — it can only talk. */}
    <ChatScreen box={webBox} title="🌐 AI บนเว็บ (แชท)" sub="คุยได้ แต่แตะเครื่องเราไม่ได้" messages={webMessages} typing={Boolean(waitingAt(play, "web"))} mark={toneOf(marks, "web")} font={font}>
      <Bubbles area={{ x: webBox.x + 12, y: webBox.y + 76, w: webBox.w - 24, h: 200 }} messages={webMessages} typing={Boolean(waitingAt(play, "web"))} font={font} />
      {webMessages.length === 0 && <Label x={webBox.x + 14} y={webBox.y + 96} width={webBox.w - 28} text="ยังไม่ได้ถาม" size={13} color={C.muted} align="center" font={font} />}
      <Rect x={webBox.x + 12} y={webBox.y + webBox.h - 150} width={webBox.w - 24} height={136} cornerRadius={12} fill="#FFF7ED" stroke="#FDBA74" />
      <Label x={webBox.x + 26} y={webBox.y + webBox.h - 138} width={webBox.w - 52} text={web.answer ? "✋ ต่อจากนี้เราต้องทำเอง:" : "บนเว็บ AI…"} size={14} bold color="#9A3412" font={font} />
      {(web.answer ? ["เปิดไฟล์ในเครื่อง", "แก้โค้ดเอง", "รันเทสต์เอง"] : ["มองไม่เห็นไฟล์ในเครื่องเรา", "ต้องก๊อปโค้ดไปวางเอง", "ให้ได้แค่คำแนะนำ"]).map((line, index) =>
        <Label key={index} x={webBox.x + 30} y={webBox.y + webBox.h - 108 + index * 28} width={webBox.w - 60} text={`• ${line}`} size={14} color="#9A3412" font={font} />)}
    </ChatScreen>

    {/* Middle: the same AI serves both — it only sees what is sent to it. */}
    <ModelCard box={model} sub="ตัวเดียวกันทั้งสองฝั่ง · อยู่บนคลาวด์" mark={toneOf(marks, "model")} font={font}>
      {["👀 มองไม่เห็นเครื่องเรา", "📥 รู้แค่สิ่งที่ถูกส่งมา", "🔧 ใน Claude Code “ขอใช้เครื่องมือ” ได้"].map((line, index) =>
        <Label key={index} x={model.x + 18} y={model.y + 76 + index * 34} width={model.w - 36} text={line} size={15} bold={index === 2} color={index === 2 ? C.violet : C.text} font={font} />)}
      <Rect x={model.x + 18} y={model.y + 196} width={model.w - 36} height={164} cornerRadius={12} fill="#FFFFFF" stroke="#DDD6FE" />
      <Label x={model.x + 30} y={model.y + 206} width={model.w - 60} text="🔁 วงจรของ Claude Code" size={14} bold color={C.violet} font={font} />
      {["1. AI ขอใช้เครื่องมือ", "2. Claude Code ทำในเครื่องเรา", "3. ส่งผลกลับให้ AI", "4. วนจนเสร็จ แล้วตอบ"].map((line, index) =>
        <Label key={index} x={model.x + 30} y={model.y + 236 + index * 28} width={model.w - 60} text={line} size={14} color={C.text} font={font} />)}
    </ModelCard>

    {/* Right: our machine — Claude Code acts here, and asks before editing. */}
    <Card box={machine} title="💻 เครื่องเรา" sub="Claude Code ลงมือทำให้ในเครื่องนี้" fill="#F8FAFC" font={font} />
    <Card box={cc} title="⌨️ Claude Code" mark={toneOf(marks, "cc")} fill={C.terminal} stroke="#334155" dark font={font}>
      {log.length === 0
        ? <Label x={cc.x + 14} y={cc.y + 44} width={cc.w - 28} text="$ claude" size={14} color="#86EFAC" font={font} />
        : log.slice(-7).map((line, index) => <Label key={index} x={cc.x + 14} y={cc.y + 40 + index * 24} width={cc.w - 28} text={line} size={14}
          color={line.startsWith("✅") || line.includes("✓") ? "#86EFAC" : line.includes("✗") ? "#FCA5A5" : line.startsWith(">") ? "#FDE68A" : C.terminalText} font={font} />)}
    </Card>
    <Card box={files} title="📄 main.py" mark={toneOf(marks, "files")} font={font}>
      <Label x={files.x + 14} y={files.y + 38} width={files.w - 28} text="def add(a, b):" size={15} color={C.text} font={font} />
      <Label x={files.x + 14} y={files.y + 62} width={files.w - 28} text={code === "bug" ? "    return a - b   ← บั๊ก" : "    return a + b   ✓"} size={15} bold color={code === "bug" ? C.bad : C.ok} font={font} />
    </Card>
    <Card box={testBox} mark={toneOf(marks, "tests")} font={font}>
      <Label x={testBox.x + 14} y={testBox.y} width={testBox.w - 28} text={`🧪 เทสต์: ${tests === "unknown" ? "ยังไม่ได้รัน" : tests === "fail" ? "✗ ไม่ผ่าน" : "✓ ผ่าน"}`} size={15} bold
        color={tests === "pass" ? C.ok : tests === "fail" ? C.bad : C.muted} font={font} lineHeight={testBox.h} />
    </Card>
    <Card box={gate} mark={gateMark} fill="#F5F3FF" stroke="#C4B5FD" font={font}>
      <Label x={gate.x + 14} y={gate.y} width={gate.w - 28} text={gateMark === "allowed" ? "🔐 ✓ คุณกดอนุญาตแล้ว" : gateMark === "read" ? "🔐 ขอแก้ไฟล์… อนุญาตไหม?" : "🔐 ถามเราก่อนแก้ไฟล์เสมอ"} size={14} bold color={C.violet} font={font} lineHeight={gate.h} />
    </Card>
  </>;
}

/** Stacked context bar: CLAUDE.md, memory and the conversation, out of the session's room. */
function ContextBar({ x, y, w, rules, memories, chat, total, font }: { x: number; y: number; w: number; rules: number; memories: number; chat: number; total: number; font: string }) {
  const gap = 3, slot = (w - gap * (total - 1)) / total;
  const colours = [...Array(rules).fill("#60A5FA"), ...Array(memories).fill("#FBBF24"), ...Array(Math.max(0, chat)).fill("#A78BFA")].slice(0, total);
  const used = Math.min(total, rules + memories + Math.max(0, chat));
  return <Group listening={false}>
    <Label x={x} y={y} width={w} text={`Context ที่ส่งทุกครั้ง: ${used}/${total}${used >= total ? " (เต็ม)" : ""}`} size={13} bold color="#E2E8F0" font={font} />
    {Array.from({ length: total }, (_, index) => <Rect key={index} x={x + index * (slot + gap)} y={y + 22} width={slot} height={18} cornerRadius={4}
      fill={colours[index] ?? "#1E293B"} stroke="#334155" strokeWidth={1} />)}
    {[["#60A5FA", "CLAUDE.md"], ["#FBBF24", "ความจำ"], ["#A78BFA", "บทสนทนา"]].map(([colour, label], index) => <Group key={label} x={x + index * (w / 3)} y={y + 50}>
      <Rect width={12} height={12} y={2} cornerRadius={3} fill={colour} />
      <Label x={16} y={0} width={w / 3 - 18} text={label} size={12} color="#CBD5E1" font={font} />
    </Group>)}
  </Group>;
}

function CcMemoryStep({ state, marks, font }: StepProps) {
  const scene = sceneOf("ccMemory");
  const { rules, memories, session, context, chat, summarized, reading } = state.cc;
  const md = scene.claudeMd!, dir = scene.memoryDir!, cc = scene.cc!, model = scene.model;
  const received = ccContextLines(state).map(rowOfLine);
  return <>
    {/* Left: files on our disk — they stay when the session ends. */}
    <Card box={scene.machine!} title="💾 ไฟล์ในเครื่องเรา" sub="อยู่ถาวร ปิด session ก็ไม่หาย" fill="#F8FAFC" font={font} />
    <Card box={md} title="📄 CLAUDE.md" sub="คำสั่งโปรเจกต์ · เราเขียนเอง" mark={toneOf(marks, "claudeMd")} fill="#EFF6FF" stroke="#93C5FD" font={font}>
      {rules.map((rule, index) => <Label key={index} x={md.x + 14} y={md.y + 64 + index * 28} width={md.w - 28} text={`• ${rule}`} size={14} color="#1E3A8A" font={font} />)}
    </Card>
    <Card box={dir} title="📌 ไฟล์ความจำ" sub="Claude จดเองข้าม session · เปิดอ่าน/ลบได้" mark={toneOf(marks, "memoryDir")} fill="#FFFBEB" stroke="#FCD34D" font={font}>
      {memories.length === 0
        ? <Label x={dir.x + 14} y={dir.y + 70} width={dir.w - 28} text="ยังไม่มี" size={14} color={C.muted} font={font} />
        : memories.map((memory, index) => <Label key={index} x={dir.x + 14} y={dir.y + 64 + index * 28} width={dir.w - 28} text={`• ${memory}`} size={15} bold color="#92400E" font={font} />)}
    </Card>

    {/* Middle: the session — temporary; everything in it is sent with every message. */}
    <Card box={cc} title={session ? `⌨️ Claude Code · session #${session}` : "⌨️ Claude Code"} sub="บทสนทนาชั่วคราว ปิด session แล้วหาย" mark={toneOf(marks, "cc")} fill={C.terminal} stroke="#334155" dark font={font}>
      {session === 0
        ? <Label x={cc.x + 16} y={cc.y + 70} width={cc.w - 32} text="ยังไม่ได้เปิด session" size={15} color="#94A3B8" font={font} />
        : <>
          <Label x={cc.x + 16} y={cc.y + 62} width={cc.w - 32} text={`↳ อ่าน CLAUDE.md${memories.length ? ` + ความจำ ${memories.length} เรื่อง` : ""}`} size={13} color="#93C5FD" font={font} />
          {chat.map((line, index) => <Label key={index} x={cc.x + 16} y={cc.y + 94 + index * 30} width={cc.w - 32} text={line} size={14}
            color={line.startsWith("สรุป") ? "#FDE68A" : line.startsWith("คุณ") ? "#F8FAFC" : "#C4B5FD"} font={font} />)}
          {summarized && <Group x={cc.x + cc.w - 124} y={cc.y + 14}>
            <Rect width={110} height={22} cornerRadius={11} fill="#F59E0B" />
            <Label x={0} y={0} width={110} text="สรุปย่อแล้ว" size={12} bold color="#1F2937" align="center" font={font} lineHeight={22} />
          </Group>}
        </>}
      <ContextBar x={cc.x + 16} y={cc.y + cc.h - 84} w={cc.w - 32} rules={session ? rules.length : 0} memories={session ? memories.length : 0}
        chat={session ? context - rules.length - memories.length : 0} total={AI_LIMITS.ccContext} font={font} />
    </Card>

    {/* Right: the AI holds what it was sent only while answering. */}
    <ModelCard box={model} sub="ไม่มีความจำของตัวเอง" mark={toneOf(marks, "model")} font={font}>
      <Label x={model.x + 16} y={model.y + 64} width={model.w - 32} text={reading ? `📥 ได้รับรอบนี้ (${received.length} ชิ้น)` : "📥 ได้รับรอบนี้"} size={14} bold color={C.title} font={font} />
      <Rect x={model.x + 16} y={model.y + 90} width={model.w - 32} height={336} cornerRadius={12} fill="#FFFFFF" stroke="#DDD6FE" dash={reading ? undefined : [6, 5]} />
      {reading
        ? <Rows x={model.x + 26} y={model.y + 100} w={model.w - 52} rows={received.slice(-10)} font={font} />
        : <Para x={model.x + 26} y={model.y + 100} width={model.w - 52} height={316} text="ว่างเปล่า — ตอบเสร็จแล้วลืมหมด 🫥" size={15} color="#A78BFA" align="center" font={font} />}
      <Para x={model.x + 16} y={model.y + model.h - 96} width={model.w - 32} height={84}
        text="Claude “จำ” ข้าม session ได้ เพราะ Claude Code ส่งไฟล์ CLAUDE.md กับไฟล์ความจำไปด้วยทุกข้อความ" size={13} color={C.muted} font={font} />
    </ModelCard>
  </>;
}

const STEPS: Record<AiView, (props: StepProps) => JSX.Element> = {
  history: HistoryStep, thinking: ThinkingStep, memory: MemoryStep, agent: AgentStep, ccMemory: CcMemoryStep,
};

/** Canvas rendering of an AI simulator node. `play` (editor only) animates the last action. */
export function AiWidgetView({ node, play, fontFamily: font }: { node: AiSimulatorNode; play: FlowPlay | null; fontFamily: string }): JSX.Element {
  const view = node.view;
  const scene = sceneOf(view);
  const flow = useFlowPlayback<AiState, Pt>(node.id, play, node.state, (_before, _after, move) => hopPath(view, move));
  const onPath = (point: Pt) => Boolean(flow.path?.some((item) => Math.abs(item.x - point.x) < 1 && Math.abs(item.y - point.y) < 1));
  const title = AI_VIEWS.find((item) => item.id === view)!;
  const Step = STEPS[view];
  // Steps 1 and 3: the packet IS the messages (the whole conversation), and the answer flies back as a bubble.
  const move = flow.moving;
  const after = flow.frame?.state;
  let body: ReactNode = undefined;
  if (move?.detail) {
    const rows: Row[] = move.detail.slice(-12).map(rowOfLine);
    // 📤 = sent to the AI, 🧠 = the AI answers or asks for a tool.
    body = <Payload title={`${move.to === "model" ? "📤" : "🧠"} ${move.label}`} rows={rows} color={TONE_COLOR[move.tone]} font={font} />;
  } else if (move && after && (view === "history" || view === "memory")) {
    if (move.from === "chat" && move.to === "model") {
      const rows = view === "history" ? rowsOf(contextWindow(flow.state.history.messages)) : memoryRows(flow.state);
      body = <Payload title={`📨 ${move.label}`} rows={rows.slice(-8)} font={font} />;
    } else if (move.from === "model" && move.to === "chat") {
      const reply = (view === "history" ? after.history.messages : after.memory.messages).at(-1);
      if (reply) body = <Payload title="🤖 คำตอบของ AI" rows={[{ icon: "🤖", text: reply.text, tone: "ai" }]} color={move.tone === "blocked" ? "#DC2626" : "#16A34A"} font={font} />;
    }
  }
  return <Group scaleX={node.scale} scaleY={node.scale} clipX={0} clipY={0} clipWidth={AI_W} clipHeight={AI_H}>
    <Rect x={1} y={1} width={AI_W - 2} height={AI_H - 2} cornerRadius={18} fill={C.frame} stroke={C.frameStroke} strokeWidth={2} />
    <Label x={24} y={18} width={AI_W - 280} text={`AI ทำงานยังไง: ${title.label}`} size={24} bold color={C.title} font={font} />
    <Group x={AI_W - 244} y={18}>
      <Rect width={220} height={28} cornerRadius={14} fill="#F5F3FF" stroke="#C4B5FD" />
      <Label x={0} y={0} width={220} text="จำลอง · ไม่ได้เรียก AI จริง" size={12} bold color={C.violet} align="center" font={font} lineHeight={28} />
    </Group>
    {scene.pipes.map((pipe, index) => <Pipe key={index} from={pipe.from} to={pipe.to} label={pipe.label}
      active={flow.moving && onPath(pipe.from) && onPath(pipe.to) ? flow.moving.tone : null} font={font} />)}
    <Step state={flow.state} marks={flow.marks} play={play} font={font} />
    <CaptionBar box={CAPTION_BOX} text={flow.frame ? flow.frame.caption : IDLE[view]} step={flow.step} font={font} />
    {flow.moving && flow.path && <Packet key={flow.runKey} runKey={flow.runKey} path={flow.path} label={flow.moving.label} tone={flow.moving.tone}
      duration={flow.travel} font={font} onLanded={flow.onLanded} body={body} />}
  </Group>;
}
