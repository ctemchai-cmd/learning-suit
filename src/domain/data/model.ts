// Data-storage teaching simulator (plan 07 §3). Pure types: no React, no Konva, no network.
// Income/expense tracker theme: a table of categories, users and their transactions, plus the two computers that use the app.

/** Lesson steps: where data lives → tables → linking tables → who can see what. */
export type DataView = "where" | "table" | "relation" | "access";
export type ComputerId = "A" | "B";
/** Step 1: where computer A's app keeps a recorded transaction. */
export type StorageMode = "app" | "device" | "cloud";

export type CategoryKind = "income" | "expense";
export type Category = { id: number; name: string; kind: CategoryKind; active: boolean };
export type AppUser = { id: number; name: string };
/**
 * `amount` is always positive (baht); the category's kind says whether it is income or expense.
 * `copiedName` is the category's name copied into the transaction when it was created. Step 3 shows the
 * two designs side by side: reading `copiedName` (a copy that goes stale) vs following `categoryId`.
 */
export type Transaction = { id: number; userId: number; categoryId: number; amount: number; copiedName: string };
export type TableId = "categories" | "users" | "transactions";

/** Version 2 = the income/expense tracker (version 1 was the coffee-shop demo; the document schema replaces it with the initial state). */
export type DataState = {
  version: 2;
  storage: {
    mode: StorageMode;
    /** Transactions held only in each computer's running app (lost on refresh). */
    memory: Record<ComputerId, string[]>;
    /** Transactions saved on each computer itself (survive refresh, invisible to the other computer). */
    device: Record<ComputerId, string[]>;
    /** Transactions saved in the shared database. */
    cloud: string[];
    /** What each computer's app currently shows. */
    screen: Record<ComputerId, string[]>;
  };
  categories: Category[];
  users: AppUser[];
  transactions: Transaction[];
  nextId: Record<TableId, number>;
  /** Step 4: the access rule (Supabase: RLS policy) — each user sees only their own transactions. */
  rulesOn: boolean;
  /** Steps 2–4: the last answer each computer's app received (shown on its screen). */
  screens: Record<ComputerId, { title: string; lines: string[] }>;
};

/** Computer A is logged in as user 1, computer B as user 2 (step 4). */
export const COMPUTER_USER: Record<ComputerId, number> = { A: 1, B: 2 };

export type DataAction =
  | { type: "storage.mode"; mode: StorageMode }
  | { type: "storage.record"; item: string }
  | { type: "storage.refresh"; computer: ComputerId }
  | { type: "storage.open"; computer: ComputerId }
  | { type: "category.create"; name: string; kind: string; active: boolean }
  | { type: "category.read"; computer: ComputerId }
  | { type: "category.update"; id: number; field: "name" | "kind" | "active"; value: string }
  | { type: "category.delete"; id: number }
  | { type: "category.rename"; id: number; name: string }
  | { type: "transactions.fixCopies"; categoryId: number }
  | { type: "category.deleteLinked"; id: number }
  | { type: "transactions.deleteOfCategory"; categoryId: number }
  | { type: "transaction.create"; userId: number; categoryId: number; amount: string }
  | { type: "access.rules"; on: boolean }
  | { type: "access.read"; computer: ComputerId; table: "transactions" | "categories" }
  | { type: "reset" };

// ---------------------------------------------------------------------------
// Flow frames: what the board plays for one action (session only, never stored).
// ---------------------------------------------------------------------------

/**
 * Named places on the board a packet can travel between. Rows/cells: `row:<table>:<id>`,
 * `cell:<table>:<id>:<field>`; step 3 prefixes the side: `copy:` or `link:` (e.g. `link:row:categories:1`).
 */
export type Spot = string;
export type FlowTone = "data" | "request" | "ok" | "blocked" | "leak" | "lost";
/** One line a packet carries; `kind` tells the board which icon and colour to use. */
export type CarriedLine = { kind: "file" | "memory" | "user" | "ai" | "tool" | "edit" | "note" | "code" | "pass" | "fail" | "empty"; text: string };
/** `detail` = what the packet carries, line by line (drawn as a card instead of a dot where a view supports it). */
export type Hop = { from: Spot; to: Spot; label: string; tone: FlowTone; detail?: CarriedLine[] };
/** `refresh` on a computer = its app restarts (the board spins the refresh icon over a blank screen). */
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

export const DATA_LIMITS = { nameCodePoints: 40, amount: 10_000_000, rows: 12, storageItems: 8, screenLines: 12 } as const;
