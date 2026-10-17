import { createInitialDataState } from "./initial";
import {
  COMPUTER_USER, DATA_LIMITS,
  type AppUser, type Category, type CategoryKind, type ComputerId, type DataAction, type DataOutcome, type DataState, type DataTransition, type FlowFrame, type FlowTone, type Hop, type Mark,
  type StorageMode, type Transaction,
} from "./model";

// Pure scenarios of the data-storage simulator (plan 07 §3). Every action returns the final state AND
// the frames the board plays (packet hops + one Thai caption each), so both are unit-testable.

export const STORAGE_LABEL: Record<StorageMode, string> = { app: "เก็บในแอป", device: "เก็บในเครื่อง", cloud: "เก็บในฐานข้อมูล" };
export const FIELD_LABEL = { name: "ชื่อ", kind: "ประเภท", active: "ใช้อยู่" } as const;
export const KIND_LABEL: Record<CategoryKind, string> = { income: "รายรับ", expense: "รายจ่าย" };
/** Transactions the step-1 button records one after another (the first is the lesson's example). */
export const STORAGE_SAMPLES = ["ค่ากาแฟ 60 บาท", "ค่าข้าวเที่ยง 80 บาท", "ค่ารถไฟฟ้า 45 บาท", "เงินเดือน 25,000 บาท"] as const;

const codePoints = (value: string) => [...value].length;
const hop = (from: string, to: string, label: string, tone: FlowTone = "data"): Hop => ({ from, to, label, tone });

class Flow {
  readonly frames: FlowFrame<DataState>[] = [];
  constructor(public state: DataState) {}
  step(move: Hop | null, caption: string, update?: (state: DataState) => DataState, marks: Mark[] = []): this {
    if (update) this.state = update(this.state);
    this.frames.push({ hop: move, caption, state: this.state, marks });
    return this;
  }
}

function finish(start: DataState, flow: Flow, outcome: DataOutcome, message: string): DataTransition {
  // `failed` keeps its changes (e.g. the error on a computer screen); `rejected` changes nothing.
  const changed = outcome !== "rejected" && JSON.stringify(flow.state) !== JSON.stringify(start);
  return { nextState: changed ? flow.state : start, changed, outcome: outcome === "success" && !changed ? "noop" : outcome, message, frames: flow.frames };
}
const reject = (start: DataState, flow: Flow, message: string) => finish(start, flow, "rejected", message);
const noop = (start: DataState, message: string): DataTransition => ({ nextState: start, changed: false, outcome: "noop", message, frames: [] });

// ---------------------------------------------------------------------------
// Readable names and lines
// ---------------------------------------------------------------------------

/** 25000 → "25,000" (always plain digits and commas, whatever the browser locale). */
export const formatBaht = (amount: number) => String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const categoryName = (state: DataState, id: number) => state.categories.find((item) => item.id === id)?.name ?? `หมวด #${id}`;
export const userName = (state: DataState, id: number) => state.users.find((item) => item.id === id)?.name ?? `ผู้ใช้ #${id}`;
export const categoryLine = (item: Category) => `${item.name} (${KIND_LABEL[item.kind]}${item.active ? "" : " · ไม่ใช้"})`;
/** “+25,000” for income, “-120” for expense (the kind comes from the category the transaction points at). */
export function signedAmount(state: DataState, transaction: Transaction): string {
  const income = state.categories.find((item) => item.id === transaction.categoryId)?.kind === "income";
  return `${income ? "+" : "-"}${formatBaht(transaction.amount)}`;
}
/** One line on a computer screen; `withOwner` adds whose it is (used for rows that leaked to someone else). */
export const transactionLine = (state: DataState, transaction: Transaction, withOwner = false) =>
  `#${transaction.id} ${withOwner ? `${userName(state, transaction.userId)} · ` : ""}${categoryName(state, transaction.categoryId)} ${signedAmount(state, transaction)} บาท`;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export function parseName(raw: string): Parsed<string> {
  const value = raw.trim();
  if (!value) return { ok: false, error: "ชื่อต้องมีอย่างน้อย 1 ตัวอักษร" };
  if (codePoints(value) > DATA_LIMITS.nameCodePoints) return { ok: false, error: `ชื่อยาวได้ไม่เกิน ${DATA_LIMITS.nameCodePoints} ตัวอักษร` };
  return { ok: true, value };
}
/** Column “จำนวนเงิน” holds whole baht only: "ห้าสิบ" or "50บาท" are rejected by the type check. */
export function parseAmount(raw: string): Parsed<number> {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return { ok: false, error: `จำนวนเงินต้องเป็นตัวเลข แต่ได้รับ “${value || "(ว่าง)"}”` };
  const amount = Number(value);
  if (amount < 1) return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  if (amount > DATA_LIMITS.amount) return { ok: false, error: `จำนวนเงินต้องไม่เกิน ${formatBaht(DATA_LIMITS.amount)}` };
  return { ok: true, value: amount };
}
/** Column “ประเภท” holds one of two choices: anything else (e.g. "ออม") is rejected by the type check. */
export function parseKind(raw: string): Parsed<CategoryKind> {
  const value = raw.trim();
  if (value === "รายรับ" || value === "income") return { ok: true, value: "income" };
  if (value === "รายจ่าย" || value === "expense") return { ok: true, value: "expense" };
  return { ok: false, error: `ประเภทต้องเป็น “รายรับ” หรือ “รายจ่าย” แต่ได้รับ “${value || "(ว่าง)"}”` };
}
function parseActive(raw: string): Parsed<boolean> {
  if (raw === "true" || raw === "ใช่") return { ok: true, value: true };
  if (raw === "false" || raw === "ไม่ใช่") return { ok: true, value: false };
  return { ok: false, error: `“ใช้อยู่” เก็บได้แค่ ใช่ / ไม่ใช่ แต่ได้รับ “${raw}”` };
}

