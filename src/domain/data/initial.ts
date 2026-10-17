import type { DataState } from "./model";

/** Income/expense tracker starting data (plan 07 §3). Returns fresh objects on every call; also the Reset target. */
export function createInitialDataState(): DataState {
  return {
    version: 2,
    storage: {
      mode: "app",
      memory: { A: [], B: [] },
      device: { A: [], B: [] },
      cloud: [],
      screen: { A: [], B: [] },
    },
    categories: [
      { id: 1, name: "เงินเดือน", kind: "income", active: true },
      { id: 2, name: "อาหาร", kind: "expense", active: true },
      { id: 3, name: "เดินทาง", kind: "expense", active: true },
      { id: 4, name: "ช้อปปิ้ง", kind: "expense", active: true },
    ],
    users: [
      { id: 1, name: "สมชาย" },
      { id: 2, name: "สมหญิง" },
    ],
    transactions: [
      { id: 1, userId: 1, categoryId: 1, amount: 25000, copiedName: "เงินเดือน" },
      { id: 2, userId: 2, categoryId: 2, amount: 120, copiedName: "อาหาร" },
      { id: 3, userId: 1, categoryId: 2, amount: 60, copiedName: "อาหาร" },
      { id: 4, userId: 1, categoryId: 3, amount: 45, copiedName: "เดินทาง" },
      { id: 5, userId: 2, categoryId: 1, amount: 30000, copiedName: "เงินเดือน" },
      { id: 6, userId: 2, categoryId: 4, amount: 890, copiedName: "ช้อปปิ้ง" },
    ],
    nextId: { categories: 5, users: 3, transactions: 7 },
    rulesOn: true,
    screens: { A: { title: "", lines: [] }, B: { title: "", lines: [] } },
  };
}
