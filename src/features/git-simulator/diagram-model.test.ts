import { describe, expect, it } from "vitest";
import { createInitialGitState } from "../../domain/git/initial";
import { applyGitAction } from "../../domain/git/reducer";
import type { FileSnapshot, GitAction, GitSimulationState } from "../../domain/git/model";
import { commitColor, commitGraph, machineDiagram, remoteDiagram, shortSyncText } from "./diagram-model";

const file = (content: string): FileSnapshot => ({ name: "index.html", content });
function play(state: GitSimulationState, ...actions: GitAction[]): GitSimulationState {
  return actions.reduce((current, action) => applyGitAction(current, action).nextState, state);
}
const commitOn = (machine: "A" | "B", content: string, message: string): GitAction[] => [
  { type: "edit", machine, file: file(content) }, { type: "stage", machine }, { type: "commit", machine, message },
];

describe("Git diagram model", () => {
  it("gives the same commit the same colour on every card", () => {
    expect(commitColor("C1")).toBe(commitColor("C1"));
    expect(commitColor("C1")).not.toBe(commitColor("C2"));
    expect(commitColor("C9")).toBe(commitColor("C1"));
  });

  it("walks a machine through working → stage → commit with short status texts", () => {
    let state = createInitialGitState();
    expect(machineDiagram(state, "A")).toMatchObject({ sync: { text: "ยังไม่มี commit" }, working: { tone: "pending", text: "✎ ไฟล์ใหม่ ยังไม่ Add" }, staged: { tone: "empty" } });
    state = play(state, { type: "edit", machine: "A", file: file("1") }, { type: "stage", machine: "A" });
    expect(machineDiagram(state, "A")).toMatchObject({ working: { tone: "clean" }, staged: { tone: "ready", text: "● มีไฟล์รอ Commit" } });
    state = play(state, { type: "commit", machine: "A", message: "one" });
    expect(machineDiagram(state, "A")).toMatchObject({ working: { tone: "clean" }, staged: { tone: "clean" }, sync: { text: "? ยังไม่รู้สถานะ GitHub" } });
    state = play(state, { type: "push", machine: "A" }, { type: "edit", machine: "A", file: file("2") });
    expect(machineDiagram(state, "A")).toMatchObject({ sync: { tone: "clean", text: "✓ ตรงกับ GitHub" }, working: { tone: "pending", text: "✎ แก้แล้ว ยังไม่ Add" } });
    expect(machineDiagram(state, "B")).toMatchObject({ initialized: false });
  });

  it("shows ahead/behind from the tracking this machine knows, and a fork after a diverged Pull", () => {
    let state = play(createInitialGitState(), ...commitOn("A", "1", "first"), { type: "push", machine: "A" }, { type: "clone", machine: "B" });
    state = play(state, ...commitOn("A", "A2", "A change"), ...commitOn("B", "B2", "B change"), { type: "push", machine: "B" });
    expect(machineDiagram(state, "A").sync.text).toBe("↑ 1 commit ยังไม่ Push");
    state = play(state, { type: "pull", machine: "A" }); // DIVERGED: fetch kept
    expect(machineDiagram(state, "A").sync.text).toBe("↕ ประวัติแยกกับ GitHub");
    const graph = commitGraph(state, "A");
    expect(graph.rows.map((row) => [row.id, row.lane, row.tags])).toEqual([
      ["C3", 1, ["origin/main"]],
      ["C2", 0, ["main"]],
      ["C1", 0, []],
    ]);
    expect(commitGraph(state, "remote").rows.map((row) => row.id)).toEqual(["C3", "C1"]);

    // Merge joins the fork: main stays on its own line, GitHub's commit is the merge's second parent.
    state = play(state, { type: "merge", machine: "A", keep: "ours" });
    expect(machineDiagram(state, "A").sync.text).toBe("↑ 2 commit ยังไม่ Push");
    expect(commitGraph(state, "A").rows.map((row) => [row.id, row.lane, row.parentId, row.mergeParentId])).toEqual([
      ["C4", 0, "C2", "C3"],
      ["C3", 1, "C1", null],
      ["C2", 0, "C1", null],
      ["C1", 0, null, null],
    ]);
  });

  it("describes GitHub without working/stage areas", () => {
    const empty = remoteDiagram(createInitialGitState());
    expect(empty.sync.text).toBe("ยังว่าง");
    const state = play(createInitialGitState(), ...commitOn("A", "<h1>หนึ่ง</h1>\n", "first"), { type: "push", machine: "A" });
    expect(remoteDiagram(state)).toMatchObject({ sync: { text: "มี 1 commit" }, fileLabel: "ไฟล์ใน main (C1)", preview: { lines: ["<h1>หนึ่ง</h1>"] } });
  });

  it("limits the graph to six rows and counts the rest", () => {
    let state = createInitialGitState();
    for (let i = 1; i <= 8; i++) state = play(state, ...commitOn("A", String(i), `m${i}`));
    const graph = commitGraph(state, "A");
    expect(graph.rows).toHaveLength(6);
    expect(graph.hiddenCount).toBe(2);
    expect(graph.rows[0]).toMatchObject({ id: "C8", tags: ["main"] });
  });
});

describe("short sync texts for narrow columns", () => {
  it("keeps the meaning in fewer characters", () => {
    expect(shortSyncText("↑ 1 commit ยังไม่ Push")).toBe("↑ 1 ยังไม่ Push");
    expect(shortSyncText("↓ ตามหลัง GitHub 2 commit")).toBe("↓ ตามหลัง 2");
    expect(shortSyncText("↕ ประวัติแยกกับ GitHub")).toBe("↕ ประวัติแยก");
    expect(shortSyncText("✓ ตรงกับ GitHub")).toBe("✓ ตรงกับ GitHub");
  });
});
