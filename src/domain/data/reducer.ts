import { createInitialDataState } from "./initial";
import {
  DATA_LIMITS, PHONE_USER,
  type Customer, type DataAction, type DataOutcome, type DataState, type DataTransition, type FlowFrame, type FlowTone, type Hop, type Mark,
  type MenuItem, type Order, type PhoneId, type StorageMode,
} from "./model";

// Pure scenarios of the data-storage simulator (plan 07 §3). Every action returns the final state AND
// the frames the board plays (packet hops + one Thai caption each), so both are unit-testable.

export const STORAGE_LABEL: Record<StorageMode, string> = { app: "เก็บในแอป", device: "เก็บในเครื่อง", cloud: "เก็บในฐานข้อมูล" };
export const FIELD_LABEL = { name: "ชื่อ", price: "ราคา", available: "มีขาย" } as const;

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
  // `failed` keeps its changes (e.g. the error on a phone screen); `rejected` changes nothing.
  const changed = outcome !== "rejected" && JSON.stringify(flow.state) !== JSON.stringify(start);
  return { nextState: changed ? flow.state : start, changed, outcome: outcome === "success" && !changed ? "noop" : outcome, message, frames: flow.frames };
}
const reject = (start: DataState, flow: Flow, message: string) => finish(start, flow, "rejected", message);
const noop = (start: DataState, message: string): DataTransition => ({ nextState: start, changed: false, outcome: "noop", message, frames: [] });

// ---------------------------------------------------------------------------
// Readable names and lines
// ---------------------------------------------------------------------------

export const menuName = (state: DataState, id: number) => state.menu.find((item) => item.id === id)?.name ?? `เมนู #${id}`;
export const customerName = (state: DataState, id: number) => state.customers.find((item) => item.id === id)?.name ?? `ลูกค้า #${id}`;
export const menuLine = (item: MenuItem) => `${item.name} ${item.price} บาท${item.available ? "" : " (หมด)"}`;
export const orderLine = (state: DataState, order: Order) => `#${order.id} ${customerName(state, order.customerId)} · ${menuName(state, order.menuId)} ×${order.qty}`;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export function parseName(raw: string): Parsed<string> {
  const value = raw.trim();
  if (!value) return { ok: false, error: "ชื่อต้องมีอย่างน้อย 1 ตัวอักษร" };
  if (codePoints(value) > DATA_LIMITS.nameCodePoints) return { ok: false, error: `ชื่อยาวได้ไม่เกิน ${DATA_LIMITS.nameCodePoints} ตัวอักษร` };
  return { ok: true, value };
}
/** Column “ราคา” holds numbers only: "ห้าสิบ" or "50บาท" are rejected by the type check. */
export function parsePrice(raw: string): Parsed<number> {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return { ok: false, error: `ราคาต้องเป็นตัวเลข แต่ได้รับ “${value || "(ว่าง)"}”` };
  const price = Number(value);
  if (price > DATA_LIMITS.price) return { ok: false, error: `ราคาต้องไม่เกิน ${DATA_LIMITS.price.toLocaleString("th-TH")}` };
  return { ok: true, value: price };
}
function parseAvailable(raw: string): Parsed<boolean> {
  if (raw === "true" || raw === "ใช่") return { ok: true, value: true };
  if (raw === "false" || raw === "ไม่ใช่") return { ok: true, value: false };
  return { ok: false, error: `“มีขาย” เก็บได้แค่ ใช่ / ไม่ใช่ แต่ได้รับ “${raw}”` };
}

// ---------------------------------------------------------------------------
// Step 1 — where data lives
// ---------------------------------------------------------------------------

const withStorage = (state: DataState, patch: Partial<DataState["storage"]>): DataState => ({ ...state, storage: { ...state.storage, ...patch } });
const setFor = <T,>(record: Record<PhoneId, T>, phone: PhoneId, value: T): Record<PhoneId, T> => ({ ...record, [phone]: value });

