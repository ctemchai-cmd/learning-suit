import { describe, expect, it } from "vitest";
import type { FlowFrame } from "../../domain/data/model";
import { createInitialDataState } from "../../domain/data/initial";
import type { DataAction, DataState, DataView } from "../../domain/data/model";
import { applyDataAction } from "../../domain/data/reducer";
import { revealForParts } from "../../domain/document/reveal";
import { spotsOfFrames, walkFrames } from "../flow/frame-walk";
import { MONITOR_STAND } from "../flow/monitor";
import { ACCESS, CAPTION_BOX, DATA_W, dataPartOfSpot, dataParts, dataPartsOfFrames, pipesOf, RELATION, spotPoint, TABLE, WHERE, type Box } from "./data-layout";

// Actions the panel offers in each lesson step. The places frames name come from running the reducer, not from the layout.
const VIEWS: Record<DataView, DataAction[]> = {
  where: [{ type: "storage.mode", mode: "app" }, { type: "storage.mode", mode: "device" }, { type: "storage.mode", mode: "cloud" }, { type: "storage.record", item: "ค่ากาแฟ 60 บาท" },
    { type: "storage.refresh", computer: "A" }, { type: "storage.open", computer: "B" }, { type: "storage.open", computer: "A" }],
  table: [{ type: "category.create", name: "ของขวัญ", kind: "รายจ่าย", active: true }, { type: "category.create", name: "x", kind: "ออม", active: true }, { type: "category.read", computer: "A" },
    { type: "category.update", id: 1, field: "kind", value: "รายรับ" }, { type: "category.update", id: 1, field: "kind", value: "ออม" }, { type: "category.update", id: 2, field: "active", value: "false" }, { type: "category.delete", id: 1 }],
  relation: [{ type: "category.rename", id: 2, name: "อาหารและเครื่องดื่ม" }, { type: "transactions.fixCopies", categoryId: 2 }, { type: "transaction.create", userId: 1, categoryId: 3, amount: "100" },
    { type: "category.deleteLinked", id: 2 }, { type: "transactions.deleteOfCategory", categoryId: 2 }],
  access: [{ type: "access.rules", on: false }, { type: "access.rules", on: true }, { type: "access.read", computer: "A", table: "transactions" }, { type: "access.read", computer: "B", table: "transactions" },
    { type: "access.read", computer: "A", table: "categories" }, { type: "access.read", computer: "B", table: "categories" }],
};
const framesOf = (view: DataView) => walkFrames(createInitialDataState(), VIEWS[view], (state: DataState, action: DataAction) => applyDataAction(state, action), 3);
const unmapped = (view: DataView, frames: FlowFrame<unknown>[], partOf: (view: DataView, spot: string) => string | null) =>
  [...spotsOfFrames(frames)].filter((spot) => partOf(view, spot) === null).sort();

describe("data reveal parts (plan 07 §2)", () => {
  it("each step has 3–6 ordered, labelled parts with unique ids", () => {
    for (const view of Object.keys(VIEWS) as DataView[]) {
      const parts = dataParts(view);
      expect(parts.length, view).toBeGreaterThanOrEqual(3);
      expect(parts.length, view).toBeLessThanOrEqual(6);
      expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
      for (const part of parts) expect(part.label.trim()).not.toBe("");
    }
    expect(dataParts("where").map((part) => part.id)).toEqual(["pcA", "memA", "devA", "cloud", "pcB"]);
    expect(dataParts("access").map((part) => part.id)).toEqual(["pcA", "pcB", "gate", "db", "categories", "transactions"]);
  });

  for (const view of Object.keys(VIEWS) as DataView[]) {
    it(`step ${view}: every place any frame names maps to a part of the step, and exactly the drawn ones do`, () => {
      const frames = framesOf(view);
      expect(frames.length).toBeGreaterThan(8);
      expect(spotsOfFrames(frames).size).toBeGreaterThanOrEqual(3);
      expect(unmapped(view, frames, dataPartOfSpot)).toEqual([]);
      const ids = dataParts(view).map((part) => part.id);
      for (const frame of frames) for (const spot of spotsOfFrames([frame])) {
        expect(ids).toContain(dataPartOfSpot(view, spot));
        // Rows can be off the visible list (spotPoint null) while their part still exists; non-row places must agree with the scene.
        if (!spot.includes("row:") && !spot.includes("cell:")) expect(spotPoint(view, frame.state, spot) === null, `${view} ${spot}`).toBe(false);
      }
    });
    it(`step ${view}: every part is the home of a named place or a pipe, and every pipe belongs to a part`, () => {
      const ids = dataParts(view).map((part) => part.id);
      const homes = new Set<string | null>([...spotsOfFrames(framesOf(view))].map((spot) => dataPartOfSpot(view, spot)));
      for (const pipe of pipesOf(view)) { expect(ids).toContain(pipe.part); homes.add(pipe.part); }
      // Parts that only hold a frame or a label (e.g. the app window of step 3's refs) may have no spot: they are the pipes' / tables' homes.
      const lonely = ids.filter((id) => !homes.has(id));
      expect(lonely.every((id) => (view === "table" && id === "categories") || (view === "relation" && id === "link"))).toBe(true);
    });
  }

  it("planted omission: a mapping that forgets the gate is reported", () => {
    const forgetful = (view: DataView, spot: string) => (spot === "gate" ? null : dataPartOfSpot(view, spot));
    expect(unmapped("access", framesOf("access"), forgetful)).toEqual(["gate"]);
  });

  it("actions need their parts (counts follow part order; the gate / cloud a packet passes comes along)", () => {
    const fresh = createInitialDataState();
    const need = (view: DataView, action: DataAction, state = fresh) => dataPartsOfFrames(view, applyDataAction(state, action).frames).sort();
    expect(need("where", { type: "storage.record", item: "ค่ากาแฟ 60 บาท" })).toEqual(expect.arrayContaining(["pcA", "memA"]));
    expect(revealForParts(dataParts("where"), 0, need("where", { type: "storage.mode", mode: "cloud" }))).toBeGreaterThanOrEqual(0);
    const cloud = applyDataAction(fresh, { type: "storage.mode", mode: "cloud" }).nextState;
    expect(need("where", { type: "storage.record", item: "ค่ากาแฟ 60 บาท" }, cloud)).toEqual(expect.arrayContaining(["pcA", "cloud"]));
    expect(need("table", { type: "category.read", computer: "A" })).toEqual(expect.arrayContaining(["pc", "gate", "db"]));
    expect(revealForParts(dataParts("table"), 0, need("table", { type: "category.read", computer: "A" }))).toBe(4);
    expect(need("access", { type: "access.read", computer: "B", table: "transactions" })).toEqual(expect.arrayContaining(["pcB", "gate", "transactions"]));
    expect(revealForParts(dataParts("access"), 0, need("access", { type: "access.read", computer: "B", table: "transactions" }))).toBe(6);
  });
});

