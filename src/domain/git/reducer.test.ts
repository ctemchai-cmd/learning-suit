import { describe, expect, it } from "vitest";
import { createInitialGitState } from "./initial";
import { applyGitAction } from "./reducer";
import { aheadBehind, ancestorsOf, branchNames, currentBranch, hasStaged, hasUnstaged, isAncestor, knownCommitsNewestFirst, planBranchMerge, suggestBranchName, validateBranchName } from "./selectors";
import { describeGitTransition } from "./messages";
import type { FileSnapshot, GitAction, GitCommit, GitResultCode, GitSimulationState, GitTransition, MachineRepository } from "./model";
import { createProjectContent, type GitSimulatorNode, type ProjectContent } from "../document/model";
import { parseProjectContent } from "../document/schema";
import { commitTransaction, createHistory, redo, undo, type HistoryState } from "../document/history";

// ---------------------------------------------------------------------------
// Fixtures (plan 04 §7) — expected values below are written literally from the spec.
// ---------------------------------------------------------------------------

const S1: FileSnapshot = { name: "index.html", content: "<h1>รุ่นหนึ่ง</h1>\n" };
const S2: FileSnapshot = { name: "index.html", content: "<h1>รุ่นสองจาก B</h1>\n" };
const SA: FileSnapshot = { name: "index.html", content: "<h1>งานต่อของ A</h1>\n" };
const SB: FileSnapshot = { name: "index.html", content: "<h1>งานต่อของ B</h1>\n" };

const INITIAL_JSON = {
  version: 1,
  commits: {},
  machines: {
    A: {
      initialized: true,
      working: { name: "main.py", content: "print(\"Hello World\")\n" },
      index: null,
      mainHead: null,
      originMainHead: null,
      knownCommitIds: [],
    },
    B: { initialized: false, working: null, index: null, mainHead: null, originMainHead: null, knownCommitIds: [] },
  },
  remote: { mainHead: null, knownCommitIds: [] },
  nextCommitNumber: 1,
};

const UNINITIALIZED_B: MachineRepository = {
  initialized: false, working: null, index: null, mainHead: null, originMainHead: null, knownCommitIds: [],
};

const machineRepo = (working: FileSnapshot, index: FileSnapshot | null, mainHead: string | null, originMainHead: string | null, knownCommitIds: string[]): MachineRepository =>
  ({ initialized: true, working, index, mainHead, originMainHead, knownCommitIds });

const commitOf = (id: string, parentId: string | null, message: string, snapshot: FileSnapshot): GitCommit =>
  ({ id, parentId, message, snapshot });

// ---------------------------------------------------------------------------
// Harness: deep-freeze every input, check immutability, determinism and no-op identity.
// ---------------------------------------------------------------------------