// ---------------------------------------------------------------------------
// Step 1 — where data lives
// ---------------------------------------------------------------------------

const withStorage = (state: DataState, patch: Partial<DataState["storage"]>): DataState => ({ ...state, storage: { ...state.storage, ...patch } });
const setFor = <T,>(record: Record<ComputerId, T>, computer: ComputerId, value: T): Record<ComputerId, T> => ({ ...record, [computer]: value });

function storageMode(state: DataState, mode: StorageMode): DataTransition {
  if (state.storage.mode === mode) return noop(state, `ใช้วิธี “${STORAGE_LABEL[mode]}” อยู่แล้ว`);
  const flow = new Flow(state).step(null, `เปลี่ยนวิธีเก็บเป็น “${STORAGE_LABEL[mode]}” และเริ่มสาธิตใหม่`,
    (current) => withStorage(current, { mode, memory: { A: [], B: [] }, device: { A: [], B: [] }, cloud: [], screen: { A: [], B: [] } }));
  return finish(state, flow, "success", `ตอนนี้แอปบนคอม A ${STORAGE_LABEL[mode]}`);
}

function storageRecord(state: DataState, raw: string): DataTransition {
  const name = parseName(raw);
  if (!name.ok) return { ...noop(state, name.error), outcome: "rejected" };
  const item = name.value;
  const { mode } = state.storage;
  const flow = new Flow(state);
  const held = mode === "app" ? state.storage.memory.A : mode === "device" ? state.storage.device.A : state.storage.cloud;
  if (held.length >= DATA_LIMITS.storageItems) return { ...noop(state, `สาธิตได้ไม่เกิน ${DATA_LIMITS.storageItems} รายการ กด “เริ่มใหม่”`), outcome: "rejected" };
  if (mode === "app") {
    flow.step(hop("pcA", "memA", item), `คอม A บันทึก “${item}”: แอปจำไว้ในหน่วยความจำของแอปเท่านั้น`,
      (s) => withStorage(s, { memory: setFor(s.storage.memory, "A", [...s.storage.memory.A, item]), screen: setFor(s.storage.screen, "A", [...s.storage.screen.A, item]) }),
      [{ spot: "memA", tone: "new" }]);
  } else if (mode === "device") {
    flow.step(hop("pcA", "devA", item), `คอม A บันทึก “${item}”: แอปบันทึกลงในคอม A เครื่องนี้`,
      (s) => withStorage(s, { device: setFor(s.storage.device, "A", [...s.storage.device.A, item]), screen: setFor(s.storage.screen, "A", [...s.storage.screen.A, item]) }),
      [{ spot: "devA", tone: "new" }]);
  } else {
    flow.step(hop("pcA", "cloud", item), `คอม A บันทึก “${item}”: ส่งผ่านอินเทอร์เน็ตไปเก็บในฐานข้อมูล`,
      (s) => withStorage(s, { cloud: [...s.storage.cloud, item] }), [{ spot: "cloud", tone: "new" }]);
    flow.step(hop("cloud", "pcA", "✓ บันทึกแล้ว", "ok"), "ฐานข้อมูลตอบว่าบันทึกแล้ว แอปบนคอม A แสดงรายการ",
      (s) => withStorage(s, { screen: setFor(s.storage.screen, "A", [...s.storage.cloud]) }));
  }
  return finish(state, flow, "success", `คอม A บันทึก “${item}” แล้ว (${STORAGE_LABEL[mode]})`);
}

