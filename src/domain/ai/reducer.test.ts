import { describe, expect, it } from "vitest";
import { factsIn, replyTo } from "./chat";
import { createInitialAiState } from "./initial";
import { AI_LIMITS, type AiAction, type AiState } from "./model";
import { applyAiAction, contextWindow } from "./reducer";

function play(state: AiState, ...actions: AiAction[]): AiState {
  return actions.reduce((current, action) => applyAiAction(current, action).nextState, state);
}
const route = (state: AiState, action: AiAction) =>
  applyAiAction(state, action).frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`);

describe("scripted AI (no real model)", () => {
  it("finds facts in Thai sentences and answers only from what it received", () => {
    expect(factsIn("สวัสดี ผมชื่อต้น")).toEqual({ name: "ต้น" });
    expect(factsIn("ผมชื่อต้น เป็นครูสอนเขียนโปรแกรม")).toEqual({ name: "ต้น", job: "ครูสอนเขียนโปรแกรม" });
    expect(factsIn("ผมชอบลาเต้")).toEqual({ like: "ลาเต้" });
    expect(factsIn("ผมชื่ออะไรนะ?")).toEqual({});
    expect(replyTo("ผมชื่ออะไรนะ?", { name: "ต้น" })).toMatchObject({ text: "คุณชื่อต้นครับ", known: true });
    expect(replyTo("ผมชื่ออะไรนะ?", {})).toMatchObject({ asked: "name", known: false });
    expect(replyTo("ผมทำงานอะไร?", { job: "ครู" }).text).toBe("คุณเป็นครูครับ");
  });
});

describe("step 1 — the app sends the whole chat every time", () => {
  it("each send carries the history; the chat screen shows the answer only when it arrives", () => {
    const first = applyAiAction(createInitialAiState(), { type: "chat.send", text: "สวัสดี ผมชื่อต้น" });
    // Typed in the chat app → the whole conversation travels to the model → it reads → answers and forgets.
    expect(route(createInitialAiState(), { type: "chat.send", text: "สวัสดี ผมชื่อต้น" })).toEqual([null, "chat→model:data", null, "model→chat:ok"]);
    expect(first.frames[1].hop?.label).toBe("ส่งทั้ง 1 ข้อความ");
    // The model holds what it was sent only while answering.
    expect(first.frames[1].state.history.reading).toBe(true);
    expect(first.frames[2].state.history.messages).toHaveLength(1);
    expect(first.nextState.history).toEqual({ messages: [{ role: "user", text: "สวัสดี ผมชื่อต้น" }, { role: "ai", text: "ยินดีที่ได้รู้จักครับ คุณต้น!" }], shown: 2 });
    const second = applyAiAction(first.nextState, { type: "chat.send", text: "ผมชื่ออะไรนะ?" });
    expect(second.frames[1].hop?.label).toBe("ส่งทั้ง 3 ข้อความ");
    expect(second.outcome).toBe("success");
    expect(second.nextState.history.messages.at(-1)?.text).toBe("คุณชื่อต้นครับ");
  });

  it("when the chat outgrows the context window the oldest messages drop out and the AI forgets", () => {
    let state = play(createInitialAiState(),
      { type: "chat.send", text: "สวัสดี ผมชื่อต้น" }, { type: "chat.send", text: "ผมชอบลาเต้" }, { type: "chat.send", text: "เล่าเรื่องแมวหน่อย" });
    expect(state.history.messages.some((message) => message.out)).toBe(false);
    const ask = applyAiAction(state, { type: "chat.send", text: "ผมชื่ออะไรนะ?" });
    expect(ask.frames[1].caption).toContain("จะไม่ถูกส่งไปแล้ว"); // the “dropped out” frame
    expect(ask.outcome).toBe("failed");
    expect(ask.message).toContain("ลืมชื่อ");
    state = ask.nextState;
    expect(state.history.messages.filter((message) => message.out).map((message) => message.text)).toEqual(["สวัสดี ผมชื่อต้น", "ยินดีที่ได้รู้จักครับ คุณต้น!", "ผมชอบลาเต้", "จดไว้แล้วครับ คุณชอบลาเต้"].slice(0, state.history.messages.length - AI_LIMITS.window));
    expect(contextWindow(state.history.messages)).toHaveLength(AI_LIMITS.window);
    // A new chat starts empty.
    expect(play(state, { type: "chat.new" }).history).toEqual({ messages: [], shown: 0 });
    expect(applyAiAction(createInitialAiState(), { type: "chat.send", text: "  " }).outcome).toBe("rejected");
  });
});

describe("step 2 — chain of thought", () => {
  it("answering at once gets the trick question wrong; thinking step by step gets it right", () => {
    const quick = applyAiAction(createInitialAiState(), { type: "think.ask", puzzle: "pen" });
    expect(quick.outcome).toBe("failed");
    expect(quick.nextState.thinking).toMatchObject({ answer: "10 บาท", correct: false, thoughts: [] });
    const on = play(createInitialAiState(), { type: "think.set", on: true });
    const slow = applyAiAction(on, { type: "think.ask", puzzle: "pen" });
    expect(slow.frames.map((frame) => frame.hop?.to ?? "think")).toEqual(["model", "think", "think", "think", "think", "chat"]);
    expect(slow.nextState.thinking).toMatchObject({ answer: "5 บาท", correct: true });
    expect(slow.nextState.thinking.thoughts).toHaveLength(4);
    expect(slow.nextState.thinking.seconds).toBeGreaterThan(quick.nextState.thinking.seconds);
  });
});

describe("step 3 — a web AI's memory lives in the app, not in the model", () => {
  it("the app notes facts and attaches them to a new chat; with memory off the new chat knows nothing", () => {
    let state = play(createInitialAiState(), { type: "memory.send", text: "ผมชื่อต้น เป็นครูสอนเขียนโปรแกรม" });
    expect(state.memory.items).toEqual([{ key: "name", value: "ต้น" }, { key: "job", value: "ครูสอนเขียนโปรแกรม" }]);
    state = play(state, { type: "memory.newChat" });
    expect(state.memory).toMatchObject({ chat: 2, messages: [], shown: 0 });
    const ask = applyAiAction(state, { type: "memory.send", text: "ผมชื่ออะไรนะ?" });
    expect(ask.frames[1].hop).toMatchObject({ from: "chat", to: "model", label: "ความจำ + 1 ข้อความ" });
    expect(ask.nextState.memory.reading).toBeUndefined();
    expect(ask.outcome).toBe("success");
    expect(ask.nextState.memory.messages.at(-1)?.text).toBe("คุณชื่อต้นครับ");

    const off = play(state, { type: "memory.set", on: false });
    const blind = applyAiAction(off, { type: "memory.send", text: "ผมชื่ออะไรนะ?" });
    expect(blind.outcome).toBe("failed");
    expect(blind.frames[1].hop?.label).toBe("1 ข้อความ");
    expect(play(state, { type: "memory.clear" }).memory.items).toEqual([]);
  });
});

describe("step 4 — web AI vs Claude Code", () => {
  it("the web AI only advises; Claude Code loops through tools on our machine until the tests pass", () => {
    const web = applyAiAction(createInitialAiState(), { type: "agent.web" });
    expect(web.nextState.agent).toMatchObject({ code: "bug", tests: "unknown", web: { asked: true } });
    const cc = applyAiAction(createInitialAiState(), { type: "agent.cc" });
    const hops = cc.frames.map((frame) => frame.hop ? `${frame.hop.from}→${frame.hop.to}` : "gate");
    expect(hops.slice(0, 5)).toEqual(["cc→model", "model→cc", "cc→files", "files→cc", "cc→model"]);
    expect(hops).toContain("gate");
    expect(cc.nextState.agent).toMatchObject({ code: "fixed", tests: "pass" });
    expect(applyAiAction(cc.nextState, { type: "agent.cc" }).outcome).toBe("noop");
    expect(play(cc.nextState, { type: "agent.reset" }).agent).toEqual(createInitialAiState().agent);
  });
});

describe("step 5 — Claude Code's memory", () => {
  it("CLAUDE.md and memory files load into every new session; the chat itself does not survive", () => {
    expect(applyAiAction(createInitialAiState(), { type: "cc.say", say: "thai" }).outcome).toBe("rejected");
    let state = play(createInitialAiState(), { type: "cc.start" }, { type: "cc.say", say: "thai" });
    expect(state.cc.memories).toEqual(["ตอบเป็นภาษาไทยเสมอ"]);
    state = play(state, { type: "cc.start" });
    expect(state.cc).toMatchObject({ session: 2, chat: [], context: 3 });
    const ask = applyAiAction(state, { type: "cc.say", say: "ask" });
    expect(ask.outcome).toBe("success");
    expect(ask.message).toContain("จากไฟล์ความจำ");
    // Without the memory file a new session does not know.
    const forgot = play(state, { type: "cc.forget" }, { type: "cc.start" });
    expect(applyAiAction(forgot, { type: "cc.say", say: "ask" }).outcome).toBe("failed");
  });

  it("a long session summarizes itself when the context is full", () => {
    let state = play(createInitialAiState(), { type: "cc.start" }, { type: "cc.say", say: "work" });
    expect(state.cc.summarized).toBe(false);
    const full = applyAiAction(state, { type: "cc.say", say: "work" });
    expect(full.nextState.cc.summarized).toBe(true);
    expect(full.nextState.cc.chat).toHaveLength(1);
    expect(full.nextState.cc.chat[0]).toMatch(/^สรุป: /);
    state = full.nextState;
    expect(state.cc.context).toBeLessThanOrEqual(AI_LIMITS.ccContext);
    expect(applyAiAction(createInitialAiState(), { type: "reset" }).outcome).toBe("noop");
  });
});

describe("persisted schema accepts every AI state the lesson produces", () => {
  it("parses each frame state of a long session in every step", async () => {
    const { createProjectContent } = await import("../document/model");
    const { parseProjectContent } = await import("../document/schema");
    const script: AiAction[] = [
      ...["สวัสดี ผมชื่อต้น", "ผมชอบลาเต้", "เล่าเรื่องแมวหน่อย", "ผมชื่ออะไรนะ?", "ผมชอบกินอะไร?", "ผมชื่อต้น", "เล่าเรื่องแมวหน่อย",
        "ผมชอบลาเต้", "เล่าเรื่องแมวหน่อย", "ผมชื่ออะไรนะ?", "ผมชอบกินอะไร?", "ผมชื่อต้น", "เล่าเรื่องแมวหน่อย"].map((text): AiAction => ({ type: "chat.send", text })),
      { type: "think.ask", puzzle: "letters" }, { type: "think.set", on: true }, { type: "think.ask", puzzle: "apples" },
      { type: "memory.send", text: "ผมชื่อต้น เป็นครูสอนเขียนโปรแกรม" }, { type: "memory.send", text: "ผมชอบลาเต้" }, { type: "memory.newChat" }, { type: "memory.send", text: "ผมทำงานอะไร?" },
      { type: "agent.web" }, { type: "agent.cc" },
      { type: "cc.start" }, { type: "cc.say", say: "thai" }, { type: "cc.say", say: "work" }, { type: "cc.say", say: "work" }, { type: "cc.say", say: "ask" }, { type: "cc.compact" },
    ];
    let state = createInitialAiState();
    const states: AiState[] = [];
    for (const action of script) {
      const transition = applyAiAction(state, action);
      states.push(...transition.frames.map((frame) => frame.state));
      state = transition.nextState;
    }
    expect(state.history.messages.length).toBeLessThanOrEqual(AI_LIMITS.messages);
    for (const item of states) {
      const content = createProjectContent("บทเรียน AI");
      content.document.slides[0].nodes.push({
        id: "4f0c7c3e-2b1a-4d7e-9a55-2d6f1b9e0c11", type: "ai-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "history", state: item,
      });
      const parsed = parseProjectContent(JSON.parse(JSON.stringify(content)));
      expect(parsed.document.slides[0].nodes[0]).toMatchObject({ type: "ai-simulator", state: item });
    }
  });
});
