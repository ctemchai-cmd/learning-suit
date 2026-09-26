// Data-storage teaching simulator (plan 07 §3). Pure types: no React, no Konva, no network.
// Coffee-shop theme: a menu, customers and their orders, plus the two phones that use the app.

/** Lesson steps: where data lives → tables → linking tables → who can see what. */
export type DataView = "where" | "table" | "relation" | "access";
export type PhoneId = "A" | "B";
/** Step 1: where phone A's app keeps an order. */
export type StorageMode = "app" | "device" | "cloud";

export type MenuItem = { id: number; name: string; price: number; available: boolean };
export type Customer = { id: number; name: string };
/**
 * `copiedName` is the customer's name copied into the order when it was created. Step 3 shows the
 * two designs side by side: reading `copiedName` (a copy that goes stale) vs following `customerId`.
 */
export type Order = { id: number; customerId: number; menuId: number; qty: number; copiedName: string };
export type TableId = "menu" | "customers" | "orders";

export type DataState = {
  version: 1;
  storage: {
    mode: StorageMode;
    /** Orders held only in each phone's running app (lost on refresh). */
    memory: Record<PhoneId, string[]>;
    /** Orders saved on each phone itself (survive refresh, invisible to other phones). */
    device: Record<PhoneId, string[]>;
    /** Orders saved in the shared database. */
    cloud: string[];
    /** What each phone's app currently shows. */
    screen: Record<PhoneId, string[]>;
  };
  menu: MenuItem[];
  customers: Customer[];
  orders: Order[];
  nextId: Record<TableId, number>;
  /** Step 4: the access rule (Supabase: RLS policy) — each customer sees only their own orders. */
  rulesOn: boolean;
  /** Steps 2–4: the last answer each phone's app received (shown on its screen). */
  phones: Record<PhoneId, { title: string; lines: string[] }>;
};

/** Phone A is logged in as customer 1, phone B as customer 2 (step 4). */
export const PHONE_USER: Record<PhoneId, number> = { A: 1, B: 2 };

export type DataAction =
  | { type: "storage.mode"; mode: StorageMode }
  | { type: "storage.order"; item: string }
  | { type: "storage.refresh"; phone: PhoneId }
  | { type: "storage.open"; phone: PhoneId }
  | { type: "menu.create"; name: string; price: string; available: boolean }
  | { type: "menu.read"; phone: PhoneId }
  | { type: "menu.update"; id: number; field: "name" | "price" | "available"; value: string }
  | { type: "menu.delete"; id: number }
  | { type: "customer.rename"; id: number; name: string }
  | { type: "orders.fixCopies"; customerId: number }
  | { type: "customer.delete"; id: number }
  | { type: "orders.deleteOfCustomer"; customerId: number }
  | { type: "order.create"; customerId: number; menuId: number }
  | { type: "access.rules"; on: boolean }
  | { type: "access.read"; phone: PhoneId; table: "orders" | "menu" }
  | { type: "reset" };

// ---------------------------------------------------------------------------
// Flow frames: what the board plays for one action (session only, never stored).
// ---------------------------------------------------------------------------

/**
 * Named places on the board a packet can travel between. Rows/cells: `row:<table>:<id>`,
 * `cell:<table>:<id>:<field>`; step 3 prefixes the side: `copy:` or `link:` (e.g. `link:row:customers:1`).
 */
export type Spot = string;
export type FlowTone = "data" | "request" | "ok" | "blocked" | "leak" | "lost";
/** `detail` = what the packet carries, line by line (drawn as a card instead of a dot where a view supports it). */
export type Hop = { from: Spot; to: Spot; label: string; tone: FlowTone; detail?: string[] };
/** `refresh` on a phone = its app restarts (the board spins the refresh icon over a blank screen). */
export type MarkTone = "new" | "changed" | "stale" | "blocked" | "allowed" | "leak" | "removed" | "read" | "refresh";
export type Mark = { spot: Spot; tone: MarkTone; note?: string };
export type FlowFrame<S> = {
  /** The packet that travels during this frame (null = something happens in place). */
  hop: Hop | null;
  /** One Thai sentence under the board. */
  caption: string;
  /** Board state once this frame has landed. */
  state: S;
  /** Rows/cells/gates to highlight after landing. */
  marks: Mark[];
};

/** `failed` = the flow ran and shows a problem on purpose (lost data, a leak, no key …): red in the panel. */
export type DataOutcome = "success" | "rejected" | "noop" | "failed";
export type DataTransition = {
  nextState: DataState;
  changed: boolean;
  outcome: DataOutcome;
  /** Result text for the panel. */
  message: string;
  frames: FlowFrame<DataState>[];
};

export const DATA_LIMITS = { nameCodePoints: 40, price: 100_000, rows: 12, storageItems: 8, screenLines: 12 } as const;
