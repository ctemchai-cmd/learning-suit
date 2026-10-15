import { describe, expect, it } from "vitest";
import { createInitialGitState } from "../../domain/git/initial";
import { applyGitAction } from "../../domain/git/reducer";
import type { FileSnapshot, GitAction, GitSimulationState } from "../../domain/git/model";
import { requestDiagram, branchPill, commitColor, commitGraph, commitLanes, laneMetrics, machineDiagram, remoteDiagram, shortSyncText } from "./diagram-model";

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
    state = play(state, { type: "pull", machine: "A" }); // same line changed on both sides: fetch kept, merge stops on a conflict
    expect(machineDiagram(state, "A").sync.text).toBe("↕ ประวัติแยกกับ GitHub");
    expect(machineDiagram(state, "A", "gitlab").sync.text).toBe("↕ ประวัติแยกกับ GitLab");
    expect(machineDiagram(state, "A")).toMatchObject({ working: { tone: "pending", text: "⚠ ไฟล์ชนกัน ต้องแก้" }, staged: { tone: "pending", text: "⚠ ยังมี conflict" } });
    const graph = commitGraph(state, "A");
    expect(graph.rows.map((row) => [row.id, row.lane, row.tags])).toEqual([
      ["C3", 1, ["origin/main"]],
      ["C2", 0, ["main"]],
      ["C1", 0, []],
    ]);
    expect(commitGraph(state, "remote").rows.map((row) => row.id)).toEqual(["C3", "C1"]);

    // Resolving and committing joins the fork: main stays on its own line, GitHub's commit is the merge's second parent.
    state = play(state, { type: "mergeTake", machine: "A", side: "ours" }, { type: "stage", machine: "A" }, { type: "commit", machine: "A", message: "merged" });
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
    expect(shortSyncText("↓ ตามหลัง GitLab 2 commit")).toBe("↓ ตามหลัง 2");
    expect(shortSyncText("↕ ประวัติแยกกับ GitLab")).toBe("↕ ประวัติแยก");
    expect(shortSyncText("↕ ประวัติแยกกับ GitHub")).toBe("↕ ประวัติแยก");
    expect(shortSyncText("✓ ตรงกับ GitHub")).toBe("✓ ตรงกับ GitHub");
  });
});

describe("branch lanes", () => {
  const onMain = (content: string, message: string) => commitOn("A", content, message);
  const named = (name: string): GitAction => ({ type: "branchCreate", machine: "A", name });
  const to = (name: string): GitAction => ({ type: "branchSwitch", machine: "A", name });
  const mergeOf = (name: string): GitAction => ({ type: "branchMerge", machine: "A", name });

  it("puts main on lane 0 and each branch with its own commits on its own lane, branching off the commit it started at", () => {
    // main: C1 C2; feature: C3 C4 (from C2); main: C5 (from C2)
    const state = play(createInitialGitState(), ...onMain("1", "one"), ...onMain("2", "two"), named("feature"), ...onMain("f1", "f1"), ...onMain("f2", "f2"),
      to("main"), ...onMain("m3", "m3"));
    const graph = commitGraph(state, "A");
    expect(graph.rows.map((row) => [row.id, row.lane, row.parentId])).toEqual([
      ["C5", 0, "C2"], ["C4", 1, "C3"], ["C3", 1, "C2"], ["C2", 0, "C1"], ["C1", 0, null],
    ]);
    expect(graph.laneCount).toBe(2);
    expect(graph.rows.map((row) => row.tags)).toEqual([["main"], ["feature"], [], [], []]);
    expect(graph.rows[0].headTag).toBe("main"); // HEAD → main
    expect(graph.rows[1].headTag).toBeNull();
  });

  it("shows HEAD on the current branch's tip and joins a real merge back as two parents", () => {
    // Different lines changed on each side, so Git merges by itself.
    let state = play(createInitialGitState(), ...onMain("a\nb\nc\nd\ne\n", "one"), named("feature"), ...onMain("A\nb\nc\nd\ne\n", "f1"), to("main"), ...onMain("a\nb\nc\nd\nE\n", "m2"));
    expect(commitGraph(state, "A").rows.find((row) => row.id === "C2")).toMatchObject({ lane: 1, tags: ["feature"], headTag: null });
    state = play(state, mergeOf("feature"));
    const rows = commitGraph(state, "A").rows;
    expect(rows[0]).toMatchObject({ id: "C4", lane: 0, parentId: "C3", mergeParentId: "C2", tags: ["main"], headTag: "main" });
    expect(rows.map((row) => [row.id, row.lane])).toEqual([["C4", 0], ["C3", 0], ["C2", 1], ["C1", 0]]);
    expect(branchPill(state, "A")).toEqual({ tone: "info", text: "คุณอยู่ที่ branch: main (HEAD)" });
    expect(branchPill(play(state, named("next")), "A")).toEqual({ tone: "ready", text: "คุณอยู่ที่ branch: next (HEAD)" });
    expect(branchPill(play(state, named("next")), "A", true)).toEqual({ tone: "ready", text: "HEAD → next" });
  });

  it("a fast-forwarded branch has no lane of its own and shares the tip with main", () => {
    const state = play(createInitialGitState(), ...onMain("1", "one"), named("feature"), ...onMain("f1", "f1"), to("main"), mergeOf("feature"));
    const graph = commitGraph(state, "A");
    expect(graph.laneCount).toBe(1);
    expect(graph.rows[0]).toMatchObject({ id: "C2", lane: 0, tags: ["main", "feature"], headTag: "main" });
  });

  it("a new branch without commits is only a tag on the commit it started at", () => {
    const state = play(createInitialGitState(), ...onMain("1", "one"), named("feature"));
    const graph = commitGraph(state, "A");
    expect(graph.laneCount).toBe(1);
    expect(graph.rows[0]).toMatchObject({ id: "C1", lane: 0, tags: ["main", "feature"], headTag: "feature" });
  });

  it("commits of a deleted branch keep a lane after the named branches; old states keep lane 1 for the fork", () => {
    let state = play(createInitialGitState(), ...onMain("a\nb\nc\nd\ne\n", "one"), named("gone"), ...onMain("A\nb\nc\nd\ne\n", "g1"), to("main"), ...onMain("a\nb\nc\nd\nE\n", "m2"), mergeOf("gone"));
    state = play(state, { type: "branchDelete", machine: "A", name: "gone" });
    const { lanes, count } = commitLanes(state, "A");
    expect(lanes.get("C2")).toBe(1);
    expect(count).toBe(2);
    expect(commitLanes(state, "remote").lanes.size).toBe(0);
  });

  it("lane metrics: two lanes keep the old text position, more lanes push the text right and shrink the gap", () => {
    expect(laneMetrics(1, false).textX).toBe(46);
    expect(laneMetrics(2, false)).toMatchObject({ x0: 22, gap: 30, radius: 14, textX: 78 });
    expect(laneMetrics(4, false).gap).toBe(30);
    const six = laneMetrics(6, false);
    expect(six.gap).toBeLessThan(30);
    expect(six.gap).toBeGreaterThanOrEqual(12);
    expect(six.textX).toBeGreaterThan(laneMetrics(2, false).textX);
    for (const lanes of [1, 2, 3, 5, 8, 21]) {
      const m = laneMetrics(lanes, false);
      expect(m.x0 + (lanes - 1) * m.gap + m.radius).toBeLessThan(m.textX); // the last lane never reaches the message
    }
  });
});

