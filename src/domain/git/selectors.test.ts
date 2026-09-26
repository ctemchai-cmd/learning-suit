import { describe, expect, it } from "vitest";
import { createInitialGitState } from "./initial";
import {
  aheadBehind, ancestorsOf, codePointLength, compareCommitIds, hasStaged, hasUnstaged, headSnapshot, isAncestor, isClean,
  jsonEqual, knownCommitsNewestFirst, snapshotsEqual, sortCommitIds, utf8ByteLength, validateCommitMessage, validateFileSnapshot,
} from "./selectors";
import type { GitCommit, GitSimulationState } from "./model";

const file = (content: string) => ({ name: "index.html", content });
const commit = (id: string, parentId: string | null): GitCommit => ({ id, parentId, message: id, snapshot: file(`${id}\n`) });

// C1 ← C2 ← C4 (A) and C1 ← C3 (remote/B): two branches of history in one registry.
const commits: Record<string, GitCommit> = {
  C1: commit("C1", null), C2: commit("C2", "C1"), C3: commit("C3", "C1"), C4: commit("C4", "C2"),
};

function divergedState(): GitSimulationState {
  return {
    version: 1,
    commits,
    machines: {
      A: { initialized: true, working: file("C4\n"), index: file("C4\n"), mainHead: "C4", originMainHead: "C1", knownCommitIds: ["C1", "C2", "C4"] },
      B: { initialized: true, working: file("C3\n"), index: file("C3\n"), mainHead: "C3", originMainHead: "C3", knownCommitIds: ["C1", "C3"] },
    },
    remote: { mainHead: "C3", knownCommitIds: ["C1", "C3"] },
    nextCommitNumber: 5,
  };
}

describe("snapshot selectors", () => {
  it("compares name and content exactly without trimming", () => {
    expect(snapshotsEqual(file("a"), file("a"))).toBe(true);
    expect(snapshotsEqual(file("a"), file("a "))).toBe(false);
    expect(snapshotsEqual(file("a"), { name: "lesson.html", content: "a" })).toBe(false);
    expect(snapshotsEqual(null, null)).toBe(true);
    expect(snapshotsEqual(file("a"), null)).toBe(false);
  });
  it("derives unstaged/staged/clean from working, index and HEAD", () => {
    const initial = createInitialGitState();
    expect(headSnapshot(initial, initial.machines.A)).toBeNull();
    expect(hasUnstaged(initial, "A")).toBe(true);
    expect(hasStaged(initial, "A")).toBe(false);
    expect(isClean(initial, "A")).toBe(false);
    expect(isClean(initial, "B")).toBe(true);

    const state = divergedState();
    expect(headSnapshot(state, state.machines.A)).toEqual(file("C4\n"));
    expect(isClean(state, "A")).toBe(true);
    const staged: GitSimulationState = { ...state, machines: { ...state.machines, A: { ...state.machines.A, working: file("x"), index: file("x") } } };
    expect(hasStaged(staged, "A")).toBe(true);
    expect(hasUnstaged(staged, "A")).toBe(false);
  });
});

