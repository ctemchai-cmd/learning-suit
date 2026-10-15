import { describe, expect, it } from "vitest";
import { createInitialAiState } from "@/domain/ai/initial";
import { createInitialDataState } from "@/domain/data/initial";
import { createInitialDeployState } from "@/domain/deploy/initial";
import { createInitialGitState } from "@/domain/git/initial";
import { createInitialSshState } from "@/domain/ssh/initial";
import type { CanvasNode, GitSimulatorNode, RectNode, SshSimulatorNode, WidgetNode } from "@/domain/document/model";
import { pickRevealTarget, widgetRevealParts } from "./widget-reveal";

const common = { x: 0, y: 0, rotation: 0 as const, opacity: 1, locked: false, scale: 1 };
const git = (id: string, reveal?: number, view: GitSimulatorNode["view"] = "full"): GitSimulatorNode => ({ ...common, id, type: "git-simulator", view, state: createInitialGitState(), ...(reveal === undefined ? {} : { reveal }) });
const ssh = (id: string, reveal?: number): SshSimulatorNode => ({ ...common, id, type: "ssh-simulator", view: "setup", state: createInitialSshState(), ...(reveal === undefined ? {} : { reveal }) });
const rect = (id: string): RectNode => ({ id, type: "rectangle", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, width: 10, height: 10, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent" });
const pick = (nodes: CanvasNode[], selected: string[] = []) => pickRevealTarget(nodes, selected)?.id ?? null;

describe("which widget teaching-mode next reveals (plan 07 §2)", () => {
  it("none with the mode off, none when nothing is a widget", () => {
    expect(pick([rect("r"), git("g"), ssh("s")])).toBeNull();
    expect(pick([])).toBeNull();
  });
  it("the top-most widget with parts left when nothing relevant is selected", () => {
    expect(pick([git("g", 0), rect("r"), ssh("s", 1)])).toBe("s");
    expect(pick([git("g", 0), ssh("s", 1)], ["r"])).toBe("s");
  });
  it("the selected widget first, even below another one", () => {
    expect(pick([git("g", 0), ssh("s", 1)], ["g"])).toBe("g");
  });
  it("a finished widget is skipped; all finished = null (go to the next slide)", () => {
    const all = widgetRevealParts(ssh("s")).length;
    expect(pick([git("g", 1), ssh("s", all)])).toBe("g");
    expect(pick([git("g", 2, "local"), ssh("s", all)])).toBeNull();
    expect(pick([git("g", 2, "local"), ssh("s", all)], ["s"])).toBeNull();
  });
  it("every simulator type has parts for every step (so teaching-mode next reaches it)", () => {
    const state = { ...common, scale: 1 };
    const nodes: WidgetNode[] = [
      ...(["local", "localEnv", "vercel", "env", "overall"] as const).map((view): WidgetNode => ({ ...state, id: `d-${view}`, type: "deploy-simulator", view, state: createInitialDeployState() })),
      ...(["where", "table", "relation", "access"] as const).map((view): WidgetNode => ({ ...state, id: `x-${view}`, type: "data-simulator", view, state: createInitialDataState() })),
      ...(["history", "thinking", "memory", "agent", "ccMemory"] as const).map((view): WidgetNode => ({ ...state, id: `a-${view}`, type: "ai-simulator", view, state: createInitialAiState() })),
    ];
    expect(nodes).toHaveLength(14);
    for (const node of nodes) {
      expect(widgetRevealParts(node).length, node.id).toBeGreaterThanOrEqual(3);
      expect(pick([{ ...node, reveal: 0 }]), node.id).toBe(node.id);
    }
  });
});