describe("computers are drawn as desktop monitors that fit the scene", () => {
  const stand = (frame: Box): Box => ({ ...frame, h: frame.h + MONITOR_STAND });
  const inside = (box: Box, outer: Box) => box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w && box.y + box.h <= outer.y + outer.h;
  const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const board: Box = { x: 0, y: 0, w: DATA_W, h: CAPTION_BOX.y };

  it("every monitor (with its neck and base) fits inside the board above the caption bar", () => {
    const monitors = [WHERE.A.frame, WHERE.B.frame, TABLE.pc.frame, ACCESS.A.frame, ACCESS.B.frame];
    expect(monitors).toHaveLength(5);
    for (const frame of monitors) expect(inside(stand(frame), board), JSON.stringify(frame)).toBe(true);
  });

  it("the screen sits inside the bezel and leaves a chin; the two stacked monitors of step 4 do not overlap", () => {
    for (const { frame, screen } of [TABLE.pc, ACCESS.A, ACCESS.B]) {
      expect(inside(screen, frame)).toBe(true);
      expect(frame.y + frame.h - (screen.y + screen.h)).toBeGreaterThan(20);
    }
    expect(overlap(stand(ACCESS.A.frame), stand(ACCESS.B.frame))).toBe(false);
    // A step-4 screen shows six rows (the leaked ones) in 24 px lines.
    expect(Math.floor((ACCESS.A.screen.h - 40) / 24)).toBeGreaterThanOrEqual(6);
  });

  it("step 1: the app fills the screen, memory sits inside the app, and the device storage is below the stand", () => {
    for (const id of ["A", "B"] as const) {
      const pc = WHERE[id];
      expect(inside(pc.screen, pc.app)).toBe(true);
      expect(inside(pc.memory, pc.app)).toBe(true);
      expect(overlap(pc.device, stand(pc.frame))).toBe(false);
      expect(inside(pc.device, board)).toBe(true);
      expect(overlap(pc.device, pc.memory)).toBe(false);
    }
    // The pipes leave the monitor's side.
    expect(WHERE.pipeA[0].x).toBe(WHERE.A.frame.x + WHERE.A.frame.w);
    expect(WHERE.pipeB[1].x).toBe(WHERE.B.frame.x);
  });

  it("step 3: the mini monitor with its stand stays above the two designs", () => {
    expect(RELATION.app.y + RELATION.app.h + MONITOR_STAND).toBeLessThanOrEqual(RELATION.copy.y);
    expect(spotPoint("relation", createInitialDataState(), "pcA")?.y).toBeLessThanOrEqual(RELATION.copy.y);
  });

  it("planted omission: a monitor that is too tall for the board is reported", () => {
    const tooTall: Box = { ...TABLE.pc.frame, y: 400, h: 280 };
    expect(inside(stand(tooTall), board)).toBe(false);
  });
});
