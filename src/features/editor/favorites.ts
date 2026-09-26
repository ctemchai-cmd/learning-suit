import type { EditorTool } from "./store";

// Favorite tools are a device preference: their order is the toolbar order and the 1–8 key order.

/** Keys 1–8 pick the favorites in toolbar order. */
export const FAVORITE_KEY_COUNT = 8;

/** `order` with `id` moved to `index` (clamped to the ends). */
export function moveFavorite(order: EditorTool[], id: EditorTool, index: number): EditorTool[] {
  const rest = order.filter((item) => item !== id);
  const target = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, target), id, ...rest.slice(target)];
}

/** The favorite for a number key (1-based), or null when there is none. */
export function favoriteForKey(order: EditorTool[], digit: number): EditorTool | null {
  return digit >= 1 && digit <= FAVORITE_KEY_COUNT ? order[digit - 1] ?? null : null;
}
