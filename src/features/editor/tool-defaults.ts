import { DEFAULTS, LIMITS } from "@/domain/document/limits";

// Tool defaults are device preferences (plan01 §Properties): stored in localStorage,
// never in the document, history or cloud save.

export type ToolDefaults = {
  pen: { stroke: string; strokeWidth: number };
  highlighter: { stroke: string; strokeWidth: number };
  shape: { stroke: string; strokeWidth: number; strokeStyle: "solid" | "dashed"; fill: string };
  line: { stroke: string; strokeWidth: number; strokeStyle: "solid" | "dashed"; headLength: number; headWidth: number };
  text: { color: string; fontSize: number };
};

export const INITIAL_TOOL_DEFAULTS: ToolDefaults = {
  pen: { stroke: DEFAULTS.stroke, strokeWidth: DEFAULTS.penWidth },
  highlighter: { stroke: DEFAULTS.highlighterColor, strokeWidth: DEFAULTS.highlighterWidth },
  shape: { stroke: DEFAULTS.stroke, strokeWidth: DEFAULTS.strokeWidth, strokeStyle: "solid", fill: DEFAULTS.fill },
  line: { stroke: DEFAULTS.stroke, strokeWidth: DEFAULTS.strokeWidth, strokeStyle: "solid", headLength: DEFAULTS.headLength, headWidth: DEFAULTS.headWidth },
  text: { color: DEFAULTS.stroke, fontSize: DEFAULTS.fontSize },
};

const KEY = "learning-suit-tool-defaults-v1";
const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9A-F]{6}$/.test(value) ? value : fallback;
const fill = (value: unknown, fallback: string) => value === "transparent" ? value : color(value, fallback);
const number = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const style = (value: unknown) => value === "dashed" ? "dashed" as const : "solid" as const;

export function sanitizeToolDefaults(value: unknown): ToolDefaults {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, Record<string, unknown> | undefined>;
  const d = INITIAL_TOOL_DEFAULTS;
  return {
    pen: { stroke: color(input.pen?.stroke, d.pen.stroke), strokeWidth: number(input.pen?.strokeWidth, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax, d.pen.strokeWidth) },
    highlighter: { stroke: color(input.highlighter?.stroke, d.highlighter.stroke), strokeWidth: number(input.highlighter?.strokeWidth, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax, d.highlighter.strokeWidth) },
    shape: {
      stroke: color(input.shape?.stroke, d.shape.stroke), strokeWidth: number(input.shape?.strokeWidth, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax, d.shape.strokeWidth),
      strokeStyle: style(input.shape?.strokeStyle), fill: fill(input.shape?.fill, d.shape.fill),
    },
    line: {
      stroke: color(input.line?.stroke, d.line.stroke), strokeWidth: number(input.line?.strokeWidth, LIMITS.strokeWidthMin, LIMITS.strokeWidthMax, d.line.strokeWidth),
      strokeStyle: style(input.line?.strokeStyle),
      headLength: number(input.line?.headLength, 1, 256, d.line.headLength), headWidth: number(input.line?.headWidth, 1, 256, d.line.headWidth),
    },
    text: { color: color(input.text?.color, d.text.color), fontSize: number(input.text?.fontSize, LIMITS.fontSizeMin, LIMITS.fontSizeMax, d.text.fontSize) },
  };
}

export function readToolDefaults(): ToolDefaults {
  if (typeof window === "undefined") return INITIAL_TOOL_DEFAULTS;
  try { return sanitizeToolDefaults(JSON.parse(localStorage.getItem(KEY) ?? "null")); }
  catch { return INITIAL_TOOL_DEFAULTS; }
}
export function writeToolDefaults(defaults: ToolDefaults): void {
  try { localStorage.setItem(KEY, JSON.stringify(defaults)); } catch { /* Device preferences are best effort. */ }
}