const produced: GitSimulationState[] = [];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function run(state: GitSimulationState, action: GitAction): GitTransition {
  deepFreeze(state);
  const before = JSON.stringify(state);
  const first = applyGitAction(state, action);
  const second = applyGitAction(state, action);
  expect(second).toEqual(first);
  expect(JSON.stringify(state)).toBe(before);
  if (!first.changed) expect(first.nextState).toBe(state);
  if (first.outcome === "noop") expect(first.changed).toBe(false);
  if (first.outcome === "rejected" && first.changed) expect(first.code).toBe("DIVERGED");
  expect(first.affectedCommitIds).toEqual([...first.affectedCommitIds].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  expect(typeof describeGitTransition(action, first)).toBe("string");
  produced.push(first.nextState);
  return first;
}

function step(state: GitSimulationState, action: GitAction, code: GitResultCode): GitSimulationState {
  const transition = run(state, action);
  expect(transition.code).toBe(code);
  return transition.nextState;
}

const edit = (machine: "A" | "B", file: FileSnapshot): GitAction => ({ type: "edit", machine, file: { ...file } });
const stage = (machine: "A" | "B"): GitAction => ({ type: "stage", machine });
const commitAction = (machine: "A" | "B", message: string): GitAction => ({ type: "commit", machine, message });
const push = (machine: "A" | "B"): GitAction => ({ type: "push", machine });
const pull = (machine: "A" | "B"): GitAction => ({ type: "pull", machine });
const clone: GitAction = { type: "clone", machine: "B" };

function editStageCommit(state: GitSimulationState, machine: "A" | "B", file: FileSnapshot, message: string): GitSimulationState {
  let next = step(state, edit(machine, file), "EDITED");
  next = step(next, stage(machine), "STAGED");
  return step(next, commitAction(machine, message), "COMMITTED");
}

/** GIT-01 steps 1–3 (every side knows C1). */
function afterGit01Step3(): GitSimulationState {
  let state = editStageCommit(createInitialGitState(), "A", S1, "first version");
  state = step(state, push("A"), "PUSHED");
  return step(state, clone, "CLONED");
}

/** GIT-01 steps 1–5 (A at C1, GitHub at C2). */
function afterGit01Step5(): GitSimulationState {
  let state = editStageCommit(afterGit01Step3(), "B", S2, "update on B");
  state = step(state, push("B"), "PUSHED");
  return state;
}

// ---------------------------------------------------------------------------

describe("createInitialGitState", () => {
  it("returns exactly the §2 fixture with fresh objects on every call", () => {
    const a = createInitialGitState();
    const b = createInitialGitState();
    expect(a).toEqual(INITIAL_JSON);
    expect(JSON.parse(JSON.stringify(a))).toEqual(INITIAL_JSON);
    expect(a.machines.A.working?.content.endsWith(")\n")).toBe(true);
    expect(a.machines.A.working?.content.endsWith("\n\n")).toBe(false);
    expect(a).not.toBe(b);
    expect(a.machines.A).not.toBe(b.machines.A);
    expect(a.machines.A.working).not.toBe(b.machines.A.working);
    expect(a.remote.knownCommitIds).not.toBe(b.remote.knownCommitIds);
    expect(a.commits).not.toBe(b.commits);
  });
});

describe("GIT-01 — A → GitHub → B → GitHub → A", () => {
  it("keeps the same commit IDs everywhere and never creates commits on transfer", () => {
    // 1. Edit A=S1 → Stage A → Commit A "first version"
    let state = step(createInitialGitState(), edit("A", S1), "EDITED");
    state = step(state, stage("A"), "STAGED");
    const committed = run(state, commitAction("A", "first version"));
    expect(committed).toMatchObject({ outcome: "success", changed: true, code: "COMMITTED", affectedCommitIds: ["C1"], transfer: null });
    state = committed.nextState;
    expect(state.commits).toEqual({ C1: commitOf("C1", null, "first version", S1) });
    expect(state.machines.A).toEqual(machineRepo(S1, S1, "C1", null, ["C1"]));
    expect(state.remote).toEqual({ mainHead: null, knownCommitIds: [] });
    expect(state.machines.B).toEqual(UNINITIALIZED_B);
    expect(state.nextCommitNumber).toBe(2);

    // 2. Push A
    const pushed = run(state, push("A"));
    expect(pushed).toMatchObject({ outcome: "success", changed: true, code: "PUSHED", affectedCommitIds: ["C1"] });
    expect(pushed.transfer).toEqual({ from: "A", to: "remote", commitIds: ["C1"] });
    state = pushed.nextState;
    expect(state.remote).toEqual({ mainHead: "C1", knownCommitIds: ["C1"] });
    expect(state.machines.A).toEqual(machineRepo(S1, S1, "C1", "C1", ["C1"]));
    expect(state.machines.B).toEqual(UNINITIALIZED_B);
    expect(state.nextCommitNumber).toBe(2);

    // 3. Clone B
    const cloned = run(state, clone);
    expect(cloned).toMatchObject({ outcome: "success", changed: true, code: "CLONED", affectedCommitIds: ["C1"] });
    expect(cloned.transfer).toEqual({ from: "remote", to: "B", commitIds: ["C1"] });
    state = cloned.nextState;
    expect(state.machines.B).toEqual(machineRepo(S1, S1, "C1", "C1", ["C1"]));
    expect(state.commits).toEqual({ C1: commitOf("C1", null, "first version", S1) });
    expect(state.machines.B.working).not.toBe(state.machines.B.index);
    expect(state.machines.B.working).not.toBe(state.commits.C1.snapshot);
    expect(state.machines.B.index).not.toBe(state.commits.C1.snapshot);

    // 4. Edit B=S2 → Stage B → Commit B "update on B"
    state = step(state, edit("B", S2), "EDITED");
    state = step(state, stage("B"), "STAGED");
    state = step(state, commitAction("B", "update on B"), "COMMITTED");
    expect(state.commits.C2).toEqual(commitOf("C2", "C1", "update on B", S2));
    expect(state.machines.B).toEqual(machineRepo(S2, S2, "C2", "C1", ["C1", "C2"]));
    expect(state.remote).toEqual({ mainHead: "C1", knownCommitIds: ["C1"] });
    expect(state.machines.A).toEqual(machineRepo(S1, S1, "C1", "C1", ["C1"]));

    // 5. Push B
    const pushedB = run(state, push("B"));
    expect(pushedB).toMatchObject({ outcome: "success", changed: true, code: "PUSHED", affectedCommitIds: ["C2"] });
    expect(pushedB.transfer).toEqual({ from: "B", to: "remote", commitIds: ["C2"] });
    state = pushedB.nextState;
    expect(state.remote).toEqual({ mainHead: "C2", knownCommitIds: ["C1", "C2"] });
    expect(state.machines.B).toEqual(machineRepo(S2, S2, "C2", "C2", ["C1", "C2"]));
    expect(state.machines.A).toEqual(machineRepo(S1, S1, "C1", "C1", ["C1"]));

    // 6. Pull A
    const pulled = run(state, pull("A"));
    expect(pulled).toMatchObject({ outcome: "success", changed: true, code: "PULLED", affectedCommitIds: ["C2"] });
    expect(pulled.transfer).toEqual({ from: "remote", to: "A", commitIds: ["C2"] });
    state = pulled.nextState;
    expect(state.machines.A).toEqual(machineRepo(S2, S2, "C2", "C2", ["C1", "C2"]));
    expect(state.nextCommitNumber).toBe(3);
    expect(Object.keys(state.commits).sort()).toEqual(["C1", "C2"]);
    expect(state.commits).toEqual({
      C1: commitOf("C1", null, "first version", S1),
      C2: commitOf("C2", "C1", "update on B", S2),
    });
  });
});

describe("GIT-02 — stage then keep editing before Commit", () => {
  it("commits the staged snapshot, not the working file", () => {
    let state = step(createInitialGitState(), edit("A", S1), "EDITED");
    state = step(state, stage("A"), "STAGED");
    state = step(state, edit("A", SA), "EDITED");
    state = step(state, commitAction("A", "stage snapshot"), "COMMITTED");
    expect(state.commits.C1).toEqual(commitOf("C1", null, "stage snapshot", S1));
    expect(state.machines.A.index).toEqual(S1);
    expect(state.machines.A.working).toEqual(SA);
    expect(hasStaged(state, "A")).toBe(false);
    expect(hasUnstaged(state, "A")).toBe(true);

    const again = run(state, commitAction("A", "stage snapshot"));
    expect(again).toMatchObject({ outcome: "rejected", changed: false, code: "NOTHING_STAGED", transfer: null, affectedCommitIds: [] });
    expect(again.nextState).toBe(state);
    expect(again.nextState.nextCommitNumber).toBe(2);

    state = step(state, stage("A"), "STAGED");
    state = step(state, commitAction("A", "second"), "COMMITTED");
    expect(state.commits.C2).toEqual(commitOf("C2", "C1", "second", SA));
    expect(state.machines.A).toEqual(machineRepo(SA, SA, "C2", null, ["C1", "C2"]));
    expect(state.nextCommitNumber).toBe(3);
  });
});

describe("GIT-03 — rejected Push, then Pull fetches before reporting divergence", () => {
  const nodeId = "3f0b0c35-9a5e-4a45-9d8f-2d7e3c1c6a11";

  function contentWith(state: GitSimulationState): { content: ProjectContent; slideId: string; node: GitSimulatorNode } {
    const content = createProjectContent("บทเรียน Git");
    const node: GitSimulatorNode = { id: nodeId, type: "git-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, state };
    content.document.slides[0].nodes.push(node);
    return { content, slideId: content.document.slides[0].id, node };
  }

  function gitStateIn(history: HistoryState): GitSimulationState {
    const node = history.content.document.slides[0].nodes.find((item) => item.id === nodeId);
    if (node?.type !== "git-simulator") throw new Error("missing git node");
    return node.state;
  }

  it("follows every step and needs exactly one Undo per changed action", () => {
    const start = afterGit01Step3();
    const { content, slideId, node } = contentWith(start);
    let history = createHistory(content);
    const dispatch = (action: GitAction, code: GitResultCode): GitTransition => {
      const transition = run(gitStateIn(history), action);
      expect(transition.code).toBe(code);
      const pastBefore = history.past.length;
      if (transition.changed) {
        const committed = commitTransaction(history, {
          label: `Git ${action.type}`,
          affectedSlideId: slideId,
          commands: [{ type: "nodes.replace", slideId, nodes: [{ ...node, state: transition.nextState }] }],
        });
        expect(committed.result.status).toBe("applied");
        history = committed.history;
        expect(history.past.length).toBe(pastBefore + 1);
      }
      expect(gitStateIn(history)).toEqual(transition.nextState);
      return transition;
    };

    // 1. A: C2 from SA
    dispatch(edit("A", SA), "EDITED");
    dispatch(stage("A"), "STAGED");
    dispatch(commitAction("A", "A change"), "COMMITTED");
    let state = gitStateIn(history);
    expect(state.commits.C2).toEqual(commitOf("C2", "C1", "A change", SA));
    expect(state.machines.A.mainHead).toBe("C2");
    expect(state.machines.A.originMainHead).toBe("C1");

    // 2. B: C3 from SB
    dispatch(edit("B", SB), "EDITED");
    dispatch(stage("B"), "STAGED");
    dispatch(commitAction("B", "B change"), "COMMITTED");
    state = gitStateIn(history);
    expect(state.commits.C3).toEqual(commitOf("C3", "C1", "B change", SB));
    expect(state.machines.B.mainHead).toBe("C3");
    expect(state.machines.B.originMainHead).toBe("C1");

    // 3. B Push
    dispatch(push("B"), "PUSHED");
    state = gitStateIn(history);
    expect(state.remote).toEqual({ mainHead: "C3", knownCommitIds: ["C1", "C3"] });
    expect(state.machines.A.knownCommitIds).toEqual(["C1", "C2"]);

    // 4. A Push → NON_FAST_FORWARD, nothing changes, A does not learn C3
    const beforeRejectedPush = state;
    const pastBeforePush = history.past.length;
    const rejectedPush = dispatch(push("A"), "NON_FAST_FORWARD");
    expect(rejectedPush).toMatchObject({ outcome: "rejected", changed: false, transfer: null, affectedCommitIds: [] });
    expect(rejectedPush.nextState).toBe(beforeRejectedPush);
    expect(history.past.length).toBe(pastBeforePush);
    expect(gitStateIn(history).machines.A.knownCommitIds).toEqual(["C1", "C2"]);
    expect(knownCommitsNewestFirst(gitStateIn(history), "A").map((item) => item.id)).toEqual(["C2", "C1"]);

    // 5. A Pull → DIVERGED but keeps the fetch
    const diverged = dispatch(pull("A"), "DIVERGED");
    expect(diverged).toMatchObject({ outcome: "rejected", changed: true, affectedCommitIds: ["C3"] });
    expect(diverged.transfer).toEqual({ from: "remote", to: "A", commitIds: ["C3"] });
    state = gitStateIn(history);
    expect(state.machines.A).toEqual(machineRepo(SA, SA, "C2", "C3", ["C1", "C2", "C3"]));
    expect(state.remote).toEqual({ mainHead: "C3", knownCommitIds: ["C1", "C3"] });
    expect(state.machines.B).toEqual(machineRepo(SB, SB, "C3", "C3", ["C1", "C3"]));
    expect(describeGitTransition(pull("A"), diverged)).toBe("รับข้อมูลจาก GitHub แล้ว แต่ประวัติแยกกัน (ต่างคนต่าง Commit) เลือก Merge เพื่อรวมประวัติ หรือใช้เวอร์ชันของ GitHub");

    // 6. One Undo restores the pre-fetch state; Redo restores the recorded fetch result
    const pastAfterPull = history.past.length;
    history = undo(history).history;
    expect(history.past.length).toBe(pastAfterPull - 1);
    expect(gitStateIn(history).machines.A).toEqual(machineRepo(SA, SA, "C2", "C1", ["C1", "C2"]));
    expect(gitStateIn(history)).toEqual(beforeRejectedPush);
    history = redo(history).history;
    expect(gitStateIn(history)).toEqual(diverged.nextState);
    expect(gitStateIn(history).machines.A).toEqual(machineRepo(SA, SA, "C2", "C3", ["C1", "C2", "C3"]));

    // 7. Pull again → DIVERGED without change, no new history
    const pastBeforeRepeat = history.past.length;
    const repeat = dispatch(pull("A"), "DIVERGED");
    expect(repeat).toMatchObject({ outcome: "rejected", changed: false, transfer: null, affectedCommitIds: [] });
    expect(history.past.length).toBe(pastBeforeRepeat);

    // Every piece of work is inspectable in a repository that knows it.
    state = gitStateIn(history);
    expect(knownCommitsNewestFirst(state, "A").map((item) => item.id)).toEqual(["C3", "C2", "C1"]);
    expect(knownCommitsNewestFirst(state, "B").map((item) => item.id)).toEqual(["C3", "C1"]);
    expect(knownCommitsNewestFirst(state, "remote").map((item) => item.id)).toEqual(["C3", "C1"]);

    // One history entry for each changed action: 3 (A) + 3 (B) + push B + diverged pull.
    expect(history.past.length).toBe(8);
  });
});

describe("GIT-04 — dirty working/index blocks Pull before fetch", () => {
  it("rejects an unstaged edit without fetching", () => {
    let state = afterGit01Step5();
    state = step(state, edit("A", SA), "EDITED");
    const transition = run(state, pull("A"));
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "DIRTY_WORKTREE", transfer: null, affectedCommitIds: [] });
    expect(transition.nextState).toBe(state);
    expect(transition.nextState.machines.A).toEqual(machineRepo(SA, S1, "C1", "C1", ["C1"]));
    expect(describeGitTransition(pull("A"), transition)).toBe("โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull");
  });
  it("rejects a staged but uncommitted change the same way", () => {
    let state = afterGit01Step5();
    state = step(state, edit("A", SA), "EDITED");
    state = step(state, stage("A"), "STAGED");
    const transition = run(state, pull("A"));
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "DIRTY_WORKTREE", transfer: null });
    expect(transition.nextState).toBe(state);
    expect(transition.nextState.machines.A).toEqual(machineRepo(SA, SA, "C1", "C1", ["C1"]));
  });
});

