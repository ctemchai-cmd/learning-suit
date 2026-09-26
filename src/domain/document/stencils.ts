import type { StencilKind } from "./model";

// Catalog of the ready-made pictures (plan 03 §stencils): name in the picker, default size, colour and label.
// Frames are drawn at any size; icons keep their proportions inside the box and show the label under them.

export type StencilSpec = { kind: StencilKind; name: string; family: "frame" | "icon"; width: number; height: number; color: string; label: string };

const frame = (kind: StencilKind, name: string, width: number, height: number, color: string, label = ""): StencilSpec =>
  ({ kind, name, family: "frame", width, height, color, label });
const icon = (kind: StencilKind, name: string, color: string, label = name): StencilSpec =>
  ({ kind, name, family: "icon", width: 120, height: 140, color, label });

export const STENCILS: readonly StencilSpec[] = [
  frame("browser", "หน้าต่าง Browser", 560, 360, "#334155", "example.com"),
  frame("phone", "หน้าจอมือถือ", 220, 440, "#0F172A"),
  frame("laptop", "โน้ตบุ๊ก", 520, 340, "#334155"),
  frame("window", "หน้าต่างแอป", 440, 300, "#334155", "แอป"),
  frame("terminal", "Terminal", 480, 280, "#0F172A", "Terminal"),
  frame("editor", "หน้าต่างโค้ด", 520, 340, "#334155", "main.py"),
  icon("server", "เซิร์ฟเวอร์", "#2563EB"),
  icon("database", "ฐานข้อมูล", "#16A34A"),
  icon("cloud", "คลาวด์", "#0284C7"),
  icon("internet", "อินเทอร์เน็ต", "#0891B2"),
  icon("user", "ผู้ใช้", "#7C3AED"),
  icon("users", "ผู้ใช้หลายคน", "#7C3AED"),
  icon("computer", "คอมพิวเตอร์", "#334155"),
  icon("mobile", "มือถือ", "#334155"),
  icon("file", "ไฟล์", "#475569"),
  icon("folder", "โฟลเดอร์", "#D97706"),
  icon("code", "โค้ด", "#334155"),
  icon("git", "Git", "#EA580C"),
  icon("lock", "ความปลอดภัย", "#DC2626"),
  icon("key", "กุญแจ", "#CA8A04"),
  icon("ai", "AI", "#7C3AED"),
  icon("api", "API", "#DB2777"),
];

export const stencilSpec = (kind: StencilKind): StencilSpec => STENCILS.find((item) => item.kind === kind)!;