function storageRefresh(state: DataState, computer: ComputerId): DataTransition {
  const { mode } = state.storage;
  const flow = new Flow(state);
  const count = state.storage.memory[computer].length;
  // Every refresh restarts the app first: its screen and the app's own memory are wiped.
  flow.step(count ? hop(`mem${computer}`, `vanish${computer}`, `หายไป ${count} รายการ`, "lost") : null,
    count ? `คอม ${computer} รีเฟรชหน้า: แอปเริ่มใหม่ หน่วยความจำของแอปถูกล้าง รายการ ${count} รายการหายไป ✗` : `คอม ${computer} รีเฟรชหน้า: แอปเริ่มใหม่ หน้าจอว่างก่อน`,
    (s) => withStorage(s, { memory: setFor(s.storage.memory, computer, []), screen: setFor(s.storage.screen, computer, []) }),
    [{ spot: `pc${computer}`, tone: "refresh" }, ...(count ? [{ spot: `mem${computer}`, tone: "removed" as const }] : [])]);
  if (mode === "app") {
    flow.step(null, count ? "แอปเปิดใหม่: ไม่มีที่ไหนเก็บรายการไว้ หน้าจอจึงว่าง ✗" : "แอปเปิดใหม่: ยังไม่มีรายการ");
    return finish(state, flow, count ? "failed" : "success", count ? `รีเฟรชแล้ว รายการที่อยู่แค่ในแอป ${count} รายการหายไป` : "รีเฟรชแล้ว");
  }
  if (mode === "device") {
    const saved = state.storage.device[computer];
    flow.step(hop(`dev${computer}`, `pc${computer}`, `${saved.length} รายการ`, "ok"), `แอปโหลดรายการจากที่เก็บในเครื่องกลับมาได้ ✓`,
      (s) => withStorage(s, { screen: setFor(s.storage.screen, computer, [...saved]) }));
    return finish(state, flow, "success", `รีเฟรชแล้ว รายการยังอยู่ ${saved.length} รายการ (เก็บในเครื่อง)`);
  }
  flow.step(hop(`pc${computer}`, "cloud", "ขอรายการ", "request"), "แอปขอรายการจากฐานข้อมูลใหม่");
  flow.step(hop("cloud", `pc${computer}`, `${state.storage.cloud.length} รายการ`, "ok"), "ได้รายการกลับมาครบ ✓",
    (s) => withStorage(s, { screen: setFor(s.storage.screen, computer, [...s.storage.cloud]) }));
  return finish(state, flow, "success", `รีเฟรชแล้ว รายการยังอยู่ ${state.storage.cloud.length} รายการ (ในฐานข้อมูล)`);
}

function storageOpen(state: DataState, computer: ComputerId): DataTransition {
  const { mode } = state.storage;
  const flow = new Flow(state);
  const other: ComputerId = computer === "A" ? "B" : "A";
  if (mode === "cloud") {
    flow.step(hop(`pc${computer}`, "cloud", "ขอรายการ", "request"), `คอม ${computer} เปิดแอป: ขอรายการจากฐานข้อมูล`);
    flow.step(hop("cloud", `pc${computer}`, `${state.storage.cloud.length} รายการ`, "ok"),
      `คอม ${computer} เห็นรายการชุดเดียวกับคอม ${other} เพราะทุกเครื่องอ่านจากฐานข้อมูลเดียวกัน ✓`,
      (s) => withStorage(s, { screen: setFor(s.storage.screen, computer, [...s.storage.cloud]) }), [{ spot: "cloud", tone: "read" }]);
    return finish(state, flow, "success", `คอม ${computer} เห็นรายการ ${state.storage.cloud.length} รายการจากฐานข้อมูล`);
  }
  const zone = mode === "app" ? `mem${computer}` : `dev${computer}`;
  const own = mode === "app" ? state.storage.memory[computer] : state.storage.device[computer];
  const where = mode === "app" ? "หน่วยความจำแอป" : "ที่เก็บในเครื่อง";
  flow.step(hop(`pc${computer}`, zone, "หารายการ", "request"), `คอม ${computer} เปิดแอป: หาใน${where}ของคอม ${computer} เอง`);
  flow.step(hop(zone, `pc${computer}`, own.length ? `${own.length} รายการ` : "ไม่พบ", own.length ? "ok" : "blocked"),
    `รายการที่บันทึกบนคอม ${other} อยู่ในคอม ${other} เท่านั้น คอม ${computer} จึงมองไม่เห็น ✗`,
    (s) => withStorage(s, { screen: setFor(s.storage.screen, computer, [...own]) }), [{ spot: zone, tone: "blocked" }]);
  return finish(state, flow, "failed", `คอม ${computer} มองไม่เห็นรายการของคอม ${other} (${STORAGE_LABEL[mode]})`);
}

