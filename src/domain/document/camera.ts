import { LIMITS } from "./limits";
import type { Bounds, Point } from "./model";

export type Camera = { x: number; y: number; zoom: number };
export function screenToWorld(screen: Point, camera: Camera): Point {
  return { x: (screen.x - camera.x) / camera.zoom, y: (screen.y - camera.y) / camera.zoom };
}
export function worldToScreen(world: Point, camera: Camera): Point {
  return { x: world.x * camera.zoom + camera.x, y: world.y * camera.zoom + camera.y };
}
export function zoomAt(camera: Camera, screen: Point, nextZoom: number): Camera {
  const zoom = Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, nextZoom));
  const world = screenToWorld(screen, camera);
  return { x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom };
}
export function fitBounds(bounds: Bounds | null, viewport: { width: number; height: number }, margin = 48): Camera {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return { x: viewport.width / 2, y: viewport.height / 2, zoom: 1 };
  const zoom = Math.min(LIMITS.zoomMax, Math.max(LIMITS.zoomMin, Math.min((viewport.width - 2 * margin) / bounds.width, (viewport.height - 2 * margin) / bounds.height)));
  return { zoom, x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom, y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom };
}