function storageMode(state: DataState, mode: StorageMode): DataTransition {
  if (state.storage.mode === mode) return noop(state, `ใช้วิธี “${STORAGE_LABEL[mode]}” อยู่แล้ว`);
  const flow = new Flow(state).step(null, `เปลี่ยนวิธีเก็บเป็น “${STORAGE_LABEL[mode]}” และเริ่มสาธิตใหม่`,
    (current) => withStorage(current, { mode, memory: { A: [], B: [] }, device: { A: [], B: [] }, cloud: [], screen: { A: [], B: [] } }));
  return finish(state, flow, "success", `ตอนนี้แอปของ A ${STORAGE_LABEL[mode]}`);
}

function storageOrder(state: DataState, raw: string): DataTransition {
  const name = parseName(raw);
  if (!name.ok) return { ...noop(state, name.error), outcome: "rejected" };
  const item = name.value;
  const { mode } = state.storage;
  const flow = new Flow(state);
  const held = mode === "app" ? state.storage.memory.A : mode === "device" ? state.storage.device.A : state.storage.cloud;
  if (held.length >= DATA_LIMITS.storageItems) return { ...noop(state, `สาธิตได้ไม่เกิน ${DATA_LIMITS.storageItems} ออเดอร์ กด “เริ่มใหม่”`), outcome: "rejected" };
  if (mode === "app") {
    flow.step(hop("phoneA", "memA", item), `A สั่ง${item}: แอปจำไว้ในหน่วยความจำของแอปเท่านั้น`,
      (s) => withStorage(s, { memory: setFor(s.storage.memory, "A", [...s.storage.memory.A, item]), screen: setFor(s.storage.screen, "A", [...s.storage.screen.A, item]) }),
      [{ spot: "memA", tone: "new" }]);
  } else if (mode === "device") {
    flow.step(hop("phoneA", "devA", item), `A สั่ง${item}: แอปบันทึกลงในเครื่อง A`,
      (s) => withStorage(s, { device: setFor(s.storage.device, "A", [...s.storage.device.A, item]), screen: setFor(s.storage.screen, "A", [...s.storage.screen.A, item]) }),
      [{ spot: "devA", tone: "new" }]);
  } else {
    flow.step(hop("phoneA", "cloud", item), `A สั่ง${item}: ส่งผ่านอินเทอร์เน็ตไปเก็บในฐานข้อมูล`,
      (s) => withStorage(s, { cloud: [...s.storage.cloud, item] }), [{ spot: "cloud", tone: "new" }]);
    flow.step(hop("cloud", "phoneA", "✓ บันทึกแล้ว", "ok"), "ฐานข้อมูลตอบว่าบันทึกแล้ว แอปของ A แสดงออเดอร์",
      (s) => withStorage(s, { screen: setFor(s.storage.screen, "A", [...s.storage.cloud]) }));
  }
  return finish(state, flow, "success", `A สั่ง${item}แล้ว (${STORAGE_LABEL[mode]})`);
}

function storageRefresh(state: DataState, phone: PhoneId): DataTransition {
  const { mode } = state.storage;
  const flow = new Flow(state);
  const count = state.storage.memory[phone].length;
  // Every refresh restarts the app first: its screen and the app's own memory are wiped.
  flow.step(count ? hop(`mem${phone}`, `vanish${phone}`, `หายไป ${count} รายการ`, "lost") : null,
    count ? `${phone} รีเฟรชหน้า: แอปเริ่มใหม่ หน่วยความจำของแอปถูกล้าง ออเดอร์ ${count} รายการหายไป ✗` : `${phone} รีเฟรชหน้า: แอปเริ่มใหม่ หน้าจอว่างก่อน`,
    (s) => withStorage(s, { memory: setFor(s.storage.memory, phone, []), screen: setFor(s.storage.screen, phone, []) }),
    [{ spot: `phone${phone}`, tone: "refresh" }, ...(count ? [{ spot: `mem${phone}`, tone: "removed" as const }] : [])]);
  if (mode === "app") {
    flow.step(null, count ? "แอปเปิดใหม่: ไม่มีที่ไหนเก็บออเดอร์ไว้ หน้าจอจึงว่าง ✗" : "แอปเปิดใหม่: ยังไม่มีออเดอร์");
    return finish(state, flow, count ? "failed" : "success", count ? `รีเฟรชแล้ว ออเดอร์ที่อยู่แค่ในแอป ${count} รายการหายไป` : "รีเฟรชแล้ว");
  }
  if (mode === "device") {
    const saved = state.storage.device[phone];
    flow.step(hop(`dev${phone}`, `phone${phone}`, `${saved.length} รายการ`, "ok"), `แอปโหลดออเดอร์จากที่เก็บในเครื่องกลับมาได้ ✓`,
      (s) => withStorage(s, { screen: setFor(s.storage.screen, phone, [...saved]) }));
    return finish(state, flow, "success", `รีเฟรชแล้ว ออเดอร์ยังอยู่ ${saved.length} รายการ (เก็บในเครื่อง)`);
  }
  flow.step(hop(`phone${phone}`, "cloud", "ขอออเดอร์", "request"), "แอปขอออเดอร์จากฐานข้อมูลใหม่");
  flow.step(hop("cloud", `phone${phone}`, `${state.storage.cloud.length} รายการ`, "ok"), "ได้ออเดอร์กลับมาครบ ✓",
    (s) => withStorage(s, { screen: setFor(s.storage.screen, phone, [...s.storage.cloud]) }));
  return finish(state, flow, "success", `รีเฟรชแล้ว ออเดอร์ยังอยู่ ${state.storage.cloud.length} รายการ (ในฐานข้อมูล)`);
}