// ---------------------------------------------------------------------------
// Step 2 — a table: Create / Read / Update / Delete on the categories
// ---------------------------------------------------------------------------

const setScreen = (state: DataState, computer: ComputerId, title: string, lines: string[]): DataState =>
  ({ ...state, screens: { ...state.screens, [computer]: { title, lines: lines.slice(0, DATA_LIMITS.screenLines) } } });
const transactionsOf = (state: DataState, categoryId: number) => state.transactions.filter((item) => item.categoryId === categoryId);

function categoryCreate(state: DataState, rawName: string, rawKind: string, active: boolean): DataTransition {
  const flow = new Flow(state);
  const name = parseName(rawName);
  const kind = parseKind(rawKind);
  const label = `${rawName.trim() || "(ไม่มีชื่อ)"} ${rawKind.trim() || "(ว่าง)"}`;
  flow.step(hop("pcA", "gate", label), `คอม A ส่งหมวดใหม่ไปที่ฐานข้อมูล (Create)`);
  if (!name.ok || !kind.ok) {
    const error = !name.ok ? name.error : (kind as { error: string }).error;
    flow.step(hop("gate", "pcA", "✗ ไม่บันทึก", "blocked"), `ด่านตรวจชนิดข้อมูล: ${error} จึงไม่บันทึก ✗`, undefined, [{ spot: "gate", tone: "blocked", note: error }]);
    return reject(state, flow, error);
  }
  if (state.categories.length >= DATA_LIMITS.rows) {
    flow.step(hop("gate", "pcA", "✗ ตารางเต็ม", "blocked"), `สาธิตได้ไม่เกิน ${DATA_LIMITS.rows} แถว ลบบางแถวก่อน`, undefined, [{ spot: "gate", tone: "blocked" }]);
    return reject(state, flow, `ตารางหมวดเต็ม (${DATA_LIMITS.rows} แถว)`);
  }
  const id = state.nextId.categories;
  const item: Category = { id, name: name.value, kind: kind.value, active };
  flow.step(hop("gate", `row:categories:${id}`, item.name, "ok"), `ผ่านด่าน ✓ ชื่อเป็นข้อความ ประเภทเป็นรายรับ/รายจ่าย ฐานข้อมูลเพิ่มแถวใหม่ ID ${id}`,
    (s) => ({ ...s, categories: [...s.categories, item], nextId: { ...s.nextId, categories: id + 1 } }), [{ spot: "gate", tone: "allowed" }, { spot: `row:categories:${id}`, tone: "new" }]);
  flow.step(hop("db", "pcA", "✓ เพิ่มแล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าเพิ่มสำเร็จ",
    (s) => setScreen(s, "A", "เพิ่มหมวดแล้ว", [`ID ${id}: ${categoryLine(item)}`]), [{ spot: `row:categories:${id}`, tone: "new" }]);
  return finish(state, flow, "success", `เพิ่ม “${item.name}” เป็นแถว ID ${id} แล้ว`);
}

function categoryRead(state: DataState, computer: ComputerId): DataTransition {
  const flow = new Flow(state);
  flow.step(hop(`pc${computer}`, "db", "ขอดูหมวด", "request"), `คอม ${computer} ขอดูหมวดทั้งหมด (Read)`);
  flow.step(hop("db", `pc${computer}`, `${state.categories.length} รายการ`), "ฐานข้อมูลส่งสำเนาทุกแถวกลับไป ตารางในฐานข้อมูลไม่เปลี่ยน",
    (s) => setScreen(s, computer, "หมวดทั้งหมด", s.categories.map(categoryLine)), state.categories.map((item) => ({ spot: `row:categories:${item.id}`, tone: "read" as const })));
  return finish(state, flow, "success", `คอม ${computer} ได้หมวด ${state.categories.length} รายการ`);
}

function categoryUpdate(state: DataState, id: number, field: "name" | "kind" | "active", raw: string): DataTransition {
  const item = state.categories.find((entry) => entry.id === id);
  if (!item) return { ...noop(state, `ไม่พบหมวด ID ${id}`), outcome: "rejected" };
  const parsed: Parsed<string | boolean> = field === "name" ? parseName(raw) : field === "kind" ? parseKind(raw) : parseActive(raw);
  const shown = (value: string | boolean) => typeof value === "boolean" ? (value ? "ใช่" : "ไม่ใช่") : value === "income" ? KIND_LABEL.income : value === "expense" ? KIND_LABEL.expense : value;
  const flow = new Flow(state);
  flow.step(hop("pcA", "gate", `${FIELD_LABEL[field]} → ${raw.trim() || "(ว่าง)"}`), `คอม A ขอแก้${FIELD_LABEL[field]}ของ “${item.name}” (Update)`);
  if (!parsed.ok) {
    flow.step(hop("gate", "pcA", "✗ ไม่บันทึก", "blocked"), `ด่านตรวจชนิดข้อมูล: ${parsed.error} ✗`, undefined, [{ spot: "gate", tone: "blocked", note: parsed.error }]);
    return reject(state, flow, parsed.error);
  }
  if (item[field] === parsed.value) return noop(state, `${FIELD_LABEL[field]}เป็น “${shown(parsed.value)}” อยู่แล้ว`);
  const cell = `cell:categories:${id}:${field}`;
  flow.step(hop("gate", cell, shown(parsed.value), "ok"), `ผ่านด่าน ✓ ฐานข้อมูลแก้แค่ช่อง${FIELD_LABEL[field]}ของแถว ID ${id}`,
    (s) => ({ ...s, categories: s.categories.map((entry) => entry.id === id ? { ...entry, [field]: parsed.value } : entry) }),
    [{ spot: "gate", tone: "allowed" }, { spot: cell, tone: "changed" }]);
  flow.step(hop("db", "pcA", "✓ แก้แล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าแก้สำเร็จ",
    (s) => setScreen(s, "A", "แก้หมวดแล้ว", [`ID ${id}: ${categoryLine(s.categories.find((entry) => entry.id === id)!)}`]), [{ spot: cell, tone: "changed" }]);
  return finish(state, flow, "success", `แก้${FIELD_LABEL[field]}ของ ID ${id} เป็น “${shown(parsed.value)}” แล้ว`);
}

function categoryDelete(state: DataState, id: number): DataTransition {
  const item = state.categories.find((entry) => entry.id === id);
  if (!item) return { ...noop(state, `ไม่พบหมวด ID ${id}`), outcome: "rejected" };
  const flow = new Flow(state);
  const row = `row:categories:${id}`;
  flow.step(hop("pcA", row, `ลบ ID ${id}`, "request"), `คอม A ขอลบหมวด “${item.name}” (Delete)`, undefined, [{ spot: row, tone: "removed" }]);
  const using = transactionsOf(state, id).length;
  if (using) {
    flow.step(hop(row, "pcA", "✗ ลบไม่ได้", "blocked"), `ลบไม่ได้: ยังมีรายการ ${using} รายการอ้างถึงหมวดนี้ (เรื่องนี้อยู่ในขั้นเชื่อมตาราง)`, undefined, [{ spot: row, tone: "blocked" }]);
    return reject(state, flow, `ยังมีรายการ ${using} รายการอ้างถึง “${item.name}”`);
  }
  flow.step(null, `ฐานข้อมูลลบแถว ID ${id} ออกทั้งแถว`, (s) => ({ ...s, categories: s.categories.filter((entry) => entry.id !== id) }));
  flow.step(hop("db", "pcA", "✓ ลบแล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าลบสำเร็จ", (s) => setScreen(s, "A", "ลบหมวดแล้ว", [`ลบ “${item.name}” (ID ${id})`]));
  return finish(state, flow, "success", `ลบ “${item.name}” แล้ว`);
}

// ---------------------------------------------------------------------------
// Step 3 — linking tables: copy the category name vs refer by ID
// ---------------------------------------------------------------------------

function categoryRename(state: DataState, id: number, raw: string): DataTransition {
  const category = state.categories.find((entry) => entry.id === id);
  if (!category) return { ...noop(state, `ไม่พบหมวด #${id}`), outcome: "rejected" };
  const name = parseName(raw);
  if (!name.ok) return { ...noop(state, name.error), outcome: "rejected" };
  if (name.value === category.name) return noop(state, `หมวด #${id} ชื่อ “${category.name}” อยู่แล้ว`);
  const rows = transactionsOf(state, id);
  const flow = new Flow(state);
  flow.step(hop("pcA", `link:row:categories:${id}`, name.value), `เปลี่ยนชื่อหมวด #${id} จาก “${category.name}” เป็น “${name.value}” (แก้ที่ตารางหมวดที่เดียว)`,
    (s) => ({ ...s, categories: s.categories.map((entry): Category => entry.id === id ? { ...entry, name: name.value } : entry) }),
    [{ spot: `link:row:categories:${id}`, tone: "changed" }, { spot: `copy:row:categories:${id}`, tone: "changed" }]);
  flow.step(null, `แบบอ้างด้วย ID: รายการ ${rows.length} รายการชี้มาที่หมวด #${id} จึงเห็นชื่อใหม่ทันที ✓`, undefined,
    rows.map((row) => ({ spot: `link:row:transactions:${row.id}`, tone: "allowed" as const })));
  const stale = rows.filter((row) => row.copiedName !== name.value);
  flow.step(null, stale.length ? `แบบก๊อปชื่อ: รายการ ${stale.length} รายการยังเก็บชื่อหมวดเก่า ข้อมูลไม่ตรงกัน ✗` : "แบบก๊อปชื่อ: ไม่มีรายการที่ต้องแก้", undefined,
    stale.map((row) => ({ spot: `copy:cell:transactions:${row.id}:name`, tone: "stale" as const })));
  return finish(state, flow, stale.length ? "failed" : "success", stale.length ? `เปลี่ยนชื่อแล้ว แต่แบบก๊อปชื่อยังมี ${stale.length} รายการที่ชื่อหมวดเก่า` : "เปลี่ยนชื่อแล้ว");
}

function fixCopies(state: DataState, categoryId: number): DataTransition {
  const name = categoryName(state, categoryId);
  const stale = transactionsOf(state, categoryId).filter((row) => row.copiedName !== name);
  if (!stale.length) return noop(state, "ทุกรายการมีชื่อหมวดตรงกันแล้ว");
  const flow = new Flow(state);
  stale.forEach((row, index) => {
    flow.step(hop("pcA", `copy:cell:transactions:${row.id}:name`, name), `แบบก๊อปชื่อต้องตามแก้ทีละแถว: รายการ #${row.id} (${index + 1}/${stale.length})`,
      (s) => ({ ...s, transactions: s.transactions.map((entry) => entry.id === row.id ? { ...entry, copiedName: name } : entry) }),
      [{ spot: `copy:cell:transactions:${row.id}:name`, tone: "changed" }]);
  });
  flow.step(null, `แก้ครบ ${stale.length} แถว แบบอ้างด้วย ID ไม่ต้องทำขั้นนี้เลย`);
  return finish(state, flow, "success", `แก้ชื่อหมวดในรายการแบบก๊อป ${stale.length} แถวแล้ว`);
}

function categoryDeleteLinked(state: DataState, id: number): DataTransition {
  const category = state.categories.find((entry) => entry.id === id);
  if (!category) return { ...noop(state, `ไม่พบหมวด #${id}`), outcome: "rejected" };
  const rows = transactionsOf(state, id);
  const flow = new Flow(state);
  flow.step(hop("pcA", "link:gate", `ลบหมวด #${id}`, "request"), `ขอลบหมวด “${category.name}”`);
  if (rows.length) {
    flow.step(hop("link:gate", "pcA", `✗ ยังมี ${rows.length} รายการอ้างถึง`, "blocked"),
      `ฐานข้อมูลไม่ยอมลบ: รายการ ${rows.length} รายการยังชี้มาที่หมวดนี้ (ลบรายการของหมวดก่อน หรือยกเลิก)`, undefined,
      [{ spot: "link:gate", tone: "blocked" }, ...rows.map((row) => ({ spot: `link:row:transactions:${row.id}`, tone: "blocked" as const }))]);
    return reject(state, flow, `ลบไม่ได้: ยังมีรายการ ${rows.length} รายการของหมวด “${category.name}”`);
  }
  flow.step(hop("link:gate", `link:row:categories:${id}`, "ลบ", "ok"), `ไม่มีรายการอ้างถึง ลบหมวด “${category.name}” ได้ ✓`,
    (s) => ({ ...s, categories: s.categories.filter((entry) => entry.id !== id) }), [{ spot: "link:gate", tone: "allowed" }]);
  return finish(state, flow, "success", `ลบหมวด “${category.name}” แล้ว`);
}

function deleteTransactionsOf(state: DataState, categoryId: number): DataTransition {
  const rows = transactionsOf(state, categoryId);
  if (!rows.length) return noop(state, "หมวดนี้ไม่มีรายการ");
  const flow = new Flow(state);
  flow.step(hop("pcA", `link:row:transactions:${rows[0].id}`, `ลบ ${rows.length} รายการ`, "request"), `ลบรายการทั้งหมดของหมวด “${categoryName(state, categoryId)}” ก่อน`, undefined,
    rows.map((row) => ({ spot: `link:row:transactions:${row.id}`, tone: "removed" as const })));
  flow.step(null, `ลบแล้ว ${rows.length} รายการ ตอนนี้ลบหมวดนี้ได้แล้ว`, (s) => ({ ...s, transactions: s.transactions.filter((row) => row.categoryId !== categoryId) }));
  return finish(state, flow, "success", `ลบรายการของหมวด “${categoryName(state, categoryId)}” ${rows.length} รายการแล้ว`);
}

function transactionCreate(state: DataState, userId: number, categoryId: number, rawAmount: string): DataTransition {
  const user: AppUser | undefined = state.users.find((entry) => entry.id === userId);
  const category = state.categories.find((entry) => entry.id === categoryId);
  if (!user || !category) return { ...noop(state, "เลือกผู้ใช้และหมวดที่มีอยู่"), outcome: "rejected" };
  const amount = parseAmount(rawAmount);
  if (!amount.ok) return { ...noop(state, amount.error), outcome: "rejected" };
  if (!category.active) return { ...noop(state, `หมวด “${category.name}” ไม่ได้ใช้อยู่แล้ว เลือกหมวดอื่น`), outcome: "rejected" };
  if (state.transactions.length >= DATA_LIMITS.rows) return { ...noop(state, `สาธิตได้ไม่เกิน ${DATA_LIMITS.rows} รายการ`), outcome: "rejected" };
  const id = state.nextId.transactions;
  const row: Transaction = { id, userId, categoryId, amount: amount.value, copiedName: category.name };
  const flow = new Flow(state);
  flow.step(hop("pcA", `link:row:transactions:${id}`, `${user.name} · ${category.name} ${formatBaht(amount.value)}`), `รายการ #${id} แบบอ้างด้วย ID เก็บแค่เลขหมวด #${categoryId}`,
    (s) => ({ ...s, transactions: [...s.transactions, row], nextId: { ...s.nextId, transactions: id + 1 } }),
    [{ spot: `link:row:transactions:${id}`, tone: "new" }, { spot: `link:row:categories:${categoryId}`, tone: "read" }]);
  flow.step(null, `แบบก๊อปชื่อ: คัดลอกชื่อหมวด “${category.name}” ไปเก็บไว้ในรายการด้วย`, undefined, [{ spot: `copy:cell:transactions:${id}:name`, tone: "new" }]);
  return finish(state, flow, "success", `บันทึกรายการ #${id} (${category.name} ${formatBaht(amount.value)} บาท) แล้ว`);
}

// ---------------------------------------------------------------------------
// Step 4 — who can see what (Supabase: RLS)
// ---------------------------------------------------------------------------

function accessRules(state: DataState, on: boolean): DataTransition {
  if (state.rulesOn === on) return noop(state, on ? "กฎสิทธิ์เปิดอยู่แล้ว" : "กฎสิทธิ์ปิดอยู่แล้ว");
  const flow = new Flow(state).step(null, on ? "เปิดกฎสิทธิ์: ผู้ใช้แต่ละคนเห็นเฉพาะรายรับรายจ่ายของตัวเอง" : "ปิดกฎสิทธิ์: ทุกคนดึงรายรับรายจ่ายของทุกคนได้ (อันตราย: ข้อมูลการเงินเป็นเรื่องส่วนตัว)",
    (s) => ({ ...s, rulesOn: on }), [{ spot: "gate", tone: on ? "allowed" : "leak" }]);
  return finish(state, flow, "success", on ? "เปิดกฎสิทธิ์แล้ว" : "ปิดกฎสิทธิ์แล้ว ลองให้ผู้ใช้ดูรายการ");
}

function accessRead(state: DataState, computer: ComputerId, table: "transactions" | "categories"): DataTransition {
  const user = COMPUTER_USER[computer];
  const name = userName(state, user);
  const flow = new Flow(state);
  if (table === "categories") {
    flow.step(hop(`pc${computer}`, "gate", "ขอดูหมวด", "request"), `${name} (คอม ${computer}) ขอดูหมวด`);
    flow.step(hop("gate", "table:categories", "สาธารณะ", "ok"), "หมวดเป็นข้อมูลสาธารณะ ทุกคนดูได้ ✓", undefined, [{ spot: "gate", tone: "allowed" }]);
    flow.step(hop("table:categories", `pc${computer}`, `${state.categories.length} รายการ`), "ส่งหมวดกลับไปที่แอป",
      (s) => setScreen(s, computer, "หมวด", s.categories.map(categoryLine)));
    return finish(state, flow, "success", `${name} เห็นหมวด ${state.categories.length} รายการ`);
  }
  const own = state.transactions.filter((row) => row.userId === user);
  const others = state.transactions.filter((row) => row.userId !== user);
  flow.step(hop(`pc${computer}`, "gate", `ขอดูรายการ (ฉันคือ ${name})`, "request"), `${name} (คอม ${computer}) ขอดูรายรับรายจ่ายทั้งหมด`);
  if (state.rulesOn) {
    flow.step(hop("gate", "table:transactions", "ตรวจสิทธิ์", "request"), `ด่านกฎสิทธิ์: อนุญาตเฉพาะแถวที่เป็นของ ${name}`, undefined, [
      { spot: "gate", tone: "allowed" },
      ...own.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "allowed" as const })),
      ...others.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "blocked" as const })),
    ]);
    flow.step(hop("table:transactions", `pc${computer}`, `${own.length} แถวของฉัน`, "ok"),
      `ได้เฉพาะรายการของตัวเอง ${own.length} แถว ของคนอื่น ${others.length} แถวถูกกรองที่ด่าน ✓`,
      (s) => setScreen(s, computer, `รายการของ ${name}`, own.map((row) => transactionLine(s, row))), [
        { spot: "gate", tone: "allowed" },
        ...own.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "allowed" as const })),
        ...others.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "blocked" as const })),
      ]);
    return finish(state, flow, "success", `${name} เห็นเฉพาะรายการของตัวเอง ${own.length} รายการ`);
  }
  flow.step(hop("gate", "table:transactions", "ไม่ตรวจ", "leak"), "กฎสิทธิ์ปิดอยู่: ด่านปล่อยทุกแถวผ่าน", undefined, [
    { spot: "gate", tone: "leak" },
    ...own.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "allowed" as const })),
    ...others.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "leak" as const })),
  ]);
  flow.step(hop("table:transactions", `pc${computer}`, `${state.transactions.length} แถว (ของคนอื่น ${others.length})`, "leak"),
    `${name} เห็นรายรับรายจ่ายของคนอื่น ${others.length} แถว ข้อมูลการเงินรั่ว ✗`,
    (s) => setScreen(s, computer, `รายการที่ ${name} เห็น`, s.transactions.map((row) => `${row.userId === user ? "" : "⚠ "}${transactionLine(s, row, row.userId !== user)}`)),
    [{ spot: "gate", tone: "leak" }, ...others.map((row) => ({ spot: `row:transactions:${row.id}`, tone: "leak" as const }))]);
  return finish(state, flow, "failed", `กฎสิทธิ์ปิด: ${name} เห็นรายรับรายจ่ายของคนอื่น ${others.length} รายการ`);
}

