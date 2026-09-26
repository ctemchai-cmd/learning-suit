import { describe, expect, it } from "vitest";
import { createInitialDataState } from "./initial";
import type { DataAction, DataState } from "./model";
import { applyDataAction, parsePrice } from "./reducer";

function play(state: DataState, ...actions: DataAction[]): DataState {
  return actions.reduce((current, action) => applyDataAction(current, action).nextState, state);
}
const hops = (state: DataState, action: DataAction) => applyDataAction(state, action).frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`);

describe("step 1 — where data lives", () => {
  it("in the app: refresh loses the order and phone B never sees it", () => {
    let state = play(createInitialDataState(), { type: "storage.order", item: "ลาเต้" });
    expect(state.storage).toMatchObject({ mode: "app", memory: { A: ["ลาเต้"] }, screen: { A: ["ลาเต้"] } });
    const refresh = applyDataAction(state, { type: "storage.refresh", phone: "A" });
    expect(refresh.frames[0].hop).toMatchObject({ from: "memA", tone: "lost" });
    // The app restarts: the refresh mark spins the icon over a blank screen.
    expect(refresh.frames[0].marks).toContainEqual({ spot: "phoneA", tone: "refresh" });
    state = refresh.nextState;
    expect(state.storage.memory.A).toEqual([]);
    expect(state.storage.screen.A).toEqual([]);
    expect(hops(state, { type: "storage.open", phone: "B" })).toEqual(["phoneB→memB:request", "memB→phoneB:blocked"]);
  });

  it("on the device: survives refresh, still invisible to phone B", () => {
    const saved = play(createInitialDataState(), { type: "storage.mode", mode: "device" }, { type: "storage.order", item: "ชาเขียว" });
    const refresh = applyDataAction(saved, { type: "storage.refresh", phone: "A" });
    // Blank first (refresh), then the saved orders travel back from the device storage.
    expect(refresh.frames.map((frame) => [frame.hop && `${frame.hop.from}→${frame.hop.to}`, frame.state.storage.screen.A])).toEqual([
      [null, []], ["devA→phoneA", ["ชาเขียว"]],
    ]);
    let state = refresh.nextState;
    expect(state.storage.screen.A).toEqual(["ชาเขียว"]);
    state = play(state, { type: "storage.open", phone: "B" });
    expect(state.storage.screen.B).toEqual([]);
  });

  it("in the database: every phone sees the same orders", () => {
    const order = applyDataAction(play(createInitialDataState(), { type: "storage.mode", mode: "cloud" }), { type: "storage.order", item: "ลาเต้" });
    expect(order.frames.map((frame) => frame.hop?.to)).toEqual(["cloud", "phoneA"]);
    const state = play(order.nextState, { type: "storage.refresh", phone: "A" }, { type: "storage.open", phone: "B" });
    expect(state.storage).toMatchObject({ cloud: ["ลาเต้"], screen: { A: ["ลาเต้"], B: ["ลาเต้"] } });
  });

  it("changing the storage mode restarts the demo; the same mode is a noop", () => {
    const state = play(createInitialDataState(), { type: "storage.order", item: "ลาเต้" });
    expect(applyDataAction(state, { type: "storage.mode", mode: "app" })).toMatchObject({ changed: false, outcome: "noop" });
    expect(play(state, { type: "storage.mode", mode: "cloud" }).storage).toMatchObject({ mode: "cloud", memory: { A: [] }, screen: { A: [] } });
  });
});

describe("step 2 — a table with typed columns", () => {
  it("Create passes the type check, adds a row with the next ID and answers the phone", () => {
    const result = applyDataAction(createInitialDataState(), { type: "menu.create", name: " มอคค่า ", price: "65", available: true });
    expect(result).toMatchObject({ changed: true, outcome: "success" });
    expect(result.nextState.menu.at(-1)).toEqual({ id: 5, name: "มอคค่า", price: 65, available: true });
    expect(result.nextState.nextId.menu).toBe(6);
    expect(result.frames.map((frame) => frame.hop?.to)).toEqual(["gate", "row:menu:5", "phoneA"]);
  });

  it("a price that is not a number stops at the gate and changes nothing", () => {
    const start = createInitialDataState();
    const result = applyDataAction(start, { type: "menu.create", name: "มอคค่า", price: "ห้าสิบ", available: true });
    expect(result).toMatchObject({ changed: false, outcome: "rejected", nextState: start });
    expect(result.frames.at(-1)).toMatchObject({ hop: { to: "phoneA", tone: "blocked" }, marks: [{ spot: "gate", tone: "blocked" }] });
    expect(parsePrice("50บาท").ok).toBe(false);
    expect(parsePrice(" 50 ")).toEqual({ ok: true, value: 50 });
  });

  it("Read copies rows to the phone without changing the table; Update changes one cell; Delete removes a row", () => {
    const start = createInitialDataState();
    const read = applyDataAction(start, { type: "menu.read", phone: "A" });
    expect(read.nextState.menu).toBe(start.menu);
    expect(read.nextState.phones.A.lines).toEqual(["ลาเต้ 60 บาท", "อเมริกาโน่ 50 บาท", "ชาเขียว 55 บาท", "โกโก้ 45 บาท (หมด)"]);
    const update = applyDataAction(start, { type: "menu.update", id: 1, field: "price", value: "65" });
    expect(update.nextState.menu[0]).toEqual({ id: 1, name: "ลาเต้", price: 65, available: true });
    expect(update.frames[1].hop?.to).toBe("cell:menu:1:price");
    expect(applyDataAction(start, { type: "menu.update", id: 1, field: "price", value: "60" })).toMatchObject({ outcome: "noop" });
    expect(applyDataAction(start, { type: "menu.update", id: 4, field: "available", value: "true" }).nextState.menu[3].available).toBe(true);
    const removed = applyDataAction(start, { type: "menu.delete", id: 4 });
    expect(removed.nextState.menu.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it("a menu item that orders still use cannot be deleted", () => {
    expect(applyDataAction(createInitialDataState(), { type: "menu.delete", id: 1 })).toMatchObject({ outcome: "rejected", changed: false });
  });
});

describe("step 3 — copy the name vs refer by ID", () => {
  it("renaming updates every linked order at once but leaves the copies stale until fixed row by row", () => {
    const renamed = applyDataAction(createInitialDataState(), { type: "customer.rename", id: 1, name: "สมชาย ใจดี" });
    expect(renamed.nextState.customers[0].name).toBe("สมชาย ใจดี");
    const own = renamed.nextState.orders.filter((order) => order.customerId === 1);
    expect(own.map((order) => order.copiedName)).toEqual(["สมชาย", "สมชาย"]);
    expect(renamed.frames[2].marks).toEqual([
      { spot: "copy:cell:orders:1:name", tone: "stale" },
      { spot: "copy:cell:orders:3:name", tone: "stale" },
    ]);
    const fixed = applyDataAction(renamed.nextState, { type: "orders.fixCopies", customerId: 1 });
    expect(fixed.frames.filter((frame) => frame.hop)).toHaveLength(2);
    expect(fixed.nextState.orders.filter((order) => order.customerId === 1).map((order) => order.copiedName)).toEqual(["สมชาย ใจดี", "สมชาย ใจดี"]);
    expect(applyDataAction(fixed.nextState, { type: "orders.fixCopies", customerId: 1 }).outcome).toBe("noop");
  });

  it("a customer with orders cannot be deleted until their orders are removed", () => {
    const start = createInitialDataState();
    const blocked = applyDataAction(start, { type: "customer.delete", id: 3 });
    expect(blocked).toMatchObject({ outcome: "rejected", changed: false });
    expect(blocked.frames.at(-1)?.marks).toContainEqual({ spot: "link:row:orders:4", tone: "blocked" });
    const state = play(start, { type: "orders.deleteOfCustomer", customerId: 3 }, { type: "customer.delete", id: 3 });
    expect(state.customers.map((customer) => customer.id)).toEqual([1, 2]);
    expect(state.orders.some((order) => order.customerId === 3)).toBe(false);
  });

  it("a new order stores the customer ID and a copy of the current name", () => {
    const state = play(createInitialDataState(), { type: "customer.rename", id: 2, name: "หญิง" }, { type: "order.create", customerId: 2, menuId: 1 });
    expect(state.orders.at(-1)).toEqual({ id: 6, customerId: 2, menuId: 1, qty: 1, copiedName: "หญิง" });
  });
});

describe("step 4 — who can see what", () => {
  it("with the rule on, each customer receives only their own orders", () => {
    const result = applyDataAction(createInitialDataState(), { type: "access.read", phone: "B", table: "orders" });
    expect(result.nextState.phones.B).toEqual({ title: "ออเดอร์ของ สมหญิง", lines: ["#2 สมหญิง · ชาเขียว ×2", "#5 สมหญิง · อเมริกาโน่ ×1"] });
    expect(result.frames[1].marks).toContainEqual({ spot: "row:orders:1", tone: "blocked" });
    expect(result.frames.at(-1)?.hop?.tone).toBe("ok");
  });

  it("with the rule off, other customers' orders leak to the phone", () => {
    const state = play(createInitialDataState(), { type: "access.rules", on: false });
    const result = applyDataAction(state, { type: "access.read", phone: "B", table: "orders" });
    expect(result.frames.at(-1)?.hop?.tone).toBe("leak");
    expect(result.nextState.phones.B.lines.filter((line) => line.startsWith("⚠"))).toHaveLength(3);
  });

  it("the menu is public for everyone", () => {
    const result = applyDataAction(createInitialDataState(), { type: "access.read", phone: "A", table: "menu" });
    expect(result.nextState.phones.A.lines).toHaveLength(4);
  });
});

describe("determinism and reset", () => {
  it("the same state and action always give the same result, and Reset returns the exact initial data", () => {
    const action: DataAction = { type: "menu.create", name: "มอคค่า", price: "65", available: true };
    expect(applyDataAction(createInitialDataState(), action)).toEqual(applyDataAction(createInitialDataState(), action));
    const changed = play(createInitialDataState(), action, { type: "access.rules", on: false });
    expect(applyDataAction(changed, { type: "reset" }).nextState).toEqual(createInitialDataState());
    expect(applyDataAction(createInitialDataState(), { type: "reset" }).outcome).toBe("noop");
  });
});

describe("document schema", () => {
  it("accepts every state the scenarios produce and rejects broken references", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    const node = (state: DataState) => ({ id: "00000000-0000-4000-8000-000000000001", type: "data-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "table", state });
    let state = createInitialDataState();
    const actions: DataAction[] = [
      { type: "storage.mode", mode: "cloud" }, { type: "storage.order", item: "ลาเต้" }, { type: "storage.open", phone: "B" },
      { type: "menu.create", name: "มอคค่า", price: "65", available: true }, { type: "menu.read", phone: "A" },
      { type: "customer.rename", id: 1, name: "ชาย" }, { type: "order.create", customerId: 1, menuId: 5 },
      { type: "access.rules", on: false }, { type: "access.read", phone: "B", table: "orders" },
    ];
    for (const action of actions) {
      state = applyDataAction(state, action).nextState;
      expect(canvasNodeSchema.safeParse(node(state)).success).toBe(true);
    }
    const broken = { ...state, orders: [...state.orders, { id: 99, customerId: 42, menuId: 1, qty: 1, copiedName: "ใคร" }], nextId: { ...state.nextId, orders: 100 } };
    expect(canvasNodeSchema.safeParse(node(broken)).success).toBe(false);
  });
});

describe("outcomes shown in red", () => {
  it("lost orders, an invisible order and a leak are failed; a normal read is success", () => {
    const ordered = play(createInitialDataState(), { type: "storage.order", item: "ลาเต้" });
    expect(applyDataAction(ordered, { type: "storage.refresh", phone: "A" }).outcome).toBe("failed");
    expect(applyDataAction(ordered, { type: "storage.open", phone: "B" }).outcome).toBe("failed");
    const open = play(createInitialDataState(), { type: "access.rules", on: false });
    expect(applyDataAction(open, { type: "access.read", phone: "B", table: "orders" }).outcome).toBe("failed");
    expect(applyDataAction(createInitialDataState(), { type: "access.read", phone: "B", table: "orders" }).outcome).toBe("success");
  });
});