describe("GIT-05 — an ahead machine is never pulled backwards", () => {
  it("returns NO_CHANGE when tracking already knows the remote head", () => {
    let state = editStageCommit(afterGit01Step3(), "A", SA, "A ahead");
    const transition = run(state, pull("A"));
    expect(transition).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE", transfer: null, affectedCommitIds: [] });
    state = transition.nextState;
    expect(state.machines.A).toEqual(machineRepo(SA, SA, "C2", "C1", ["C1", "C2"]));
    expect(state.commits.C3).toBeUndefined();
    expect(state.nextCommitNumber).toBe(3);
  });
  it("updates stale (null) tracking with FETCHED_UP_TO_DATE and keeps the local HEAD", () => {
    const fixture: GitSimulationState = {
      version: 1,
      commits: { C1: commitOf("C1", null, "first version", S1), C2: commitOf("C2", "C1", "A ahead", SA) },
      machines: { A: machineRepo(SA, SA, "C2", null, ["C1", "C2"]), B: UNINITIALIZED_B },
      remote: { mainHead: "C1", knownCommitIds: ["C1"] },
      nextCommitNumber: 3,
    };
    const transition = run(fixture, pull("A"));
    expect(transition).toMatchObject({ outcome: "success", changed: true, code: "FETCHED_UP_TO_DATE", transfer: null, affectedCommitIds: [] });
    expect(transition.nextState.machines.A).toEqual(machineRepo(SA, SA, "C2", "C1", ["C1", "C2"]));
    expect(transition.nextState.remote).toEqual({ mainHead: "C1", knownCommitIds: ["C1"] });
    expect(transition.nextState.nextCommitNumber).toBe(3);
  });
});

