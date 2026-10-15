import { describe, expect, it } from "vitest";
import type { FlowFrame } from "../../domain/data/model";
import { createInitialAiState } from "../../domain/ai/initial";
import type { AiAction, AiState, AiView } from "../../domain/ai/model";
import { applyAiAction } from "../../domain/ai/reducer";
import { revealForParts } from "../../domain/document/reveal";
import { spotsOfFrames, walkFrames } from "../flow/frame-walk";
import { aiPartOfSpot, aiParts, aiPartsOfFrames, sceneOf, spotPoint } from "./ai-layout";

// Actions the panel offers in each lesson step. The places frames name come from running the reducer, not from the layout.
const VIEWS: Record<AiView, AiAction[]> = {
  history: [{ type: "chat.send", text: "สวัสดี ผมชื่อต้น" }, { type: "chat.send", text: "ผมชื่ออะไรนะ?" }, { type: "chat.new" }],
  thinking: [{ type: "think.set", on: true }, { type: "think.set", on: false }, { type: "think.ask", puzzle: "pen" }, { type: "think.ask", puzzle: "letters" }, { type: "think.ask", puzzle: "apples" }],
  memory: [{ type: "memory.set", on: true }, { type: "memory.set", on: false }, { type: "memory.send", text: "ผมชื่อต้น เป็นครู" }, { type: "memory.send", text: "ผมชื่ออะไรนะ?" }, { type: "memory.newChat" }, { type: "memory.clear" }],
  agent: [{ type: "agent.web" }, { type: "agent.cc" }, { type: "agent.reset" }],
  ccMemory: [{ type: "cc.start" }, { type: "cc.say", say: "thai" }, { type: "cc.say", say: "work" }, { type: "cc.say", say: "ask" }, { type: "cc.compact" }, { type: "cc.forget" }],
};
const framesOf = (view: AiView) => walkFrames(createInitialAiState(), VIEWS[view], (state: AiState, action: AiAction) => applyAiAction(state, action), 4);
const unmapped = (view: AiView, frames: FlowFrame<unknown>[], partOf: (view: AiView, spot: string) => string | null) =>
  [...spotsOfFrames(frames)].filter((spot) => partOf(view, spot) === null).sort();

describe("AI reveal parts (plan 07 §2)", () => {
  it("each step has 3–6 ordered, labelled parts with unique ids", () => {
    for (const view of Object.keys(VIEWS) as AiView[]) {
      const parts = aiParts(view);
      expect(parts.length, view).toBeGreaterThanOrEqual(3);
      expect(parts.length, view).toBeLessThanOrEqual(6);
      expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
      for (const part of parts) expect(part.label.trim()).not.toBe("");
    }
    expect(aiParts("history").map((part) => part.id)).toEqual(["chat", "model", "mind"]);
    expect(aiParts("agent").map((part) => part.id)).toEqual(["web", "model", "cc", "files", "tests", "gate"]);
  });

  for (const view of Object.keys(VIEWS) as AiView[]) {
    it(`step ${view}: every place any frame names maps to a part of the step, and exactly the drawn ones do`, () => {
      const frames = framesOf(view);
      expect(frames.length).toBeGreaterThan(8);
      expect(spotsOfFrames(frames).size).toBeGreaterThanOrEqual(2);
      // A place the step does not draw (the chat app's frame mark “app” in step 1) has no part: nothing to reveal for it.
      const notDrawn = [...spotsOfFrames(frames)].filter((spot) => spotPoint(view, spot) === null).sort();
      expect(unmapped(view, frames, aiPartOfSpot)).toEqual(notDrawn);
      expect(notDrawn.every((spot) => spot === "app")).toBe(true);
      const ids = aiParts(view).map((part) => part.id);
      for (const spot of spotsOfFrames(frames)) if (!notDrawn.includes(spot)) expect(ids).toContain(aiPartOfSpot(view, spot));
      for (const spot of ["chat", "memory", "model", "thoughts", "web", "cc", "files", "tests", "gate", "claudeMd", "memoryDir", "nowhere"]) expect(aiPartOfSpot(view, spot) === null, `${view} ${spot}`).toBe(spotPoint(view, spot) === null);
    });
    it(`step ${view}: every part is the home of a drawn place or a pipe, and every pipe belongs to a part`, () => {
      const ids = aiParts(view).map((part) => part.id);
      const homes = new Set<string | null>(["chat", "memory", "model", "thoughts", "web", "cc", "files", "tests", "gate", "claudeMd", "memoryDir"].map((spot) => aiPartOfSpot(view, spot)));
      for (const pipe of sceneOf(view).pipes) { expect(ids).toContain(pipe.part); homes.add(pipe.part); }
      for (const id of ids) expect(homes.has(id), `${view} ${id}`).toBe(true);
    });
  }

  it("planted omission: a mapping that forgets the model is reported", () => {
    const forgetful = (view: AiView, spot: string) => (spot === "model" ? null : aiPartOfSpot(view, spot));
    expect(unmapped("history", framesOf("history"), aiPartOfSpot)).not.toContain("model");
    expect(unmapped("history", framesOf("history"), forgetful)).toContain("model");
  });

  it("actions need their parts (counts follow part order)", () => {
    const fresh = createInitialAiState();
    const need = (action: AiAction, view: AiView) => aiPartsOfFrames(view, applyAiAction(fresh, action).frames).sort();
    expect(need({ type: "chat.send", text: "สวัสดี ผมชื่อต้น" }, "history")).toEqual(["chat", "mind"]);
    expect(revealForParts(aiParts("history"), 0, need({ type: "chat.send", text: "สวัสดี ผมชื่อต้น" }, "history"))).toBe(3);
    expect(need({ type: "agent.web" }, "agent")).toEqual(expect.arrayContaining(["web", "model"]));
    expect(revealForParts(aiParts("agent"), 0, need({ type: "agent.cc" }, "agent"))).toBeGreaterThanOrEqual(5);
    expect(need({ type: "cc.start" }, "ccMemory")).toEqual(expect.arrayContaining(["cc"]));
  });
});
