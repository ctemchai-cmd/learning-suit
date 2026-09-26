"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuEntry =
  | { kind: "item"; label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { kind: "separator" };

/**
 * Right-click menu of the board (plan 03 §context menu): fixed at the pointer, kept inside the window,
 * closes on Escape, outside press, scroll/resize/blur or after an action. Arrow keys move between items.
 */
export default function ContextMenu({ at, entries, onClose }: { at: { x: number; y: number }; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(at);

  // Keep the menu on screen (measured after the first paint), then focus the first usable item.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)) });
    menu.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [at]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return <div ref={ref} role="menu" aria-label="เมนูคลิกขวา" onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}
    className="fixed z-50 min-w-[250px] rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-2xl"
    style={{ left: position.x, top: position.y }}>
    {entries.map((entry, index) => entry.kind === "separator"
      ? <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-slate-100" />
      : <button key={entry.label} type="button" role="menuitem" disabled={entry.disabled}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${entry.danger ? "text-red-700 hover:bg-red-50 focus:bg-red-50" : "text-slate-800 hover:bg-slate-100 focus:bg-slate-100"}`}
        onClick={() => { onClose(); entry.onSelect(); }}>
        <span aria-hidden className="grid w-4 shrink-0 place-items-center">{entry.icon}</span>
        <span className="flex-1">{entry.label}</span>
        {entry.shortcut && <kbd className="font-mono text-[11px] text-slate-400">{entry.shortcut}</kbd>}
      </button>)}
  </div>;
}