describe("GIT-06 — validation and no-op", () => {
  it("rejects an empty commit message first and keeps the counter", () => {
    const initial = createInitialGitState();
    for (const message of ["", "   ", "\n"]) {
      const transition = run(initial, commitAction("A", message));
      expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "INVALID_MESSAGE" });
      expect(transition.nextState).toBe(initial);
      expect(transition.nextState.nextCommitNumber).toBe(1);
    }
  });
  it("reports NOTHING_STAGED for a valid message on the initial state", () => {
    const transition = run(createInitialGitState(), commitAction("A", "first version"));
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "NOTHING_STAGED" });
  });
  it("reports NO_LOCAL_COMMITS for Push before any commit", () => {
    const transition = run(createInitialGitState(), push("A"));
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "NO_LOCAL_COMMITS", transfer: null });
  });
  it("rejects Clone while GitHub is empty", () => {
    const transition = run(createInitialGitState(), clone);
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "REMOTE_EMPTY", transfer: null });
    expect(transition.nextState.machines.B).toEqual(UNINITIALIZED_B);
  });
  it("rejects every machine action on B before Clone", () => {
    let state = editStageCommit(createInitialGitState(), "A", S1, "first version");
    state = step(state, push("A"), "PUSHED");
    const actions: GitAction[] = [edit("B", S2), stage("B"), commitAction("B", "x"), commitAction("B", ""), push("B"), pull("B")];
    for (const action of actions) {
      const transition = run(state, action);
      expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "NOT_INITIALIZED" });
      expect(transition.nextState.machines.B).toEqual(UNINITIALIZED_B);
    }
  });
  it("rejects a second Clone and keeps B's files", () => {
    let state = afterGit01Step3();
    state = step(state, edit("B", SB), "EDITED");
    const transition = run(state, clone);
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "ALREADY_INITIALIZED", transfer: null });
    expect(transition.nextState.machines.B).toEqual(machineRepo(SB, S1, "C1", "C1", ["C1"]));
  });
  it("treats Stage of an already staged snapshot and identical edits as NO_CHANGE", () => {
    let state = step(createInitialGitState(), edit("A", S1), "EDITED");
    state = step(state, stage("A"), "STAGED");
    expect(run(state, stage("A"))).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE" });
    expect(run(state, edit("A", S1))).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE" });
    // The name is trimmed before comparison.
    expect(run(state, edit("A", { name: "  index.html  ", content: S1.content }))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
  });
  it("reports NO_CHANGE for Push/Pull that change nothing (no history, no animation)", () => {
    const state = afterGit01Step3();
    for (const action of [push("A"), pull("A"), pull("B"), push("B")]) {
      const transition = run(state, action);
      expect(transition).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE", transfer: null, affectedCommitIds: [] });
      expect(transition.nextState).toBe(state);
    }
  });
  it("records a rename in the new commit and keeps the old name in the parent", () => {
    let state = editStageCommit(createInitialGitState(), "A", S1, "first version");
    state = step(state, edit("A", { name: "lesson.html", content: S1.content }), "EDITED");
    expect(hasUnstaged(state, "A")).toBe(true);
    state = step(state, stage("A"), "STAGED");
    state = step(state, commitAction("A", "เปลี่ยนชื่อไฟล์"), "COMMITTED");
    expect(state.commits.C2).toEqual(commitOf("C2", "C1", "เปลี่ยนชื่อไฟล์", { name: "lesson.html", content: "<h1>รุ่นหนึ่ง</h1>\n" }));
    expect(state.commits.C1.snapshot).toEqual({ name: "index.html", content: "<h1>รุ่นหนึ่ง</h1>\n" });
  });
  it("rejects invalid names and oversized content without truncating", () => {
    const initial = createInitialGitState();
    const invalid: FileSnapshot[] = [
      { name: "src/index.html", content: "x" },
      { name: "src\\index.html", content: "x" },
      { name: "", content: "x" },
      { name: "   ", content: "x" },
      { name: "bad\nname", content: "x" },
      { name: "tab\tname", content: "x" },
      { name: "del\u007Fname", content: "x" },
      { name: "ก".repeat(121), content: "x" },
      { name: "a".repeat(121), content: "x" },
      { name: "index.html", content: "a".repeat(64 * 1024 + 1) },
      { name: "index.html", content: "ก".repeat(21_846) }, // 65 538 UTF-8 bytes
    ];
    for (const file of invalid) {
      const transition = run(initial, { type: "edit", machine: "A", file });
      expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "INVALID_FILE" });
      expect(transition.nextState).toBe(initial);
      expect(transition.nextState.machines.A.working?.name).toBe("main.py");
    }
    const valid: FileSnapshot[] = [
      { name: "ก".repeat(120), content: "x" },
      { name: "😀".repeat(120), content: "x" },
      { name: "index.html", content: "a".repeat(64 * 1024) },
      { name: "index.html", content: "ก".repeat(21_845) }, // 65 535 bytes
      { name: "บทเรียน.html", content: "" },
    ];
    for (const file of valid) {
      const transition = run(initial, { type: "edit", machine: "A", file });
      expect(transition.code).toBe("EDITED");
      expect(transition.nextState.machines.A.working).toEqual(file);
    }
    const trimmed = run(initial, edit("A", { name: "  lesson.html ", content: "  keep spaces  \n" }));
    expect(trimmed.nextState.machines.A.working).toEqual({ name: "lesson.html", content: "  keep spaces  \n" });
  });
  it("validates commit messages by Unicode code points on one line (Thai allowed)", () => {
    const staged = step(step(createInitialGitState(), edit("A", S1), "EDITED"), stage("A"), "STAGED");
    const thai = run(staged, commitAction("A", "  เพิ่มหัวข้อภาษาไทย  "));
    expect(thai.code).toBe("COMMITTED");
    expect(thai.nextState.commits.C1.message).toBe("เพิ่มหัวข้อภาษาไทย");
    expect(run(staged, commitAction("A", "😀".repeat(200))).code).toBe("COMMITTED");
    expect(run(staged, commitAction("A", "ก".repeat(200))).code).toBe("COMMITTED");
    expect(run(staged, commitAction("A", "ก".repeat(201))).code).toBe("INVALID_MESSAGE");
    expect(run(staged, commitAction("A", "line one\nline two")).code).toBe("INVALID_MESSAGE");
    expect(run(staged, commitAction("A", "line one\rline two")).code).toBe("INVALID_MESSAGE");
  });
  it("enforces the 200-commit limit after message and staged checks", () => {
    const commits: Record<string, GitCommit> = {};
    const ids: string[] = [];
    for (let n = 1; n <= 200; n += 1) {
      const id = `C${n}`;
      commits[id] = commitOf(id, n === 1 ? null : `C${n - 1}`, `commit ${n}`, { name: "index.html", content: `v${n}\n` });
      ids.push(id);
    }
    const last: FileSnapshot = { name: "index.html", content: "v200\n" };
    const fixture: GitSimulationState = {
      version: 1, commits,
      machines: { A: machineRepo(last, last, "C200", null, ids), B: UNINITIALIZED_B },
      remote: { mainHead: null, knownCommitIds: [] },
      nextCommitNumber: 201,
    };
    const next: FileSnapshot = { name: "index.html", content: "v201\n" };
    let state = step(fixture, edit("A", next), "EDITED");
    state = step(state, stage("A"), "STAGED");
    expect(run(state, commitAction("A", "")).code).toBe("INVALID_MESSAGE");
    const limited = run(state, commitAction("A", "one more"));
    expect(limited).toMatchObject({ outcome: "rejected", changed: false, code: "COMMIT_LIMIT", transfer: null });
    expect(limited.nextState).toBe(state);
    expect(limited.nextState.machines.A.index).toEqual(next);
    expect(limited.nextState.machines.A.working).toEqual(next);
    expect(limited.nextState.nextCommitNumber).toBe(201);
    expect(Object.keys(limited.nextState.commits)).toHaveLength(200);
    // Nothing staged wins over the limit.
    expect(run(fixture, commitAction("A", "one more")).code).toBe("NOTHING_STAGED");
  });
  it("never mutates a deep-frozen input for any action", () => {
    const states = [createInitialGitState(), afterGit01Step3(), afterGit01Step5()];
    const actions: GitAction[] = [
      edit("A", SA), edit("B", SB), { type: "edit", machine: "A", file: { name: "a/b", content: "" } },
      stage("A"), stage("B"), commitAction("A", "msg"), commitAction("B", "msg"), commitAction("A", ""),
      push("A"), push("B"), clone, pull("A"), pull("B"), { type: "reset" },
    ];
    for (const state of states) {
      deepFreeze(state);
      const before = structuredClone(state);
      for (const action of actions) {
        expect(() => applyGitAction(state, action)).not.toThrow();
        expect(state).toEqual(before);
      }
    }
  });
  it("is deterministic: the same state and action give deep-equal results", () => {
    const state = afterGit01Step5();
    for (const action of [pull("A"), push("B"), commitAction("A", "x"), { type: "reset" } as GitAction]) {
      expect(applyGitAction(state, action)).toEqual(applyGitAction(structuredClone(state), action));
    }
  });
});

