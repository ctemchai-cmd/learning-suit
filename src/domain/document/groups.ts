import type { CanvasNode } from "./model";

// Groups (plan 03 §groups): a shared `groupId` on the members. One level only; selecting any member
// selects the whole group, and copies always get their own group.

/** The selection widened to whole groups (locked members stay out, as everywhere). */
export function expandToGroups(nodes: CanvasNode[], ids: string[]): string[] {
  const groups = new Set(nodes.filter((node) => ids.includes(node.id) && node.groupId).map((node) => node.groupId));
  if (!groups.size) return ids;
  return [...new Set([...ids, ...nodes.filter((node) => !node.locked && node.groupId && groups.has(node.groupId)).map((node) => node.id)])];
}

const withoutGroup = (node: CanvasNode): CanvasNode => {
  const copy = { ...node };
  delete copy.groupId;
  return copy;
};

/** Replacements that put the selected unlocked objects into one new group (null when fewer than two). */
export function groupNodes(nodes: CanvasNode[], ids: string[], groupId: string): CanvasNode[] | null {
  const members = nodes.filter((node) => ids.includes(node.id) && !node.locked);
  return members.length >= 2 ? members.map((node) => ({ ...node, groupId })) : null;
}

/** Replacements that dissolve every group touched by the selection (null when nothing is grouped). */
export function ungroupNodes(nodes: CanvasNode[], ids: string[]): CanvasNode[] | null {
  const groups = new Set(nodes.filter((node) => ids.includes(node.id) && node.groupId).map((node) => node.groupId));
  const members = nodes.filter((node) => node.groupId && groups.has(node.groupId) && !node.locked);
  return members.length ? members.map(withoutGroup) : null;
}

/** Copies get new group IDs (a copy of a single member is simply ungrouped). */
export function withFreshGroups<T extends CanvasNode>(nodes: T[], newId: () => string = () => crypto.randomUUID()): T[] {
  const counts = new Map<string, number>();
  for (const node of nodes) if (node.groupId) counts.set(node.groupId, (counts.get(node.groupId) ?? 0) + 1);
  const renamed = new Map<string, string>();
  return nodes.map((node) => {
    if (!node.groupId) return node;
    if ((counts.get(node.groupId) ?? 0) < 2) return withoutGroup(node) as T;
    if (!renamed.has(node.groupId)) renamed.set(node.groupId, newId());
    return { ...node, groupId: renamed.get(node.groupId) };
  });
}

export const isGrouped = (nodes: CanvasNode[], ids: string[]) => nodes.some((node) => ids.includes(node.id) && Boolean(node.groupId));
