import { gitViewOf, isWidgetNode, type CanvasNode, type WidgetNode } from "@/domain/document/model";
import { hasPartsLeft, revealOn, type RevealPart } from "@/domain/document/reveal";
import { gitParts } from "@/features/git-simulator/widget-layout";
import { sshParts } from "@/features/ssh-simulator/ssh-layout";
import { aiParts } from "@/features/ai-simulator/ai-layout";
import { dataParts } from "@/features/data-simulator/data-layout";
import { deployParts } from "@/features/deploy-simulator/deploy-layout";

// Progressive reveal in the editor (plan 07 §2): which parts a widget's current step has, and which widget the
// teaching-mode “next” (PageDown / next-slide button) reveals before it moves on.

/**
 * The ordered parts of a widget's current step. One case per simulator: return its `<name>Parts(view, …)` here (see plan 07 §2).
 * A simulator that returns [] is never picked by “next”.
 */
export function widgetRevealParts(node: WidgetNode): RevealPart[] {
  switch (node.type) {
    case "git-simulator": return gitParts(gitViewOf(node), node.host);
    case "ssh-simulator": return sshParts(node.view, node.host);
    case "data-simulator": return dataParts(node.view);
    case "deploy-simulator": return deployParts(node.view);
    case "ai-simulator": return aiParts(node.view);
  }
}

/**
 * The widget a “next” press reveals a part of: among widgets with the mode on and parts left, the selected one first,
 * else the top-most (last in z-order). null = nothing to reveal, so “next” goes to the next slide.
 */
export function pickRevealTarget(nodes: readonly CanvasNode[], selectedIds: readonly string[]): WidgetNode | null {
  const candidates = nodes.filter((node): node is WidgetNode => isWidgetNode(node) && revealOn(node.reveal) && hasPartsLeft(widgetRevealParts(node), node.reveal));
  return [...candidates].reverse().find((node) => selectedIds.includes(node.id)) ?? candidates.at(-1) ?? null;
}
