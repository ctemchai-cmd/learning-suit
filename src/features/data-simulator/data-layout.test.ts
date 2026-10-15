import { describe, expect, it } from "vitest";
import type { FlowFrame } from "../../domain/data/model";
import { createInitialDataState } from "../../domain/data/initial";
import type { DataAction, DataState, DataView } from "../../domain/data/model";
import { applyDataAction } from "../../domain/data/reducer";
import { revealForParts } from "../../domain/document/reveal";
import { spotsOfFrames, walkFrames } from "../flow/frame-walk";
import { dataPartOfSpot, dataParts, dataPartsOfFrames, pipesOf, spotPoint } from "./data-layout";

// Actions the panel offers in each lesson step. The places frames name come from running the reducer, not from the layout.
const VIEWS: Record<DataView, DataAction[]> = {
  where: [{ type: "storage.mode", mode: "app" }, { type: "storage.mode", mode: "device" }, { type: "storage.mode", mode: "cloud" }, { type: "storage.order", item: "ลาเต้" },
    { type: "storage.refresh", phone: "A" }, { type: "storage.open", phone: "B" }, { type: "storage.open", phone: "A" }],
  table: [{ type: "menu.create", name: "ชาเขียว", price: "55", available: true }, { type: "menu.create", name: "x", price: "abc", available: true }, { type: "menu.read", phone: "A" },
    { type: "menu.update", id: 1, field: "price", value: "60" }, { type: "menu.update", id: 1, field: "price", value: "abc" }, { type: "menu.update", id: 2, field: "available", value: "false" }, { type: "menu.delete", id: 1 }],
  relation: [{ type: "customer.rename", id: 1, name: "สมชาย ใจดี" }, { type: "orders.fixCopies", customerId: 1 }, { type: "order.create", customerId: 1, menuId: 1 }, { type: "customer.delete", id: 1 }, { type: "orders.deleteOfCustomer", customerId: 1 }],
  access: [{ type: "access.rules", on: false }, { type: "access.rules", on: true }, { type: "access.read", phone: "A", table: "orders" }, { type: "access.read", phone: "B", table: "orders" },
    { type: "access.read", phone: "A", table: "menu" }, { type: "access.read", phone: "B", table: "menu" }],
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
    expect(dataParts("where").map((part) => part.id)).toEqual(["phoneA", "memA", "devA", "cloud", "phoneB"]);
    expect(dataParts("access").map((part) => part.id)).toEqual(["phoneA", "phoneB", "gate", "db", "menu", "orders"]);
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
      expect(lonely.every((id) => (view === "table" && id === "menu") || (view === "relation" && id === "link"))).toBe(true);
    });
  }

  it("planted omission: a mapping that forgets the gate is reported", () => {
    const forgetful = (view: DataView, spot: string) => (spot === "gate" ? null : dataPartOfSpot(view, spot));
    expect(unmapped("access", framesOf("access"), forgetful)).toEqual(["gate"]);
  });

  it("actions need their parts (counts follow part order; the gate / cloud a packet passes comes along)", () => {
    const fresh = createInitialDataState();
    const need = (view: DataView, action: DataAction, state = fresh) => dataPartsOfFrames(view, applyDataAction(state, action).frames).sort();
    expect(need("where", { type: "storage.order", item: "ลาเต้" })).toEqual(expect.arrayContaining(["phoneA", "memA"]));
    expect(revealForParts(dataParts("where"), 0, need("where", { type: "storage.mode", mode: "cloud" }))).toBeGreaterThanOrEqual(0);
    const cloud = applyDataAction(fresh, { type: "storage.mode", mode: "cloud" }).nextState;
    expect(need("where", { type: "storage.order", item: "ลาเต้" }, cloud)).toEqual(expect.arrayContaining(["phoneA", "cloud"]));
    expect(need("table", { type: "menu.read", phone: "A" })).toEqual(expect.arrayContaining(["phone", "gate", "db"]));
    expect(revealForParts(dataParts("table"), 0, need("table", { type: "menu.read", phone: "A" }))).toBe(4);
    expect(need("access", { type: "access.read", phone: "B", table: "orders" })).toEqual(expect.arrayContaining(["phoneB", "gate", "orders"]));
    expect(revealForParts(dataParts("access"), 0, need("access", { type: "access.read", phone: "B", table: "orders" }))).toBe(6);
  });
});