describe("Merge Request card and remote branches", () => {
  const f = (content: string) => ({ name: "a.txt", content });
  const commit = (machine: "A" | "B", content: string): GitAction[] => [{ type: "edit", machine, file: f(content) }, { type: "stage", machine }, { type: "commit", machine, message: "work" }];
  const pushR = (machine: "A" | "B"): GitAction => ({ type: "push", machine, review: true });
  let state = play(createInitialGitState(), ...commit("A", "a\nb\nc\n"), pushR("A"), { type: "clone", machine: "B" });

  it("shows an empty card, then open → approved → merged with the host's own word", () => {
    expect(requestDiagram(state)).toEqual({ empty: true, text: "ยังไม่มี Pull Request" });
    expect(requestDiagram(state, "gitlab")).toEqual({ empty: true, text: "ยังไม่มี Merge Request" });
    state = play(state, { type: "branchCreate", machine: "A", name: "feature" }, ...commit("A", "A\nb\nc\n"), pushR("A"), { type: "mrOpen", machine: "A" });
    expect(requestDiagram(state)).toMatchObject({ empty: false, title: "!1 feature → main", chip: { text: "เปิดอยู่", tone: "pending" } });
    const open = requestDiagram(state);
    expect(!open.empty && open.lines.map((line) => line.text)).toEqual(["เปิดโดย เครื่อง A • ยังไม่มีคนอนุมัติ", "✓ pipeline ผ่าน", "… รอเพื่อนอนุมัติ"]);
    state = play(state, { type: "mrApprove", machine: "B", id: 1 });
    const approved = requestDiagram(state);
    expect(approved).toMatchObject({ chip: { text: "อนุมัติแล้ว" } });
    expect(!approved.empty && approved.lines.map((line) => line.text)).toEqual(["เปิดโดย เครื่อง A • อนุมัติโดย เครื่อง B", "✓ pipeline ผ่าน", "✓ Merge ได้ (fast-forward)"]);
    state = play(state, { type: "mrMerge", machine: "B", id: 1 });
    const merged = requestDiagram(state);
    expect(merged).toMatchObject({ chip: { text: "รวมแล้ว", tone: "clean" } });
    expect(!merged.empty && merged.lines.at(-1)?.text).toBe("✓ รวมเข้า main แล้ว • ลบ branch feature แล้ว");
  });

  it("the remote's commit list tags a pushed branch and gives it its own lane", () => {
    let pushed = play(createInitialGitState(), ...commit("A", "a\nb\nc\n"), pushR("A"), { type: "branchCreate", machine: "A", name: "feature" }, ...commit("A", "A\nb\nc\n"), pushR("A"));
    const graph = commitGraph(pushed, "remote");
    expect(graph.rows.map((row) => [row.id, row.lane, row.tags])).toEqual([["C2", 1, ["feature"]], ["C1", 0, ["main"]]]);
    expect(commitLanes(pushed, "remote").count).toBe(2);
    pushed = play(pushed, { type: "branchSwitch", machine: "A", name: "main" });
    expect(commitGraph(pushed, "remote").rows[0].tags).toEqual(["feature"]);
  });
});
