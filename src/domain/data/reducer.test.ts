import { describe, expect, it } from "vitest";
import { createInitialDataState } from "./initial";
import type { DataAction, DataState } from "./model";
import { applyDataAction, formatBaht, parseAmount, parseKind, signedAmount, STORAGE_SAMPLES, transactionLine } from "./reducer";

function play(state: DataState, ...actions: DataAction[]): DataState {
  return actions.reduce((current, action) => applyDataAction(current, action).nextState, state);
}
const hops = (state: DataState, action: DataAction) => applyDataAction(state, action).frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`);
const COFFEE = "ค่ากาแฟ 60 บาท";

describe("step 1 — where data lives", () => {
  it("in the app: refresh loses the transaction and computer B never sees it", () => {
    let state = play(createInitialDataState(), { type: "storage.record", item: COFFEE });
    expect(state.storage).toMatchObject({ mode: "app", memory: { A: [COFFEE] }, screen: { A: [COFFEE] } });
    const refresh = applyDataAction(state, { type: "storage.refresh", computer: "A" });
    expect(refresh.frames[0].hop).toMatchObject({ from: "memA", tone: "lost" });
    // The app restarts: the refresh mark spins the icon over a blank screen.
    expect(refresh.frames[0].marks).toContainEqual({ spot: "pcA", tone: "refresh" });
    expect(refresh.message).toContain("รายการที่อยู่แค่ในแอป 1 รายการหายไป");
    state = refresh.nextState;
    expect(state.storage.memory.A).toEqual([]);
    expect(state.storage.screen.A).toEqual([]);
    expect(hops(state, { type: "storage.open", computer: "B" })).toEqual(["pcB→memB:request", "memB→pcB:blocked"]);
  });

  it("on the device: survives refresh, still invisible to computer B", () => {
    const saved = play(createInitialDataState(), { type: "storage.mode", mode: "device" }, { type: "storage.record", item: COFFEE });
    const refresh = applyDataAction(saved, { type: "storage.refresh", computer: "A" });
    // Blank first (refresh), then the saved transactions travel back from the device storage.
    expect(refresh.frames.map((frame) => [frame.hop && `${frame.hop.from}→${frame.hop.to}`, frame.state.storage.screen.A])).toEqual([
      [null, []], ["devA→pcA", [COFFEE]],
    ]);
    let state = refresh.nextState;
    expect(state.storage.screen.A).toEqual([COFFEE]);
    state = play(state, { type: "storage.open", computer: "B" });
    expect(state.storage.screen.B).toEqual([]);
  });

  it("in the database: both computers see the same transactions", () => {
    const record = applyDataAction(play(createInitialDataState(), { type: "storage.mode", mode: "cloud" }), { type: "storage.record", item: COFFEE });
    expect(record.frames.map((frame) => frame.hop?.to)).toEqual(["cloud", "pcA"]);
    const state = play(record.nextState, { type: "storage.refresh", computer: "A" }, { type: "storage.open", computer: "B" });
    expect(state.storage).toMatchObject({ cloud: [COFFEE], screen: { A: [COFFEE], B: [COFFEE] } });
  });

  it("changing the storage mode restarts the demo; the same mode is a noop", () => {
    const state = play(createInitialDataState(), { type: "storage.record", item: COFFEE });
    expect(applyDataAction(state, { type: "storage.mode", mode: "app" })).toMatchObject({ changed: false, outcome: "noop" });
    expect(play(state, { type: "storage.mode", mode: "cloud" }).storage).toMatchObject({ mode: "cloud", memory: { A: [] }, screen: { A: [] } });
  });

  it("the sample transactions the panel records are valid storage items (the first is the lesson's example)", () => {
    expect(STORAGE_SAMPLES[0]).toBe(COFFEE);
    for (const item of STORAGE_SAMPLES) expect(applyDataAction(createInitialDataState(), { type: "storage.record", item }).outcome).toBe("success");
  });
});

describe("amounts", () => {
  it("shows baht with thousands separators and signs income / expense by the category kind", () => {
    expect(formatBaht(25000)).toBe("25,000");
    expect(formatBaht(120)).toBe("120");
    expect(formatBaht(1234567)).toBe("1,234,567");
    const state = createInitialDataState();
    expect(signedAmount(state, state.transactions[0])).toBe("+25,000");
    expect(signedAmount(state, state.transactions[1])).toBe("-120");
    expect(transactionLine(state, state.transactions[0])).toBe("#1 เงินเดือน +25,000 บาท");
    expect(transactionLine(state, state.transactions[1], true)).toBe("#2 สมหญิง · อาหาร -120 บาท");
  });

  it("an amount must be a whole positive number", () => {
    expect(parseAmount("50บาท").ok).toBe(false);
    expect(parseAmount("ห้าสิบ").ok).toBe(false);
    expect(parseAmount("0").ok).toBe(false);
    expect(parseAmount(" 50 ")).toEqual({ ok: true, value: 50 });
  });
});

describe("step 2 — a table with typed columns", () => {
  it("Create passes the type check, adds a row with the next ID and answers computer A", () => {
    const result = applyDataAction(createInitialDataState(), { type: "category.create", name: " ของขวัญ ", kind: "รายจ่าย", active: true });
    expect(result).toMatchObject({ changed: true, outcome: "success" });
    expect(result.nextState.categories.at(-1)).toEqual({ id: 5, name: "ของขวัญ", kind: "expense", active: true });
    expect(result.nextState.nextId.categories).toBe(6);
    expect(result.frames.map((frame) => frame.hop?.to)).toEqual(["gate", "row:categories:5", "pcA"]);
  });

  it("a type that is neither income nor expense stops at the gate and changes nothing", () => {
    const start = createInitialDataState();
    const result = applyDataAction(start, { type: "category.create", name: "ออมเงิน", kind: "ออม", active: true });
    expect(result).toMatchObject({ changed: false, outcome: "rejected", nextState: start });
    expect(result.message).toBe("ประเภทต้องเป็น “รายรับ” หรือ “รายจ่าย” แต่ได้รับ “ออม”");
    expect(result.frames.at(-1)).toMatchObject({ hop: { to: "pcA", tone: "blocked" }, marks: [{ spot: "gate", tone: "blocked" }] });
    expect(parseKind("รายรับ")).toEqual({ ok: true, value: "income" });
    expect(parseKind(" income ")).toEqual({ ok: true, value: "income" });
    expect(parseKind("").ok).toBe(false);
  });

  it("Read copies rows to computer A without changing the table; Update changes one cell; Delete removes a row", () => {
    const start = createInitialDataState();
    const read = applyDataAction(start, { type: "category.read", computer: "A" });
    expect(read.nextState.categories).toBe(start.categories);
    expect(read.nextState.screens.A.lines).toEqual(["เงินเดือน (รายรับ)", "อาหาร (รายจ่าย)", "เดินทาง (รายจ่าย)", "ช้อปปิ้ง (รายจ่าย)"]);
    const update = applyDataAction(start, { type: "category.update", id: 4, field: "kind", value: "รายรับ" });
    expect(update.nextState.categories[3]).toEqual({ id: 4, name: "ช้อปปิ้ง", kind: "income", active: true });
    expect(update.frames[1].hop?.to).toBe("cell:categories:4:kind");
    expect(applyDataAction(start, { type: "category.update", id: 1, field: "kind", value: "รายรับ" })).toMatchObject({ outcome: "noop" });
    expect(applyDataAction(start, { type: "category.update", id: 1, field: "kind", value: "ออม" })).toMatchObject({ outcome: "rejected", changed: false });
    const hidden = applyDataAction(start, { type: "category.update", id: 3, field: "active", value: "false" });
    expect(hidden.nextState.categories[2].active).toBe(false);
    expect(applyDataAction(hidden.nextState, { type: "category.read", computer: "B" }).nextState.screens.B.lines[2]).toBe("เดินทาง (รายจ่าย · ไม่ใช้)");
    const added = play(start, { type: "category.create", name: "ของขวัญ", kind: "รายจ่าย", active: false });
    const removed = applyDataAction(added, { type: "category.delete", id: 5 });
    expect(removed.nextState.categories.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });

  it("a category that transactions still use cannot be deleted", () => {
    expect(applyDataAction(createInitialDataState(), { type: "category.delete", id: 2 })).toMatchObject({ outcome: "rejected", changed: false });
  });
});

describe("step 3 — copy the category name vs refer by ID", () => {
  it("renaming updates every linked transaction at once but leaves the copies stale until fixed row by row", () => {
    const renamed = applyDataAction(createInitialDataState(), { type: "category.rename", id: 2, name: "อาหารและเครื่องดื่ม" });
    expect(renamed.nextState.categories[1].name).toBe("อาหารและเครื่องดื่ม");
    const own = renamed.nextState.transactions.filter((row) => row.categoryId === 2);
    expect(own.map((row) => row.copiedName)).toEqual(["อาหาร", "อาหาร"]);
    expect(renamed.frames[2].marks).toEqual([
      { spot: "copy:cell:transactions:2:name", tone: "stale" },
      { spot: "copy:cell:transactions:3:name", tone: "stale" },
    ]);
    const fixed = applyDataAction(renamed.nextState, { type: "transactions.fixCopies", categoryId: 2 });
    expect(fixed.frames.filter((frame) => frame.hop)).toHaveLength(2);
    expect(fixed.nextState.transactions.filter((row) => row.categoryId === 2).map((row) => row.copiedName)).toEqual(["อาหารและเครื่องดื่ม", "อาหารและเครื่องดื่ม"]);
    expect(applyDataAction(fixed.nextState, { type: "transactions.fixCopies", categoryId: 2 }).outcome).toBe("noop");
  });

  it("a category with transactions cannot be deleted until its transactions are removed", () => {
    const start = createInitialDataState();
    const blocked = applyDataAction(start, { type: "category.deleteLinked", id: 4 });
    expect(blocked).toMatchObject({ outcome: "rejected", changed: false });
    expect(blocked.frames.at(-1)?.marks).toContainEqual({ spot: "link:row:transactions:6", tone: "blocked" });
    const state = play(start, { type: "transactions.deleteOfCategory", categoryId: 4 }, { type: "category.deleteLinked", id: 4 });
    expect(state.categories.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(state.transactions.some((row) => row.categoryId === 4)).toBe(false);
  });

  it("a new transaction stores the category ID, a copy of the current name and a positive amount", () => {
    const state = play(createInitialDataState(), { type: "category.rename", id: 2, name: "ข้าวปลา" }, { type: "transaction.create", userId: 1, categoryId: 2, amount: "150" });
    expect(state.transactions.at(-1)).toEqual({ id: 7, userId: 1, categoryId: 2, amount: 150, copiedName: "ข้าวปลา" });
    const start = createInitialDataState();
    expect(applyDataAction(start, { type: "transaction.create", userId: 1, categoryId: 2, amount: "ร้อย" })).toMatchObject({ outcome: "rejected", changed: false });
    expect(applyDataAction(start, { type: "transaction.create", userId: 1, categoryId: 99, amount: "10" })).toMatchObject({ outcome: "rejected", changed: false });
    const retired = play(start, { type: "category.update", id: 2, field: "active", value: "false" });
    expect(applyDataAction(retired, { type: "transaction.create", userId: 1, categoryId: 2, amount: "10" }).message).toBe("หมวด “อาหาร” ไม่ได้ใช้อยู่แล้ว เลือกหมวดอื่น");
  });
});

describe("step 4 — who can see what", () => {
  it("with the rule on, each user receives only their own transactions", () => {
    const result = applyDataAction(createInitialDataState(), { type: "access.read", computer: "B", table: "transactions" });
    expect(result.nextState.screens.B).toEqual({ title: "รายการของ สมหญิง", lines: ["#2 อาหาร -120 บาท", "#5 เงินเดือน +30,000 บาท", "#6 ช้อปปิ้ง -890 บาท"] });
    expect(result.frames[1].marks).toContainEqual({ spot: "row:transactions:1", tone: "blocked" });
    expect(result.frames.at(-1)?.hop?.tone).toBe("ok");
  });

  it("with the rule off, the other user's income and expenses leak to the computer", () => {
    const state = play(createInitialDataState(), { type: "access.rules", on: false });
    const result = applyDataAction(state, { type: "access.read", computer: "B", table: "transactions" });
    expect(result.frames.at(-1)?.hop?.tone).toBe("leak");
    expect(result.message).toBe("กฎสิทธิ์ปิด: สมหญิง เห็นรายรับรายจ่ายของคนอื่น 3 รายการ");
    const leaked = result.nextState.screens.B.lines.filter((line) => line.startsWith("⚠"));
    expect(leaked).toEqual(["⚠ #1 สมชาย · เงินเดือน +25,000 บาท", "⚠ #3 สมชาย · อาหาร -60 บาท", "⚠ #4 สมชาย · เดินทาง -45 บาท"]);
  });

  it("the categories are public for everyone", () => {
    const result = applyDataAction(createInitialDataState(), { type: "access.read", computer: "A", table: "categories" });
    expect(result.nextState.screens.A.lines).toHaveLength(4);
  });
});

describe("determinism and reset", () => {
  it("the same state and action always give the same result, and Reset returns the exact initial data", () => {
    const action: DataAction = { type: "category.create", name: "ของขวัญ", kind: "รายจ่าย", active: true };
    expect(applyDataAction(createInitialDataState(), action)).toEqual(applyDataAction(createInitialDataState(), action));
    const changed = play(createInitialDataState(), action, { type: "access.rules", on: false });
    expect(applyDataAction(changed, { type: "reset" }).nextState).toEqual(createInitialDataState());
    expect(applyDataAction(createInitialDataState(), { type: "reset" }).outcome).toBe("noop");
  });
});

describe("document schema", () => {
  const nodeId = "00000000-0000-4000-8000-000000000001";
  const node = (state: unknown, extra: Record<string, unknown> = {}) => ({ id: nodeId, type: "data-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "table", state, ...extra });

  it("accepts every state the scenarios produce and rejects broken references", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    let state = createInitialDataState();
    const actions: DataAction[] = [
      { type: "storage.mode", mode: "cloud" }, { type: "storage.record", item: COFFEE }, { type: "storage.open", computer: "B" },
      { type: "category.create", name: "ของขวัญ", kind: "รายจ่าย", active: true }, { type: "category.read", computer: "A" },
      { type: "category.rename", id: 1, name: "รายได้ประจำ" }, { type: "transaction.create", userId: 1, categoryId: 5, amount: "300" },
      { type: "access.rules", on: false }, { type: "access.read", computer: "B", table: "transactions" },
    ];
    for (const action of actions) {
      state = applyDataAction(state, action).nextState;
      expect(canvasNodeSchema.safeParse(node(state)).success).toBe(true);
    }
    const broken = { ...state, transactions: [...state.transactions, { id: 99, userId: 1, categoryId: 42, amount: 10, copiedName: "ใคร" }], nextId: { ...state.nextId, transactions: 100 } };
    expect(canvasNodeSchema.safeParse(node(broken)).success).toBe(false);
    const nobody = { ...state, transactions: [...state.transactions, { id: 99, userId: 42, categoryId: 1, amount: 10, copiedName: "เงินเดือน" }], nextId: { ...state.nextId, transactions: 100 } };
    expect(canvasNodeSchema.safeParse(node(nobody)).success).toBe(false);
    expect(canvasNodeSchema.safeParse(node({ ...state, transactions: state.transactions.map((row, index) => (index ? row : { ...row, amount: 0 })) })).success).toBe(false);
  });

  it("an old version-1 coffee-shop state is replaced by the new initial state; the node keeps its view, scale, position and reveal", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    const coffee = {
      version: 1,
      storage: { mode: "cloud", memory: { A: [], B: [] }, device: { A: [], B: [] }, cloud: ["ลาเต้"], screen: { A: ["ลาเต้"], B: [] } },
      menu: [{ id: 1, name: "ลาเต้", price: 60, available: true }],
      customers: [{ id: 1, name: "สมชาย" }],
      orders: [{ id: 1, customerId: 1, menuId: 1, qty: 1, copiedName: "สมชาย" }],
      nextId: { menu: 2, customers: 2, orders: 2 },
      rulesOn: false,
      phones: { A: { title: "เมนูทั้งหมด", lines: ["ลาเต้ 60 บาท"] }, B: { title: "", lines: [] } },
    };
    const parsed = canvasNodeSchema.safeParse(node(coffee, { view: "access", scale: 1.5, x: 120, y: 80, reveal: 3 }));
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.type !== "data-simulator") throw new Error("expected a data simulator node");
    expect(parsed.data.state).toEqual(createInitialDataState());
    expect(parsed.data).toMatchObject({ view: "access", scale: 1.5, x: 120, y: 80, reveal: 3 });
    // Only version 1 is migrated: other versions and half-converted states are still rejected.
    expect(canvasNodeSchema.safeParse(node({ ...createInitialDataState(), version: 3 })).success).toBe(false);
    expect(canvasNodeSchema.safeParse(node({ ...createInitialDataState(), version: 2, menu: [] })).success).toBe(false);
  });
});

describe("outcomes shown in red", () => {
  it("lost transactions, an invisible transaction and a leak are failed; a normal read is success", () => {
    const recorded = play(createInitialDataState(), { type: "storage.record", item: COFFEE });
    expect(applyDataAction(recorded, { type: "storage.refresh", computer: "A" }).outcome).toBe("failed");
    expect(applyDataAction(recorded, { type: "storage.open", computer: "B" }).outcome).toBe("failed");
    const open = play(createInitialDataState(), { type: "access.rules", on: false });
    expect(applyDataAction(open, { type: "access.read", computer: "B", table: "transactions" }).outcome).toBe("failed");
    expect(applyDataAction(createInitialDataState(), { type: "access.read", computer: "B", table: "transactions" }).outcome).toBe("success");
  });
});
