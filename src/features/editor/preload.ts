/**
 * Starts downloading the editor chunk (canvas, konva, panels) without rendering it. The project list calls this once the
 * list is on screen, and the editor route calls it as soon as its own code runs, so the chunk is already on its way (or
 * cached) while the sign-in check and the project data are still loading. Safe to call repeatedly: the bundler caches
 * the import promise, and the same module backs `next/dynamic` in editor-boundary.
 */
export function preloadEditor(): Promise<unknown> {
  return import("./editor").catch(() => undefined);
}