function storageOpen(state: DataState, phone: PhoneId): DataTransition {
  const { mode } = state.storage;
  const flow = new Flow(state);
  const other: PhoneId = phone === "A" ? "B" : "A";
  if (mode === "cloud") {
    flow.step(hop(`phone${phone}`, "cloud", "ขอออเดอร์", "request"), `${phone} เปิดแอป: ขอออเดอร์จากฐานข้อมูล`);
    flow.step(hop("cloud", `phone${phone}`, `${state.storage.cloud.length} รายการ`, "ok"),
      `${phone} เห็นออเดอร์ชุดเดียวกับ ${other} เพราะทุกเครื่องอ่านจากฐานข้อมูลเดียวกัน ✓`,
      (s) => withStorage(s, { screen: setFor(s.storage.screen, phone, [...s.storage.cloud]) }), [{ spot: "cloud", tone: "read" }]);
    return finish(state, flow, "success", `${phone} เห็นออเดอร์ ${state.storage.cloud.length} รายการจากฐานข้อมูล`);
  }
  const zone = mode === "app" ? `mem${phone}` : `dev${phone}`;
  const own = mode === "app" ? state.storage.memory[phone] : state.storage.device[phone];
  const where = mode === "app" ? "หน่วยความจำแอป" : "ที่เก็บในเครื่อง";
  flow.step(hop(`phone${phone}`, zone, "หาออเดอร์", "request"), `${phone} เปิดแอป: หาใน${where}ของเครื่อง ${phone} เอง`);
  flow.step(hop(zone, `phone${phone}`, own.length ? `${own.length} รายการ` : "ไม่พบ", own.length ? "ok" : "blocked"),
    `ออเดอร์ของ ${other} อยู่ในเครื่อง ${other} เท่านั้น ${phone} จึงมองไม่เห็น ✗`,
    (s) => withStorage(s, { screen: setFor(s.storage.screen, phone, [...own]) }), [{ spot: zone, tone: "blocked" }]);
  return finish(state, flow, "failed", `${phone} มองไม่เห็นออเดอร์ของ ${other} (${STORAGE_LABEL[mode]})`);
}

// ---------------------------------------------------------------------------
// Step 2 — a table: Create / Read / Update / Delete on the menu
// ---------------------------------------------------------------------------

const setPhone = (state: DataState, phone: PhoneId, title: string, lines: string[]): DataState =>
  ({ ...state, phones: { ...state.phones, [phone]: { title, lines: lines.slice(0, DATA_LIMITS.screenLines) } } });