describe("commit ordering and ancestry", () => {
  it("orders commit IDs numerically", () => {
    expect(sortCommitIds(["C10", "C2", "C1", "C2"])).toEqual(["C1", "C2", "C10"]);
    expect(compareCommitIds("C10", "C9")).toBeGreaterThan(0);
  });
  it("walks parents only inside the known set", () => {
    expect(isAncestor(null, "C4", [], commits)).toBe(true);
    expect(isAncestor(null, null, [], commits)).toBe(true);
    expect(isAncestor("C1", null, ["C1"], commits)).toBe(false);
    expect(isAncestor("C4", "C4", ["C4"], commits)).toBe(true);
    expect(isAncestor("C1", "C4", ["C1", "C2", "C4"], commits)).toBe(true);
    expect(isAncestor("C3", "C4", ["C1", "C2", "C3", "C4"], commits)).toBe(false);
    // C1 is an ancestor globally, but the walk may not pass through the unknown C2.
    expect(isAncestor("C1", "C4", ["C1", "C4"], commits)).toBe(false);
    // A head that is not known reveals nothing.
    expect(isAncestor("C1", "C3", ["C1"], commits)).toBe(false);
  });
  it("collects ancestors within the known set, sorted", () => {
    expect(ancestorsOf("C4", ["C1", "C2", "C4"], commits)).toEqual(["C1", "C2", "C4"]);
    expect(ancestorsOf("C3", new Set(["C1", "C3"]), commits)).toEqual(["C1", "C3"]);
    expect(ancestorsOf("C3", ["C1"], commits)).toEqual([]);
    expect(ancestorsOf(null, ["C1"], commits)).toEqual([]);
  });
  it("computes ahead/behind only from what the machine knows", () => {
    const state = divergedState();
    // A tracks C1 and does not know C3: ahead 2, behind 0 (no secret knowledge of GitHub).
    expect(aheadBehind(state, "A")).toEqual({ ahead: 2, behind: 0 });
    expect(aheadBehind(state, "B")).toEqual({ ahead: 0, behind: 0 });
    const fetched: GitSimulationState = {
      ...state,
      machines: { ...state.machines, A: { ...state.machines.A, originMainHead: "C3", knownCommitIds: ["C1", "C2", "C3", "C4"] } },
    };
    expect(aheadBehind(fetched, "A")).toEqual({ ahead: 2, behind: 1 });
    expect(aheadBehind(createInitialGitState(), "A")).toBeNull();
    expect(aheadBehind(createInitialGitState(), "B")).toBeNull();
  });
  it("lists only the repository's known commits, newest first", () => {
    const state = divergedState();
    expect(knownCommitsNewestFirst(state, "A").map((item) => item.id)).toEqual(["C4", "C2", "C1"]);
    expect(knownCommitsNewestFirst(state, "remote").map((item) => item.id)).toEqual(["C3", "C1"]);
  });
});

describe("validators", () => {
  it("counts code points and UTF-8 bytes like the platform encoder", () => {
    for (const sample of ["", "abc", "สวัสดี", "😀x", "é", "\uD800"]) {
      expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).length);
    }
    expect(codePointLength("😀😀")).toBe(2);
    expect(codePointLength("สวัสดี")).toBe(6);
  });
  it("trims file names, keeps content verbatim and reports the failing field", () => {
    expect(validateFileSnapshot({ name: " a.html ", content: " x \n" })).toEqual({ ok: true, file: { name: "a.html", content: " x \n" } });
    expect(validateFileSnapshot({ name: "", content: "" })).toEqual({ ok: false, field: "name", error: "name-empty" });
    expect(validateFileSnapshot({ name: "x".repeat(121), content: "" })).toEqual({ ok: false, field: "name", error: "name-too-long" });
    expect(validateFileSnapshot({ name: "a/b", content: "" })).toEqual({ ok: false, field: "name", error: "name-invalid-character" });
    expect(validateFileSnapshot({ name: "a\u0085b", content: "" })).toEqual({ ok: false, field: "name", error: "name-invalid-character" });
    expect(validateFileSnapshot({ name: "a", content: "x".repeat(65_537) })).toEqual({ ok: false, field: "content", error: "content-too-large" });
  });
  it("trims commit messages and rejects empty, long and multi-line ones", () => {
    expect(validateCommitMessage("  แก้หัวข้อ  ")).toEqual({ ok: true, message: "แก้หัวข้อ" });
    expect(validateCommitMessage(" ")).toEqual({ ok: false, error: "message-empty" });
    expect(validateCommitMessage("a\nb")).toEqual({ ok: false, error: "message-newline" });
    expect(validateCommitMessage("a\u2028b")).toEqual({ ok: false, error: "message-newline" });
    expect(validateCommitMessage("x".repeat(201))).toEqual({ ok: false, error: "message-too-long" });
  });
  it("compares JSON values independent of key order", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});
