import type { CanvasNode } from "./model";
import { withFreshGroups } from "./groups";

// Copies of objects (duplicate, paste, ⌥-drag, duplicated slides): new ids, their own groups, and connectors
// attached only to objects copied with them.

type Connector = Extract<CanvasNode, { type: "line" | "arrow" }>;

/** Copies keep their connections only to objects copied with them (ids mapped old → new); others are detached. */
export function remapBindings<T extends CanvasNode>(copies: T[], idMap: Map<string, string>): T[] {
  return copies.map((node) => {
    if ((node.type !== "line" && node.type !== "arrow") || (!node.startBinding && !node.endBinding)) return node;
    const next = { ...node } as Connector;
    for (const key of ["startBinding", "endBinding"] as const) {
      const binding = next[key];
      if (!binding) continue;
      const mapped = idMap.get(binding.nodeId);
      if (mapped) next[key] = { ...binding, nodeId: mapped }; else delete next[key];
    }
    return next as unknown as T;
  });
}

/** Deep copies with fresh ids; `change` adjusts each copy (offset, unlock …). */
export function copyNodes<T extends CanvasNode>(nodes: T[], change: (copy: T) => T = (copy) => copy): T[] {
  const idMap = new Map<string, string>();
  const copies = nodes.map((node) => {
    const id = crypto.randomUUID();
    idMap.set(node.id, id);
    return change({ ...structuredClone(node), id });
  });
  return remapBindings(withFreshGroups(copies), idMap);
}
