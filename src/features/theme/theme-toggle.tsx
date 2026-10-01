"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_KEY, type ThemeChoice } from "./theme-script";

const listeners = new Set<() => void>();
const read = (): ThemeChoice => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch { return "system"; }
};
const prefersDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
/** Puts the resolved theme on <html> (the stylesheet does the rest). */
function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice === "dark" || (choice === "system" && prefersDark()) ? "dark" : "light";
}
function choose(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch { /* private mode: applies for this page only */ }
  apply(choice);
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "ตามเครื่อง", light: "สว่าง", dark: "มืด" };

/** Header button: system → light → dark. The board stays light in every theme. */
export default function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
  // "Follow the device": react when the device switches between light and dark.
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return <button type="button" className="app-button icon-button" onClick={() => choose(NEXT[choice])}
    aria-label={`ธีม: ${LABEL[choice]} (กดเพื่อเปลี่ยน)`} title={`ธีม: ${LABEL[choice]} · กดเพื่อเปลี่ยนเป็น${LABEL[NEXT[choice]]} (กระดานยังเป็นสีขาวเสมอ)`}>
    <Icon size={17} />
  </button>;
}