describe("Push, Reset and ordering edge cases", () => {
  it("updates only a stale sender tracking when heads are already equal", () => {
    const fixture: GitSimulationState = {
      version: 1,
      commits: { C1: commitOf("C1", null, "first version", S1) },
      machines: { A: machineRepo(S1, S1, "C1", null, ["C1"]), B: UNINITIALIZED_B },
      remote: { mainHead: "C1", knownCommitIds: ["C1"] },
      nextCommitNumber: 2,
    };
    const transition = run(fixture, push("A"));
    expect(transition).toMatchObject({ outcome: "success", changed: true, code: "PUSHED", transfer: null, affectedCommitIds: [] });
    expect(transition.nextState.machines.A).toEqual(machineRepo(S1, S1, "C1", "C1", ["C1"]));
    expect(transition.nextState.remote).toBe(fixture.remote);
    const again = run(transition.nextState, push("A"));
    expect(again).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE" });
  });
  it("pushes with a dirty working file because Push sends commits only", () => {
    let state = editStageCommit(createInitialGitState(), "A", S1, "first version");
    state = step(state, edit("A", SA), "EDITED");
    state = step(state, push("A"), "PUSHED");
    expect(state.machines.A).toEqual(machineRepo(SA, S1, "C1", "C1", ["C1"]));
    expect(state.remote).toEqual({ mainHead: "C1", knownCommitIds: ["C1"] });
  });
  it("rejects Pull while GitHub is empty and leaves tracking untouched", () => {
    const state = editStageCommit(createInitialGitState(), "A", S1, "first version");
    const transition = run(state, pull("A"));
    expect(transition).toMatchObject({ outcome: "rejected", changed: false, code: "REMOTE_EMPTY" });
    expect(transition.nextState.machines.A.originMainHead).toBeNull();
  });
  it("sorts known IDs numerically (C10 after C2) when transferring many commits", () => {
    let state = createInitialGitState();
    for (let n = 1; n <= 11; n += 1) state = editStageCommit(state, "A", { name: "index.html", content: `v${n}\n` }, `commit ${n}`);
    const pushed = run(state, push("A"));
    const expected = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"];
    expect(pushed.nextState.remote.knownCommitIds).toEqual(expected);
    expect(pushed.affectedCommitIds).toEqual(expected);
    expect(pushed.transfer?.commitIds).toEqual(expected);
    const cloned = run(pushed.nextState, clone);
    expect(cloned.nextState.machines.B.knownCommitIds).toEqual(expected);
    expect(cloned.nextState.machines.B.working).toEqual({ name: "index.html", content: "v11\n" });
    expect(knownCommitsNewestFirst(cloned.nextState, "B").map((item) => item.id).slice(0, 3)).toEqual(["C11", "C10", "C9"]);
  });
  it("resets to the exact initial JSON and treats an already-initial state as NO_CHANGE", () => {
    const state = afterGit01Step5();
    const reset = run(state, { type: "reset" });
    expect(reset).toMatchObject({ outcome: "success", changed: true, code: "RESET", transfer: null, affectedCommitIds: [] });
    expect(reset.nextState).toEqual(INITIAL_JSON);
    expect(reset.nextState.nextCommitNumber).toBe(1);
    const again = run(reset.nextState, { type: "reset" });
    expect(again).toMatchObject({ outcome: "noop", changed: false, code: "NO_CHANGE" });
    // Key order does not matter for "already initial".
    const reordered = JSON.parse(JSON.stringify({ nextCommitNumber: 1, remote: INITIAL_JSON.remote, machines: INITIAL_JSON.machines, commits: {}, version: 1 })) as GitSimulationState;
    expect(run(reordered, { type: "reset" }).code).toBe("NO_CHANGE");
    // An edited working file is a real change.
    const edited = step(createInitialGitState(), edit("A", S1), "EDITED");
    expect(run(edited, { type: "reset" }).code).toBe("RESET");
  });
  it("describes results in Thai with the commit IDs", () => {
    let state = step(createInitialGitState(), edit("A", S1), "EDITED");
    state = step(state, stage("A"), "STAGED");
    const committed = applyGitAction(state, commitAction("A", "first version"));
    expect(describeGitTransition(commitAction("A", "first version"), committed)).toContain("สร้าง C1 บนเครื่อง A แล้ว");
    const pushed = applyGitAction(committed.nextState, push("A"));
    expect(describeGitTransition(push("A"), pushed)).toContain("ส่ง C1 ขึ้น GitHub แล้ว");
    const b = editStageCommit(afterGit01Step3(), "B", S2, "update on B");
    const bCommit = applyGitAction(step(step(afterGit01Step3(), edit("B", S2), "EDITED"), stage("B"), "STAGED"), commitAction("B", "update on B"));
    expect(describeGitTransition(commitAction("B", "update on B"), bCommit)).toContain("สร้าง C2 บนเครื่อง B แล้ว");
    expect(describeGitTransition(push("B"), applyGitAction(b, push("B")))).toContain("ส่ง C2 ขึ้น GitHub แล้ว");
  });
});