function reset(state: DataState): DataTransition {
  const initial = createInitialDataState();
  if (JSON.stringify(initial) === JSON.stringify(state)) return noop(state, "ข้อมูลเป็นค่าตั้งต้นอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มใหม่: ข้อมูลแอปรายรับรายจ่ายกลับเป็นค่าตั้งต้น", () => initial);
  return finish(state, flow, "success", "เริ่มใหม่แล้ว");
}

/** Applies one action. Never throws for user input; rejected actions leave the state unchanged. */
export function applyDataAction(state: DataState, action: DataAction): DataTransition {
  switch (action.type) {
    case "storage.mode": return storageMode(state, action.mode);
    case "storage.record": return storageRecord(state, action.item);
    case "storage.refresh": return storageRefresh(state, action.computer);
    case "storage.open": return storageOpen(state, action.computer);
    case "category.create": return categoryCreate(state, action.name, action.kind, action.active);
    case "category.read": return categoryRead(state, action.computer);
    case "category.update": return categoryUpdate(state, action.id, action.field, action.value);
    case "category.delete": return categoryDelete(state, action.id);
    case "category.rename": return categoryRename(state, action.id, action.name);
    case "transactions.fixCopies": return fixCopies(state, action.categoryId);
    case "category.deleteLinked": return categoryDeleteLinked(state, action.id);
    case "transactions.deleteOfCategory": return deleteTransactionsOf(state, action.categoryId);
    case "transaction.create": return transactionCreate(state, action.userId, action.categoryId, action.amount);
    case "access.rules": return accessRules(state, action.on);
    case "access.read": return accessRead(state, action.computer, action.table);
    case "reset": return reset(state);
  }
}