function menuCreate(state: DataState, rawName: string, rawPrice: string, available: boolean): DataTransition {
  const flow = new Flow(state);
  const name = parseName(rawName);
  const price = parsePrice(rawPrice);
  const label = `${rawName.trim() || "(ไม่มีชื่อ)"} ${rawPrice.trim() || "(ว่าง)"}`;
  flow.step(hop("phoneA", "gate", label), `A ส่งเมนูใหม่ไปที่ฐานข้อมูล (Create)`);
  if (!name.ok || !price.ok) {
    const error = !name.ok ? name.error : (price as { error: string }).error;
    flow.step(hop("gate", "phoneA", "✗ ไม่บันทึก", "blocked"), `ด่านตรวจชนิดข้อมูล: ${error} จึงไม่บันทึก ✗`, undefined, [{ spot: "gate", tone: "blocked", note: error }]);
    return reject(state, flow, error);
  }
  if (state.menu.length >= DATA_LIMITS.rows) {
    flow.step(hop("gate", "phoneA", "✗ ตารางเต็ม", "blocked"), `สาธิตได้ไม่เกิน ${DATA_LIMITS.rows} แถว ลบบางแถวก่อน`, undefined, [{ spot: "gate", tone: "blocked" }]);
    return reject(state, flow, `ตารางเมนูเต็ม (${DATA_LIMITS.rows} แถว)`);
  }
  const id = state.nextId.menu;
  const item: MenuItem = { id, name: name.value, price: price.value, available };
  flow.step(hop("gate", `row:menu:${id}`, item.name, "ok"), `ผ่านด่าน ✓ ชื่อเป็นข้อความ ราคาเป็นตัวเลข ฐานข้อมูลเพิ่มแถวใหม่ ID ${id}`,
    (s) => ({ ...s, menu: [...s.menu, item], nextId: { ...s.nextId, menu: id + 1 } }), [{ spot: "gate", tone: "allowed" }, { spot: `row:menu:${id}`, tone: "new" }]);
  flow.step(hop("db", "phoneA", "✓ เพิ่มแล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าเพิ่มสำเร็จ",
    (s) => setPhone(s, "A", "เพิ่มเมนูแล้ว", [`ID ${id}: ${menuLine(item)}`]), [{ spot: `row:menu:${id}`, tone: "new" }]);
  return finish(state, flow, "success", `เพิ่ม “${item.name}” เป็นแถว ID ${id} แล้ว`);
}

function menuRead(state: DataState, phone: PhoneId): DataTransition {
  const flow = new Flow(state);
  flow.step(hop(`phone${phone}`, "db", "ขอดูเมนู", "request"), `${phone} ขอดูเมนูทั้งหมด (Read)`);
  flow.step(hop("db", `phone${phone}`, `${state.menu.length} รายการ`), "ฐานข้อมูลส่งสำเนาทุกแถวกลับไป ตารางในฐานข้อมูลไม่เปลี่ยน",
    (s) => setPhone(s, phone, "เมนูทั้งหมด", s.menu.map(menuLine)), state.menu.map((item) => ({ spot: `row:menu:${item.id}`, tone: "read" as const })));
  return finish(state, flow, "success", `${phone} ได้เมนู ${state.menu.length} รายการ`);
}

function menuUpdate(state: DataState, id: number, field: "name" | "price" | "available", raw: string): DataTransition {
  const item = state.menu.find((entry) => entry.id === id);
  if (!item) return { ...noop(state, `ไม่พบเมนู ID ${id}`), outcome: "rejected" };
  const parsed: Parsed<string | number | boolean> = field === "name" ? parseName(raw) : field === "price" ? parsePrice(raw) : parseAvailable(raw);
  const shown = (value: string | number | boolean) => typeof value === "boolean" ? (value ? "ใช่" : "ไม่ใช่") : String(value);
  const flow = new Flow(state);
  flow.step(hop("phoneA", "gate", `${FIELD_LABEL[field]} → ${raw.trim() || "(ว่าง)"}`), `A ขอแก้${FIELD_LABEL[field]}ของ “${item.name}” (Update)`);
  if (!parsed.ok) {
    flow.step(hop("gate", "phoneA", "✗ ไม่บันทึก", "blocked"), `ด่านตรวจชนิดข้อมูล: ${parsed.error} ✗`, undefined, [{ spot: "gate", tone: "blocked", note: parsed.error }]);
    return reject(state, flow, parsed.error);
  }
  if (item[field] === parsed.value) return noop(state, `${FIELD_LABEL[field]}เป็น “${shown(parsed.value)}” อยู่แล้ว`);
  const cell = `cell:menu:${id}:${field}`;
  flow.step(hop("gate", cell, shown(parsed.value), "ok"), `ผ่านด่าน ✓ ฐานข้อมูลแก้แค่ช่อง${FIELD_LABEL[field]}ของแถว ID ${id}`,
    (s) => ({ ...s, menu: s.menu.map((entry) => entry.id === id ? { ...entry, [field]: parsed.value } : entry) }),
    [{ spot: "gate", tone: "allowed" }, { spot: cell, tone: "changed" }]);
  flow.step(hop("db", "phoneA", "✓ แก้แล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าแก้สำเร็จ",
    (s) => setPhone(s, "A", "แก้เมนูแล้ว", [`ID ${id}: ${menuLine(s.menu.find((entry) => entry.id === id)!)}`]), [{ spot: cell, tone: "changed" }]);
  return finish(state, flow, "success", `แก้${FIELD_LABEL[field]}ของ ID ${id} เป็น “${shown(parsed.value)}” แล้ว`);
}

function menuDelete(state: DataState, id: number): DataTransition {
  const item = state.menu.find((entry) => entry.id === id);
  if (!item) return { ...noop(state, `ไม่พบเมนู ID ${id}`), outcome: "rejected" };
  const flow = new Flow(state);
  const row = `row:menu:${id}`;
  flow.step(hop("phoneA", row, `ลบ ID ${id}`, "request"), `A ขอลบเมนู “${item.name}” (Delete)`, undefined, [{ spot: row, tone: "removed" }]);
  const using = state.orders.filter((order) => order.menuId === id).length;
  if (using) {
    flow.step(hop(row, "phoneA", "✗ ลบไม่ได้", "blocked"), `ลบไม่ได้: ยังมีออเดอร์ ${using} รายการอ้างถึงเมนูนี้ (เรื่องนี้อยู่ในขั้นเชื่อมตาราง)`, undefined, [{ spot: row, tone: "blocked" }]);
    return reject(state, flow, `ยังมีออเดอร์ ${using} รายการอ้างถึง “${item.name}”`);
  }
  flow.step(null, `ฐานข้อมูลลบแถว ID ${id} ออกทั้งแถว`, (s) => ({ ...s, menu: s.menu.filter((entry) => entry.id !== id) }));
  flow.step(hop("db", "phoneA", "✓ ลบแล้ว", "ok"), "ฐานข้อมูลตอบแอปว่าลบสำเร็จ", (s) => setPhone(s, "A", "ลบเมนูแล้ว", [`ลบ “${item.name}” (ID ${id})`]));
  return finish(state, flow, "success", `ลบ “${item.name}” แล้ว`);
}

// ---------------------------------------------------------------------------
// Step 3 — linking tables: copy the name vs refer by ID
// ---------------------------------------------------------------------------

const ordersOf = (state: DataState, customerId: number) => state.orders.filter((order) => order.customerId === customerId);

function customerRename(state: DataState, id: number, raw: string): DataTransition {
  const customer = state.customers.find((entry) => entry.id === id);
  if (!customer) return { ...noop(state, `ไม่พบลูกค้า #${id}`), outcome: "rejected" };
  const name = parseName(raw);
  if (!name.ok) return { ...noop(state, name.error), outcome: "rejected" };
  if (name.value === customer.name) return noop(state, `ลูกค้า #${id} ชื่อ “${customer.name}” อยู่แล้ว`);
  const orders = ordersOf(state, id);
  const flow = new Flow(state);
  flow.step(hop("phoneA", `link:row:customers:${id}`, name.value), `เปลี่ยนชื่อลูกค้า #${id} จาก “${customer.name}” เป็น “${name.value}” (แก้ที่ตารางลูกค้าที่เดียว)`,
    (s) => ({ ...s, customers: s.customers.map((entry): Customer => entry.id === id ? { ...entry, name: name.value } : entry) }),
    [{ spot: `link:row:customers:${id}`, tone: "changed" }, { spot: `copy:row:customers:${id}`, tone: "changed" }]);
  flow.step(null, `แบบอ้างด้วย ID: ออเดอร์ ${orders.length} รายการชี้มาที่ลูกค้า #${id} จึงเห็นชื่อใหม่ทันที ✓`, undefined,
    orders.map((order) => ({ spot: `link:row:orders:${order.id}`, tone: "allowed" as const })));
  const stale = orders.filter((order) => order.copiedName !== name.value);
  flow.step(null, stale.length ? `แบบก๊อปชื่อ: ออเดอร์ ${stale.length} รายการยังเก็บชื่อเก่า ข้อมูลไม่ตรงกัน ✗` : "แบบก๊อปชื่อ: ไม่มีออเดอร์ที่ต้องแก้", undefined,
    stale.map((order) => ({ spot: `copy:cell:orders:${order.id}:name`, tone: "stale" as const })));
  return finish(state, flow, stale.length ? "failed" : "success", stale.length ? `เปลี่ยนชื่อแล้ว แต่แบบก๊อปชื่อยังมี ${stale.length} ออเดอร์ที่ชื่อเก่า` : "เปลี่ยนชื่อแล้ว");
}

function fixCopies(state: DataState, customerId: number): DataTransition {
  const name = customerName(state, customerId);
  const stale = ordersOf(state, customerId).filter((order) => order.copiedName !== name);
  if (!stale.length) return noop(state, "ทุกออเดอร์มีชื่อตรงกับลูกค้าแล้ว");
  const flow = new Flow(state);
  stale.forEach((order, index) => {
    flow.step(hop("phoneA", `copy:cell:orders:${order.id}:name`, name), `แบบก๊อปชื่อต้องตามแก้ทีละแถว: ออเดอร์ #${order.id} (${index + 1}/${stale.length})`,
      (s) => ({ ...s, orders: s.orders.map((entry) => entry.id === order.id ? { ...entry, copiedName: name } : entry) }),
      [{ spot: `copy:cell:orders:${order.id}:name`, tone: "changed" }]);
  });
  flow.step(null, `แก้ครบ ${stale.length} แถว แบบอ้างด้วย ID ไม่ต้องทำขั้นนี้เลย`);
  return finish(state, flow, "success", `แก้ชื่อในออเดอร์แบบก๊อป ${stale.length} แถวแล้ว`);
}

function customerDelete(state: DataState, id: number): DataTransition {
  const customer = state.customers.find((entry) => entry.id === id);
  if (!customer) return { ...noop(state, `ไม่พบลูกค้า #${id}`), outcome: "rejected" };
  const orders = ordersOf(state, id);
  const flow = new Flow(state);
  flow.step(hop("phoneA", "link:gate", `ลบลูกค้า #${id}`, "request"), `ขอลบลูกค้า “${customer.name}”`);
  if (orders.length) {
    flow.step(hop("link:gate", "phoneA", `✗ ยังมี ${orders.length} ออเดอร์อ้างถึง`, "blocked"),
      `ฐานข้อมูลไม่ยอมลบ: ออเดอร์ ${orders.length} รายการยังชี้มาที่ลูกค้าคนนี้ (ลบออเดอร์ของเขาก่อน หรือยกเลิก)`, undefined,
      [{ spot: "link:gate", tone: "blocked" }, ...orders.map((order) => ({ spot: `link:row:orders:${order.id}`, tone: "blocked" as const }))]);
    return reject(state, flow, `ลบไม่ได้: ยังมีออเดอร์ ${orders.length} รายการของ “${customer.name}”`);
  }
  flow.step(hop("link:gate", `link:row:customers:${id}`, "ลบ", "ok"), `ไม่มีออเดอร์อ้างถึง ลบลูกค้า “${customer.name}” ได้ ✓`,
    (s) => ({ ...s, customers: s.customers.filter((entry) => entry.id !== id) }), [{ spot: "link:gate", tone: "allowed" }]);
  return finish(state, flow, "success", `ลบลูกค้า “${customer.name}” แล้ว`);
}

function deleteOrdersOf(state: DataState, customerId: number): DataTransition {
  const orders = ordersOf(state, customerId);
  if (!orders.length) return noop(state, "ลูกค้าคนนี้ไม่มีออเดอร์");
  const flow = new Flow(state);
  flow.step(hop("phoneA", `link:row:orders:${orders[0].id}`, `ลบ ${orders.length} ออเดอร์`, "request"), `ลบออเดอร์ทั้งหมดของ “${customerName(state, customerId)}” ก่อน`, undefined,
    orders.map((order) => ({ spot: `link:row:orders:${order.id}`, tone: "removed" as const })));
  flow.step(null, `ลบแล้ว ${orders.length} ออเดอร์ ตอนนี้ลบลูกค้าคนนี้ได้แล้ว`, (s) => ({ ...s, orders: s.orders.filter((order) => order.customerId !== customerId) }));
  return finish(state, flow, "success", `ลบออเดอร์ของ “${customerName(state, customerId)}” ${orders.length} รายการแล้ว`);
}

function orderCreate(state: DataState, customerId: number, menuId: number): DataTransition {
  const customer = state.customers.find((entry) => entry.id === customerId);
  const item = state.menu.find((entry) => entry.id === menuId);
  if (!customer || !item) return { ...noop(state, "เลือกลูกค้าและเมนูที่มีอยู่"), outcome: "rejected" };
  if (state.orders.length >= DATA_LIMITS.rows) return { ...noop(state, `สาธิตได้ไม่เกิน ${DATA_LIMITS.rows} ออเดอร์`), outcome: "rejected" };
  const id = state.nextId.orders;
  const order: Order = { id, customerId, menuId, qty: 1, copiedName: customer.name };
  const flow = new Flow(state);
  flow.step(hop("phoneA", `link:row:orders:${id}`, `${customer.name} สั่ง${item.name}`), `ออเดอร์ #${id} แบบอ้างด้วย ID เก็บแค่เลขลูกค้า #${customerId}`,
    (s) => ({ ...s, orders: [...s.orders, order], nextId: { ...s.nextId, orders: id + 1 } }),
    [{ spot: `link:row:orders:${id}`, tone: "new" }, { spot: `link:row:customers:${customerId}`, tone: "read" }]);
  flow.step(null, `แบบก๊อปชื่อ: คัดลอกชื่อ “${customer.name}” ไปเก็บไว้ในออเดอร์ด้วย`, undefined, [{ spot: `copy:cell:orders:${id}:name`, tone: "new" }]);
  return finish(state, flow, "success", `สร้างออเดอร์ #${id} แล้ว`);
}

// ---------------------------------------------------------------------------
// Step 4 — who can see what (Supabase: RLS)
// ---------------------------------------------------------------------------

function accessRules(state: DataState, on: boolean): DataTransition {
  if (state.rulesOn === on) return noop(state, on ? "กฎสิทธิ์เปิดอยู่แล้ว" : "กฎสิทธิ์ปิดอยู่แล้ว");
  const flow = new Flow(state).step(null, on ? "เปิดกฎสิทธิ์: ลูกค้าแต่ละคนเห็นเฉพาะออเดอร์ของตัวเอง" : "ปิดกฎสิทธิ์: ทุกคนดึงออเดอร์ของทุกคนได้ (อันตราย)",
    (s) => ({ ...s, rulesOn: on }), [{ spot: "gate", tone: on ? "allowed" : "leak" }]);
  return finish(state, flow, "success", on ? "เปิดกฎสิทธิ์แล้ว" : "ปิดกฎสิทธิ์แล้ว ลองให้ลูกค้าดูออเดอร์");
}

function accessRead(state: DataState, phone: PhoneId, table: "orders" | "menu"): DataTransition {
  const user = PHONE_USER[phone];
  const name = customerName(state, user);
  const flow = new Flow(state);
  if (table === "menu") {
    flow.step(hop(`phone${phone}`, "gate", "ขอดูเมนู", "request"), `${name} (เครื่อง ${phone}) ขอดูเมนู`);
    flow.step(hop("gate", "table:menu", "สาธารณะ", "ok"), "เมนูเป็นข้อมูลสาธารณะ ทุกคนดูได้ ✓", undefined, [{ spot: "gate", tone: "allowed" }]);
    flow.step(hop("table:menu", `phone${phone}`, `${state.menu.length} รายการ`), "ส่งเมนูกลับไปที่แอป",
      (s) => setPhone(s, phone, "เมนู", s.menu.map(menuLine)));
    return finish(state, flow, "success", `${name} เห็นเมนู ${state.menu.length} รายการ`);
  }
  const own = state.orders.filter((order) => order.customerId === user);
  const others = state.orders.filter((order) => order.customerId !== user);
  flow.step(hop(`phone${phone}`, "gate", `ขอดูออเดอร์ (ฉันคือ ${name})`, "request"), `${name} (เครื่อง ${phone}) ขอดูออเดอร์ทั้งหมด`);
  if (state.rulesOn) {
    flow.step(hop("gate", "table:orders", "ตรวจสิทธิ์", "request"), `ด่านกฎสิทธิ์: อนุญาตเฉพาะแถวที่เป็นของ ${name}`, undefined, [
      { spot: "gate", tone: "allowed" },
      ...own.map((order) => ({ spot: `row:orders:${order.id}`, tone: "allowed" as const })),
      ...others.map((order) => ({ spot: `row:orders:${order.id}`, tone: "blocked" as const })),
    ]);
    flow.step(hop("table:orders", `phone${phone}`, `${own.length} แถวของฉัน`, "ok"),
      `ได้เฉพาะออเดอร์ของตัวเอง ${own.length} แถว ของคนอื่น ${others.length} แถวถูกกรองที่ด่าน ✓`,
      (s) => setPhone(s, phone, `ออเดอร์ของ ${name}`, own.map((order) => orderLine(s, order))), [
        { spot: "gate", tone: "allowed" },
        ...own.map((order) => ({ spot: `row:orders:${order.id}`, tone: "allowed" as const })),
        ...others.map((order) => ({ spot: `row:orders:${order.id}`, tone: "blocked" as const })),
      ]);
    return finish(state, flow, "success", `${name} เห็นเฉพาะออเดอร์ของตัวเอง ${own.length} รายการ`);
  }
  flow.step(hop("gate", "table:orders", "ไม่ตรวจ", "leak"), "กฎสิทธิ์ปิดอยู่: ด่านปล่อยทุกแถวผ่าน", undefined, [
    { spot: "gate", tone: "leak" },
    ...own.map((order) => ({ spot: `row:orders:${order.id}`, tone: "allowed" as const })),
    ...others.map((order) => ({ spot: `row:orders:${order.id}`, tone: "leak" as const })),
  ]);
  flow.step(hop("table:orders", `phone${phone}`, `${state.orders.length} แถว (ของคนอื่น ${others.length})`, "leak"),
    `${name} เห็นออเดอร์ของคนอื่น ${others.length} แถว ข้อมูลรั่ว ✗`,
    (s) => setPhone(s, phone, `ออเดอร์ที่ ${name} เห็น`, s.orders.map((order) => `${order.customerId === user ? "" : "⚠ "}${orderLine(s, order)}`)),
    [{ spot: "gate", tone: "leak" }, ...others.map((order) => ({ spot: `row:orders:${order.id}`, tone: "leak" as const }))]);
  return finish(state, flow, "failed", `กฎสิทธิ์ปิด: ${name} เห็นออเดอร์ของคนอื่น ${others.length} รายการ`);
}

function reset(state: DataState): DataTransition {
  const initial = createInitialDataState();
  if (JSON.stringify(initial) === JSON.stringify(state)) return noop(state, "ข้อมูลเป็นค่าตั้งต้นอยู่แล้ว");
  const flow = new Flow(state).step(null, "เริ่มใหม่: ข้อมูลร้านกาแฟกลับเป็นค่าตั้งต้น", () => initial);
  return finish(state, flow, "success", "เริ่มใหม่แล้ว");
}

/** Applies one action. Never throws for user input; rejected actions leave the state unchanged. */
export function applyDataAction(state: DataState, action: DataAction): DataTransition {
  switch (action.type) {
    case "storage.mode": return storageMode(state, action.mode);
    case "storage.order": return storageOrder(state, action.item);
    case "storage.refresh": return storageRefresh(state, action.phone);
    case "storage.open": return storageOpen(state, action.phone);
    case "menu.create": return menuCreate(state, action.name, action.price, action.available);
    case "menu.read": return menuRead(state, action.phone);
    case "menu.update": return menuUpdate(state, action.id, action.field, action.value);
    case "menu.delete": return menuDelete(state, action.id);
    case "customer.rename": return customerRename(state, action.id, action.name);
    case "orders.fixCopies": return fixCopies(state, action.customerId);
    case "customer.delete": return customerDelete(state, action.id);
    case "orders.deleteOfCustomer": return deleteOrdersOf(state, action.customerId);
    case "order.create": return orderCreate(state, action.customerId, action.menuId);
    case "access.rules": return accessRules(state, action.on);
    case "access.read": return accessRead(state, action.phone, action.table);
    case "reset": return reset(state);
  }
}