describe("GIT-07 — resolve a diverged history", () => {
  const merge = (machine: "A" | "B", keep: "ours" | "theirs"): GitAction => ({ type: "merge", machine, keep });
  const resetToRemote = (machine: "A" | "B"): GitAction => ({ type: "resetToRemote", machine });

  /** A committed C3 while B pushed C2; A's Pull fetched C2 and reported the divergence. */
  function divergedA(): GitSimulationState {
    let state = editStageCommit(afterGit01Step5(), "A", SA, "A change");
    state = step(state, push("A"), "NON_FAST_FORWARD");
    return step(state, pull("A"), "DIVERGED");
  }

  it("merges with two parents, keeps our file, and then Push is accepted", () => {
    const state = divergedA();
    const merged = run(state, merge("A", "ours"));
    expect(merged).toMatchObject({ outcome: "success", changed: true, code: "MERGED", affectedCommitIds: ["C4"], transfer: null });
    const next = merged.nextState;
    expect(next.commits.C4).toEqual({ id: "C4", parentId: "C3", mergeParentId: "C2", message: "Merge งานจาก GitHub (ใช้ไฟล์ของเรา)", snapshot: SA });
    expect(next.machines.A).toEqual(machineRepo(SA, SA, "C4", "C2", ["C1", "C2", "C3", "C4"]));
    expect(aheadBehind(next, "A")).toEqual({ ahead: 2, behind: 0 });
    expect(isAncestor("C2", "C4", next.machines.A.knownCommitIds, next.commits)).toBe(true);
    expect(ancestorsOf("C4", next.machines.A.knownCommitIds, next.commits)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(describeGitTransition(merge("A", "ours"), merged)).toBe("สร้าง C4 รวมประวัติกับ C2 ของ GitHub แล้ว (เก็บไฟล์ของเรา) กด Push ได้เลย");

    const pushed = run(next, push("A"));
    expect(pushed).toMatchObject({ code: "PUSHED", transfer: { from: "A", to: "remote", commitIds: ["C3", "C4"] } });
    expect(pushed.nextState.remote).toEqual({ mainHead: "C4", knownCommitIds: ["C1", "C2", "C3", "C4"] });

    // B fast-forwards to the merge commit and receives A's side too.
    const pulled = run(pushed.nextState, pull("B"));
    expect(pulled).toMatchObject({ code: "PULLED", transfer: { from: "remote", to: "B", commitIds: ["C3", "C4"] } });
    expect(pulled.nextState.machines.B).toEqual(machineRepo(SA, SA, "C4", "C4", ["C1", "C2", "C3", "C4"]));
  });

  it("can keep GitHub's file instead", () => {
    const merged = run(divergedA(), merge("A", "theirs"));
    expect(merged.nextState.commits.C4).toMatchObject({ parentId: "C3", mergeParentId: "C2", message: "Merge งานจาก GitHub (ใช้ไฟล์จาก GitHub)", snapshot: S2 });
    expect(merged.nextState.machines.A).toEqual(machineRepo(S2, S2, "C4", "C2", ["C1", "C2", "C3", "C4"]));
    expect(describeGitTransition(merge("A", "theirs"), merged)).toContain("เก็บไฟล์จาก GitHub");
  });

  it("refuses to merge when not diverged, with unsaved work, or before any fetch", () => {
    expect(run(afterGit01Step5(), merge("B", "ours"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE", changed: false });
    // Behind only: Pull fast-forwards that, Merge has nothing to do.
    expect(run(afterGit01Step5(), merge("A", "ours"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
    const dirty = step(divergedA(), edit("A", SB), "EDITED");
    const blocked = run(dirty, merge("A", "ours"));
    expect(blocked).toMatchObject({ outcome: "rejected", code: "DIRTY_WORKTREE", changed: false });
    expect(describeGitTransition(merge("A", "ours"), blocked)).toBe("Commit งานที่ค้างก่อน Merge");
    const neverFetched = editStageCommit(createInitialGitState(), "A", S1, "only local");
    expect(run(neverFetched, merge("A", "ours"))).toMatchObject({ outcome: "rejected", code: "REMOTE_EMPTY" });
    expect(run(createInitialGitState(), merge("B", "ours"))).toMatchObject({ outcome: "rejected", code: "NOT_INITIALIZED" });
  });

  it("uses GitHub's version: drops local commits and edits, keeps the fetched history", () => {
    const dirty = step(divergedA(), edit("A", SB), "EDITED");
    const reset = run(dirty, resetToRemote("A"));
    expect(reset).toMatchObject({ outcome: "success", changed: true, code: "RESET_TO_REMOTE", affectedCommitIds: ["C2"], transfer: null });
    expect(reset.nextState.machines.A).toEqual(machineRepo(S2, S2, "C2", "C2", ["C1", "C2"]));
    expect(reset.nextState.commits.C3).toBeDefined(); // still in the registry; Undo shows it again
    expect(aheadBehind(reset.nextState, "A")).toEqual({ ahead: 0, behind: 0 });
    expect(describeGitTransition(resetToRemote("A"), reset)).toBe("เครื่อง A ทิ้งงานของตัวเองแล้ว ใช้เวอร์ชันของ GitHub (main = C2) ย้อนกลับด้วย Undo ได้");
    expect(run(reset.nextState, resetToRemote("A"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
    expect(run(editStageCommit(createInitialGitState(), "A", S1, "x"), resetToRemote("A"))).toMatchObject({ outcome: "rejected", code: "REMOTE_EMPTY" });
  });
});

// ---------------------------------------------------------------------------
// GIT-09 — branches
// ---------------------------------------------------------------------------

const switchTo = (name: string): GitAction => ({ type: "branchSwitch", machine: "A", name });
const create = (name: string): GitAction => ({ type: "branchCreate", machine: "A", name });
const mergeBranch = (name: string, keep?: "ours" | "theirs"): GitAction => ({ type: "branchMerge", machine: "A", name, ...(keep ? { keep } : {}) });
const deleteBranch = (name: string): GitAction => ({ type: "branchDelete", machine: "A", name });
const F = (content: string): FileSnapshot => ({ name: "index.html", content });
const repoA = (state: GitSimulationState) => state.machines.A;
const filler = (from: number, count: number): Record<string, GitCommit> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`C${from + i}`, commitOf(`C${from + i}`, null, "x", F("x\n"))]));

/** main: C1 "base"; feature: C2 "feature work" (HEAD on feature). */
function onFeature(): GitSimulationState {
  let state = editStageCommit(createInitialGitState(), "A", F("base\n"), "base");
  state = step(state, create("feature"), "BRANCH_CREATED");
  return editStageCommit(state, "A", F("feature work\n"), "feature work");
}

describe("GIT-09 — branches", () => {
  it("creates a branch at the current commit, switches onto it, and commits advance only that branch", () => {
    let state = editStageCommit(createInitialGitState(), "A", F("base\n"), "base");
    const created = run(state, create("feature"));
    expect(created).toMatchObject({ outcome: "success", changed: true, code: "BRANCH_CREATED", affectedCommitIds: ["C1"] });
    state = created.nextState;
    expect(repoA(state)).toMatchObject({ mainHead: "C1", head: "feature", branches: { feature: "C1" } });
    expect(describeGitTransition(create("feature"), created)).toContain("HEAD → feature");

    const committed = run(step(step(state, edit("A", F("feature work\n")), "EDITED"), stage("A"), "STAGED"), commitAction("A", "feature work"));
    state = committed.nextState;
    expect(repoA(state)).toMatchObject({ mainHead: "C1", head: "feature", branches: { feature: "C2" } });
    expect(state.commits.C2.parentId).toBe("C1");
    expect(describeGitTransition(commitAction("A", "feature work"), committed)).toBe("สร้าง C2 บน branch feature แล้ว (main ยังเหมือนเดิม)");
  });

  it("switching replaces the working file and Staging with the target tip", () => {
    let state = onFeature();
    state = step(state, switchTo("main"), "SWITCHED");
    expect(repoA(state)).toMatchObject({ mainHead: "C1", working: F("base\n"), index: F("base\n") });
    expect(repoA(state).head).toBeUndefined();
    expect(repoA(state).branches).toEqual({ feature: "C2" });
    state = step(state, switchTo("feature"), "SWITCHED");
    expect(repoA(state)).toMatchObject({ head: "feature", working: F("feature work\n"), index: F("feature work\n") });
    expect(run(state, switchTo("feature"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
    expect(run(state, switchTo("nope"))).toMatchObject({ outcome: "rejected", code: "BRANCH_NOT_FOUND" });
  });

  it("refuses to switch with an unadded edit or something staged, and says why", () => {
    const edited = step(onFeature(), edit("A", F("scribble\n")), "EDITED");
    const refused = run(edited, switchTo("main"));
    expect(refused).toMatchObject({ outcome: "rejected", changed: false, code: "DIRTY_WORKTREE" });
    expect(describeGitTransition(switchTo("main"), refused)).toContain("Commit งานที่ค้างก่อนสลับ branch");
    const staged = step(edited, stage("A"), "STAGED");
    expect(run(staged, switchTo("main"))).toMatchObject({ outcome: "rejected", code: "DIRTY_WORKTREE" });
  });

  it("refuses to branch before the first commit, and validates names", () => {
    const empty = createInitialGitState();
    const refused = run(empty, create("feature"));
    expect(refused).toMatchObject({ outcome: "rejected", code: "NEED_COMMIT_FOR_BRANCH" });
    expect(describeGitTransition(create("feature"), refused)).toBe("ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch");
    const state = editStageCommit(empty, "A", F("a\n"), "a");
    for (const name of ["", "   ", "has space", "ก", "HEAD", "__proto__", "x".repeat(41), "a:b"]) {
      expect(run(state, create(name)), name).toMatchObject({ outcome: "rejected", code: "INVALID_BRANCH_NAME" });
    }
    expect(run(state, create("main"))).toMatchObject({ outcome: "rejected", code: "BRANCH_EXISTS" });
    expect(run(state, create("x".repeat(40)))).toMatchObject({ outcome: "success" });
    expect(repoA(run(state, create("  feature/x-1.2_y  ")).nextState).head).toBe("feature/x-1.2_y");
    let many = state;
    for (let i = 1; i <= 20; i++) many = step(many, create(`b${i}`), "BRANCH_CREATED");
    expect(run(many, create("one-too-many"))).toMatchObject({ outcome: "rejected", code: "BRANCH_LIMIT" });
  });

  it("fast-forwards when the current branch is an ancestor: pointer and file move, no new commit", () => {
    const state = step(onFeature(), switchTo("main"), "SWITCHED");
    const merged = run(state, mergeBranch("feature"));
    expect(merged).toMatchObject({ outcome: "success", code: "FAST_FORWARDED", affectedCommitIds: ["C2"] });
    expect(Object.keys(merged.nextState.commits)).toHaveLength(Object.keys(state.commits).length);
    expect(repoA(merged.nextState)).toMatchObject({ mainHead: "C2", working: F("feature work\n"), index: F("feature work\n") });
    expect(describeGitTransition(mergeBranch("feature"), merged)).toContain("Fast-forward");
    expect(run(merged.nextState, mergeBranch("feature"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
  });

  it("says Already up to date when the other branch is an ancestor of the current one", () => {
    const state = step(onFeature(), switchTo("main"), "SWITCHED");
    const ahead = editStageCommit(state, "A", F("main moved on\n"), "main moved on"); // C3; feature (C2) is not an ancestor
    expect(run(ahead, mergeBranch("feature"))).toMatchObject({ outcome: "rejected", code: "MERGE_CONFLICT" });
    const merged = step(state, mergeBranch("feature"), "FAST_FORWARDED");
    const noop = run(merged, mergeBranch("feature"));
    expect(noop).toMatchObject({ outcome: "noop", changed: false });
    expect(describeGitTransition(mergeBranch("feature"), noop)).toContain("Already up to date");
    expect(run(merged, mergeBranch("main"))).toMatchObject({ outcome: "rejected", code: "SAME_BRANCH" });
    // the other direction: main contains the (unchanged) branch tip
    const untouched = step(editStageCommit(createInitialGitState(), "A", F("a\n"), "a"), create("early"), "BRANCH_CREATED");
    const main = editStageCommit(step(untouched, switchTo("main"), "SWITCHED"), "A", F("b\n"), "b");
    expect(run(main, mergeBranch("early"))).toMatchObject({ outcome: "noop", code: "NO_CHANGE" });
  });

  it("true merge commit with two parents, taking the file of the only side that changed it", () => {
    let state = onFeature(); // C1 base, C2 feature work (changed)
    state = step(state, switchTo("main"), "SWITCHED");
    state = editStageCommit(state, "A", F("temp\n"), "temp"); // C3
    state = editStageCommit(state, "A", F("base\n"), "back to base"); // C4: same file as the common ancestor C1
    expect(planBranchMerge(state, "A", "feature")).toBe("merge");
    const merged = run(state, mergeBranch("feature"));
    expect(merged).toMatchObject({ outcome: "success", code: "BRANCH_MERGED", affectedCommitIds: ["C5"] });
    const next = merged.nextState;
    expect(next.commits.C5).toEqual({ id: "C5", parentId: "C4", mergeParentId: "C2", message: "Merge branch 'feature'", snapshot: F("feature work\n") });
    expect(repoA(next)).toMatchObject({ mainHead: "C5", working: F("feature work\n"), index: F("feature work\n"), branches: { feature: "C2" } });
    expect(repoA(next).knownCommitIds).toEqual(["C1", "C2", "C3", "C4", "C5"]);
    expect(describeGitTransition(mergeBranch("feature"), merged)).toContain("merge commit");
  });

  it("conflict: both sides changed the file differently, so ours/theirs is required and both tips become the parents", () => {
    let state = step(onFeature(), switchTo("main"), "SWITCHED");
    state = editStageCommit(state, "A", F("main work\n"), "main work"); // C3
    expect(planBranchMerge(state, "A", "feature")).toBe("conflict");
    const refused = run(state, mergeBranch("feature"));
    expect(refused).toMatchObject({ outcome: "rejected", changed: false, code: "MERGE_CONFLICT" });
    expect(describeGitTransition(mergeBranch("feature"), refused)).toContain("ชนกัน");

    const ours = run(state, mergeBranch("feature", "ours"));
    expect(ours).toMatchObject({ outcome: "success", code: "BRANCH_MERGED" });
    expect(ours.nextState.commits.C4).toMatchObject({ parentId: "C3", mergeParentId: "C2", snapshot: F("main work\n") });
    expect(repoA(ours.nextState)).toMatchObject({ mainHead: "C4", working: F("main work\n"), index: F("main work\n") });

    const theirs = run(state, mergeBranch("feature", "theirs"));
    expect(theirs.nextState.commits.C4).toMatchObject({ parentId: "C3", mergeParentId: "C2", snapshot: F("feature work\n") });
    expect(repoA(theirs.nextState).working).toEqual(F("feature work\n"));
    expect(describeGitTransition(mergeBranch("feature", "theirs"), theirs)).toContain("ของ feature");

    // both sides converged on the same file: nothing to choose
    const same = editStageCommit(step(onFeature(), switchTo("main"), "SWITCHED"), "A", F("feature work\n"), "same change");
    expect(planBranchMerge(same, "A", "feature")).toBe("merge");
    expect(run(same, mergeBranch("feature"))).toMatchObject({ outcome: "success", code: "BRANCH_MERGED" });
  });

  it("refuses to merge from a dirty tree and when the branch is missing, and respects the commit limit", () => {
    const state = step(onFeature(), switchTo("main"), "SWITCHED");
    expect(run(step(state, edit("A", F("wip\n")), "EDITED"), mergeBranch("feature"))).toMatchObject({ outcome: "rejected", code: "DIRTY_WORKTREE" });
    expect(run(state, mergeBranch("nope"))).toMatchObject({ outcome: "rejected", code: "BRANCH_NOT_FOUND" });
    const diverged = editStageCommit(state, "A", F("main work\n"), "main work");
    const full: GitSimulationState = { ...diverged, commits: { ...diverged.commits, ...filler(50, 197) }, nextCommitNumber: 300 };
    expect(Object.keys(full.commits)).toHaveLength(200);
    expect(run(full, mergeBranch("feature", "ours"))).toMatchObject({ outcome: "rejected", code: "COMMIT_LIMIT" });
  });

  it("the commit limit also applies to commits on a branch", () => {
    const state = onFeature();
    const full: GitSimulationState = { ...state, commits: { ...state.commits, ...filler(50, 198) }, nextCommitNumber: 300 };
    const edited = step(step(full, edit("A", F("more\n")), "EDITED"), stage("A"), "STAGED");
    expect(run(edited, commitAction("A", "too many"))).toMatchObject({ outcome: "rejected", code: "COMMIT_LIMIT" });
  });

  it("deletes only a merged, non-current branch; its commits stay in the history; state is canonical again", () => {
    let state = step(onFeature(), switchTo("main"), "SWITCHED");
    expect(run(state, deleteBranch("feature"))).toMatchObject({ outcome: "rejected", code: "BRANCH_NOT_MERGED" });
    expect(run(state, deleteBranch("main"))).toMatchObject({ outcome: "rejected", code: "CANNOT_DELETE_BRANCH" });
    expect(run(state, deleteBranch("nope"))).toMatchObject({ outcome: "rejected", code: "BRANCH_NOT_FOUND" });
    state = step(state, mergeBranch("feature"), "FAST_FORWARDED");
    const deleted = run(state, deleteBranch("feature"));
    expect(deleted).toMatchObject({ outcome: "success", code: "BRANCH_DELETED" });
    expect(deleted.nextState.commits.C2).toBeDefined();
    expect("branches" in repoA(deleted.nextState)).toBe(false);
    expect("head" in repoA(deleted.nextState)).toBe(false);
    const current = step(onFeature(), create("other"), "BRANCH_CREATED");
    expect(run(current, deleteBranch("other"))).toMatchObject({ outcome: "rejected", code: "CANNOT_DELETE_BRANCH" });
  });

  it("works on old states without branch fields: only main, HEAD on main", () => {
    const old = editStageCommit(createInitialGitState(), "A", F("a\n"), "a");
    expect("branches" in repoA(old)).toBe(false);
    expect("head" in repoA(old)).toBe(false);
    expect(currentBranch(repoA(old))).toBe("main");
    expect(run(old, switchTo("main"))).toMatchObject({ outcome: "noop" });
    expect(run(old, deleteBranch("main"))).toMatchObject({ code: "CANNOT_DELETE_BRANCH" });
    expect(run(old, mergeBranch("main"))).toMatchObject({ code: "SAME_BRANCH" });
    expect(applyGitAction(onFeature(), { type: "reset" }).nextState).toEqual(createInitialGitState());
  });

  it("Push, Pull, Resolve and Reset-to-GitHub work on main only: off main they are refused with a clear message", () => {
    const state = onFeature();
    for (const action of [push("A"), pull("A"), { type: "merge", machine: "A", keep: "ours" } as GitAction, { type: "resetToRemote", machine: "A" } as GitAction]) {
      const refused = run(state, action);
      expect(refused, action.type).toMatchObject({ outcome: "rejected", changed: false, code: "NOT_ON_MAIN" });
      expect(describeGitTransition(action, refused)).toContain("main");
    }
  });

  it("Push sends main only: an unmerged branch stays local, a merged one goes with main", () => {
    let state = step(onFeature(), switchTo("main"), "SWITCHED");
    expect(run(state, push("A")).nextState.remote).toEqual({ mainHead: "C1", knownCommitIds: ["C1"] });
    state = step(state, mergeBranch("feature"), "FAST_FORWARDED");
    expect(run(state, push("A")).nextState.remote).toEqual({ mainHead: "C2", knownCommitIds: ["C1", "C2"] });
  });
});

describe("GIT-09 — branch selectors and schema", () => {
  it("suggests feature, feature-2, … and validates names", () => {
    let state = editStageCommit(createInitialGitState(), "A", F("a\n"), "a");
    expect(suggestBranchName(repoA(state))).toBe("feature");
    state = step(state, create("feature"), "BRANCH_CREATED");
    expect(suggestBranchName(repoA(state))).toBe("feature-2");
    expect(validateBranchName(repoA(state), "feature")).toEqual({ ok: false, error: "branch-exists" });
    expect(validateBranchName(repoA(state), " ok-1 ")).toEqual({ ok: true, name: "ok-1" });
    expect(validateBranchName(repoA(state), "bad name")).toEqual({ ok: false, error: "branch-invalid-character" });
    expect(currentBranch(repoA(state))).toBe("feature");
    expect(branchNames(repoA(state))).toEqual(["main", "feature"]);
    expect(planBranchMerge(state, "A", "main")).toBe("up-to-date");
  });

  it("the document schema rejects broken branch data", () => {
    const base = onFeature();
    const parse = (state: GitSimulationState) => {
      const content = createProjectContent("บทเรียน Git");
      content.document.slides[0].nodes.push({ id: "0c8b0f3e-6f4a-4c1e-8a57-5b0f7c2d9e10", type: "git-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "branch", state });
      return () => parseProjectContent(JSON.parse(JSON.stringify(content)));
    };
    expect(parse(base)()).toBeDefined();
    const withA = (patch: Partial<MachineRepository>): GitSimulationState => ({ ...base, machines: { ...base.machines, A: { ...base.machines.A, ...patch } } });
    expect(parse(withA({ head: "ghost" }))).toThrow();
    expect(parse(withA({ head: "main" }))).toThrow();
    expect(parse(withA({ branches: { HEAD: "C1" } }))).toThrow();
    expect(parse(withA({ branches: { "bad name": "C1" } }))).toThrow();
    expect(parse(withA({ branches: { feature: "C9" } }))).toThrow();
    expect(parse(withA({ branches: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`b${i}`, "C1"])) }))).toThrow();
  });
});

describe("persisted schema accepts every reducer output", () => {
  it("parses each produced state wrapped in a git-simulator node", () => {
    expect(produced.length).toBeGreaterThan(50);
    const unique = [...new Set(produced)];
    for (const state of unique) {
      const content = createProjectContent("บทเรียน Git");
      const node: GitSimulatorNode = {
        id: "0c8b0f3e-6f4a-4c1e-8a57-5b0f7c2d9e10", type: "git-simulator",
        x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, state,
      };
      content.document.slides[0].nodes.push(node);
      const parsed = parseProjectContent(JSON.parse(JSON.stringify(content)));
      const parsedNode = parsed.document.slides[0].nodes[0];
      expect(parsedNode.type === "git-simulator" && parsedNode.state).toEqual(state);
    }
  });
});
