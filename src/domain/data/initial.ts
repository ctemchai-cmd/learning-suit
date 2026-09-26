import type { DataState } from "./model";

/** Coffee-shop starting data (plan 07 §3). Returns fresh objects on every call; also the Reset target. */
export function createInitialDataState(): DataState {
  return {
    version: 1,
    storage: {
      mode: "app",
      memory: { A: [], B: [] },
      device: { A: [], B: [] },
      cloud: [],
      screen: { A: [], B: [] },
    },
    menu: [
      { id: 1, name: "ลาเต้", price: 60, available: true },
      { id: 2, name: "อเมริกาโน่", price: 50, available: true },
      { id: 3, name: "ชาเขียว", price: 55, available: true },
      { id: 4, name: "โกโก้", price: 45, available: false },
    ],
    customers: [
      { id: 1, name: "สมชาย" },
      { id: 2, name: "สมหญิง" },
      { id: 3, name: "มานี" },
    ],
    orders: [
      { id: 1, customerId: 1, menuId: 1, qty: 1, copiedName: "สมชาย" },
      { id: 2, customerId: 2, menuId: 3, qty: 2, copiedName: "สมหญิง" },
      { id: 3, customerId: 1, menuId: 2, qty: 1, copiedName: "สมชาย" },
      { id: 4, customerId: 3, menuId: 1, qty: 1, copiedName: "มานี" },
      { id: 5, customerId: 2, menuId: 2, qty: 1, copiedName: "สมหญิง" },
    ],
    nextId: { menu: 5, customers: 4, orders: 6 },
    rulesOn: true,
    phones: { A: { title: "", lines: [] }, B: { title: "", lines: [] } },
  };
}
