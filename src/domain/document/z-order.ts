import type { CanvasNode } from "./model";

export type ZOrderAction = "forward" | "backward" | "front" | "back";

export function reorderNodeIds(nodes: CanvasNode[], selectedIds: string[], action: ZOrderAction): string[] {
  const ids = nodes.map((node) => node.id);
  const selected = new Set(selectedIds);
  if (!ids.some((id) => selected.has(id))) return ids;
  if (action === "front") return [...ids.filter((id) => !selected.has(id)), ...ids.filter((id) => selected.has(id))];
  if (action === "back") return [...ids.filter((id) => selected.has(id)), ...ids.filter((id) => !selected.has(id))];
  if (action === "forward") {
    for (let index = ids.length - 2; index >= 0; index--) {
      if (selected.has(ids[index]) && !selected.has(ids[index + 1])) [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    }
  } else {
    for (let index = 1; index < ids.length; index++) {
      if (selected.has(ids[index]) && !selected.has(ids[index - 1])) [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
    }
  }
  return ids;
}

export function hasZOrderChange(nodes: CanvasNode[], selectedIds: string[], action: ZOrderAction): boolean {
  return reorderNodeIds(nodes, selectedIds, action).some((id, index) => id !== nodes[index].id);
}
