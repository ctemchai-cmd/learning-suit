import { describe, expect, it } from "vitest";
import { createInitialGitState } from "../../domain/git/initial";
import { applyGitAction } from "../../domain/git/reducer";
import type { FileSnapshot, GitAction, GitSimulationState } from "../../domain/git/model";
import {
  INVALID_DRAFT_REASON, READ_ONLY_REASON, codeLines, getActionAvailability, getBranchAvailability, nextBranchStep, nextGitStep, previewLines, projectState, truncateCodePoints,
} from "./view-model";

const S1: FileSnapshot = { name: "index.html", content: "<h1>รุ่นหนึ่ง</h1>\n" };
const SA: FileSnapshot = { name: "index.html", content: "<h1>งานต่อของ A</h1>\n" };

function play(state: GitSimulationState, ...actions: GitAction[]): GitSimulationState {
  return actions.reduce((current, action) => {
    const transition = applyGitAction(current, action);
    expect(transition.outcome).toBe("success");
    return transition.nextState;
  }, state);
}

const committedA = () => play(createInitialGitState(),
  { type: "edit", machine: "A", file: S1 }, { type: "stage", machine: "A" }, { type: "commit", machine: "A", message: "first version" });

describe("text helpers", () => {
  it("truncates by code points with an ellipsis inside the limit", () => {
    expect(truncateCodePoints("abc", 28)).toBe("abc");
    expect(truncateCodePoints("ก".repeat(28), 28)).toBe("ก".repeat(28));
    expect(truncateCodePoints("ก".repeat(29), 28)).toBe(`${"ก".repeat(27)}…`);
    expect([...truncateCodePoints("😀".repeat(40), 28)]).toHaveLength(28);
  });
  it("previews the first three lines, each at most 28 code points", () => {
    const initial = createInitialGitState().machines.A.working!;
    expect(previewLines(initial.content)).toEqual({ lines: ["print(\"Hello World\")"], totalLines: 1 });
    expect(previewLines("a\nb\nc\nd\ne\n")).toEqual({ lines: ["a", "b", "c"], totalLines: 5 });
    expect(previewLines("a\tb\r\n")).toEqual({ lines: ["a  b"], totalLines: 1 });
    expect(previewLines("")).toEqual({ lines: [], totalLines: 0 });
    const long = previewLines(`${"x".repeat(40)}\n`);
    expect([...long.lines[0]]).toHaveLength(28);
  });
});

describe("action availability from the projected state", () => {
  it("enables Stage immediately for a draft typed after Commit, but Commit still reads the real index", () => {
    const state = committedA();
    const withoutDraft = getActionAvailability({ state, machine: "A", draft: null, message: "next", writable: true });
    expect(withoutDraft.stage.enabled).toBe(false);
    expect(withoutDraft.pull.reasons).toEqual(["GitHub ยังไม่มี commit ให้ Pull"]);

    const draft = getActionAvailability({ state, machine: "A", draft: SA, message: "next", writable: true });
    expect(draft.stage.enabled).toBe(true);
    expect(draft.commit.enabled).toBe(false);
    expect(draft.commit.reasons).toContain("ยังไม่มีการเปลี่ยนแปลงที่ Add ไว้ ให้กด Add ก่อน");
    expect(draft.pull.reasons).toContain("โหมดจำลองนี้ให้ Commit งานที่ค้างก่อน Pull");
    expect(draft.push.enabled).toBe(true);
  });
  it("treats a rename-only draft as a change", () => {
    const state = committedA();
    const rename = getActionAvailability({ state, machine: "A", draft: { name: "lesson.html", content: S1.content }, message: "", writable: true });
    expect(rename.stage.enabled).toBe(true);
    const same = getActionAvailability({ state, machine: "A", draft: { name: " index.html ", content: S1.content }, message: "", writable: true });
    expect(same.stage.enabled).toBe(false);
  });
  it("blocks every flushing action while the draft is invalid or the project is read-only", () => {
    const state = committedA();
    const invalid = getActionAvailability({ state, machine: "A", draft: { name: "a/b", content: "" }, message: "x", writable: true });
    for (const key of ["stage", "commit", "push", "pull", "reset"] as const) {
      expect(invalid[key].enabled).toBe(false);
      expect(invalid[key].reasons).toContain(INVALID_DRAFT_REASON);
    }
    const readOnly = getActionAvailability({ state, machine: "A", draft: null, message: "x", writable: false });
    expect(readOnly.push.reasons).toEqual([READ_ONLY_REASON]);
  });
  it("explains Commit and Clone preconditions", () => {
    const initial = createInitialGitState();
    const a = getActionAvailability({ state: initial, machine: "A", draft: null, message: "", writable: true });
    expect(a.commit.reasons).toEqual(["พิมพ์ข้อความ Commit ก่อน", "ยังไม่มีการเปลี่ยนแปลงที่ Add ไว้ ให้กด Add ก่อน"]);
    const b = getActionAvailability({ state: initial, machine: "B", draft: null, message: "", writable: true });
    expect(b.clone).toEqual({ enabled: false, reasons: ["GitHub ยังไม่มี commit ให้ Clone ให้เครื่อง A Push ก่อน"] });
    const pushed = play(committedA(), { type: "push", machine: "A" });
    expect(getActionAvailability({ state: pushed, machine: "B", draft: null, message: "", writable: true }).clone.enabled).toBe(true);
  });
  it("projects without mutating the document state", () => {
    const state = committedA();
    const projection = projectState(state, "A", { name: " x.html ", content: "y" });
    expect(projection.ok && projection.state.machines.A.working).toEqual({ name: "x.html", content: "y" });
    expect(state.machines.A.working).toEqual(S1);
    const invalid = projectState(state, "A", { name: "", content: "y" });
    expect(invalid.ok).toBe(false);
    expect(invalid.state).toBe(state);
  });
});

describe("drawn code editor lines", () => {
  it("numbers every line like the textarea, including a trailing empty one", () => {
    expect(codeLines("print(\"Hello World\")\n", 10, 40)).toEqual({ lines: ["print(\"Hello World\")", ""], more: 0 });
    expect(codeLines("", 10, 40)).toEqual({ lines: [""], more: 0 });
    expect(codeLines("a\tb\r\nc", 10, 40)).toEqual({ lines: ["a    b", "c"], more: 0 });
  });
  it("keeps the last row for the count of hidden lines and cuts long lines", () => {
    expect(codeLines("1\n2\n3\n4\n5", 3, 40)).toEqual({ lines: ["1", "2"], more: 3 });
    expect(codeLines("1\n2\n3", 3, 40).more).toBe(0);
    expect([...codeLines("x".repeat(50), 3, 10).lines[0]]).toHaveLength(10);
  });
});

describe("next step highlighted in the panel", () => {
  const next = (state: GitSimulationState, withRemote = true, draft: FileSnapshot | null = null, machine: "A" | "B" = "A") =>
    nextGitStep(projectState(state, machine, draft).state, machine, getActionAvailability({ state, machine, draft, message: "", writable: true }), withRemote);
  it("walks Add → Commit → Push, and Pull when behind", () => {
    const initial = createInitialGitState();
    expect(next(initial)).toBe("stage");
    const added = play(initial, { type: "stage", machine: "A" });
    expect(next(added)).toBe("commit");
    const committed = play(added, { type: "commit", machine: "A", message: "one" });
    expect(next(committed, false)).toBeNull();
    expect(next(committed)).toBe("push");
    expect(next(committed, true, SA)).toBe("stage");
    const pushed = play(committed, { type: "push", machine: "A" }, { type: "clone", machine: "B" });
    expect(next(pushed)).toBeNull();
    const bAhead = play(pushed, { type: "edit", machine: "B", file: SA }, { type: "stage", machine: "B" }, { type: "commit", machine: "B", message: "b" }, { type: "push", machine: "B" });
    expect(next(bAhead)).toBeNull(); // A does not know about B's push until it pulls (tracking is local)
    expect(next(bAhead, true, null, "B")).toBeNull();
  });
});

describe("Branch step", () => {
  const A = (action: Omit<GitAction, "machine"> & { type: GitAction["type"] }) => ({ ...action, machine: "A" }) as GitAction;
  const edit = (content: string) => A({ type: "edit", file: { name: "index.html", content } } as never);
  const commit = (content: string, message: string): GitAction[] => [edit(content), A({ type: "stage" }), A({ type: "commit", message } as never)];
  const create = (name: string) => A({ type: "branchCreate", name } as never);
  const switchTo = (name: string) => A({ type: "branchSwitch", name } as never);
  const merge = (name: string, keep?: "ours" | "theirs") => A({ type: "branchMerge", name, keep } as never);
  const avail = (state: GitSimulationState, name = "x", draft: FileSnapshot | null = null, writable = true) => getBranchAvailability({ state, machine: "A", draft, name, writable });
  const next = (state: GitSimulationState) => nextBranchStep(state, "A", getActionAvailability({ state, machine: "A", draft: null, message: "", writable: true }));

  it("create needs a commit and a valid, unused name; switch and delete follow the dirty/merged rules", () => {
    const empty = createInitialGitState();
    expect(avail(empty, "feature").create).toEqual({ enabled: false, reasons: ["ต้อง commit อย่างน้อยหนึ่งครั้งก่อนแตก branch"] });
    const base = play(empty, ...commit("base\n", "base"));
    expect(avail(base, "feature").create.enabled).toBe(true);
    expect(avail(base, "").nameError).toBe("พิมพ์ชื่อ branch ก่อน");
    expect(avail(base, "bad name").create.enabled).toBe(false);
    expect(avail(base, "main").nameError).toBe("มี branch ชื่อนี้อยู่แล้ว");
    expect(avail(base, "feature", null, false).create.reasons).toContain(READ_ONLY_REASON);

    const onFeature = play(base, create("feature"), ...commit("feature\n", "feature work"));
    const view = avail(onFeature);
    expect(view.current).toBe("feature");
    expect(view.others.map((row) => [row.name, row.plan, row.switch.enabled, row.merge.enabled, row.delete.enabled])).toEqual([["main", "up-to-date", true, false, false]]);
    expect(view.others[0].delete.reasons).toEqual(["main ลบไม่ได้"]);

    // an unsaved board draft counts as dirty for switching
    const dirty = avail(onFeature, "x", { name: "index.html", content: "scribble\n" });
    expect(dirty.others[0].switch).toEqual({ enabled: false, reasons: ["Commit งานที่ค้างก่อนสลับ branch (ไม่เช่นนั้นงานที่ยังไม่ Commit จะหาย)"] });
    expect(avail(play(onFeature, edit("wip\n")), "x").others[0].switch.enabled).toBe(false);

    const onMain = play(onFeature, switchTo("main"));
    const row = avail(onMain).others[0];
    expect(row).toMatchObject({ name: "feature", plan: "fast-forward", switch: { enabled: true }, merge: { enabled: true } });
    expect(row.delete).toEqual({ enabled: false, reasons: ["ยังมีงานที่ยังไม่ได้ Merge เข้า main"] });
    const merged = play(onMain, merge("feature"));
    expect(avail(merged).others[0]).toMatchObject({ plan: "up-to-date", merge: { enabled: false }, delete: { enabled: true } });
  });

  it("flags a conflict and Push/Pull reasons off main", () => {
    const state = play(createInitialGitState(), ...commit("base\n", "base"), create("feature"), ...commit("f\n", "f"), switchTo("main"), ...commit("m\n", "m"));
    expect(avail(state).others[0].plan).toBe("conflict");
    const away = play(state, switchTo("feature"));
    const availability = getActionAvailability({ state: away, machine: "A", draft: null, message: "", writable: true });
    expect(availability.push.reasons.join(" ")).toContain("ไม่ได้อยู่ที่ main");
    expect(availability.pull.enabled).toBe(false);
  });

  it("suggests create → edit/add/commit → switch to main → merge", () => {
    const initial = createInitialGitState();
    expect(next(initial)?.step).toBe("stage");
    const base = play(initial, ...commit("base\n", "base"));
    expect(next(base)).toEqual({ step: "create", branch: null });
    const fresh = play(base, create("feature"));
    expect(next(fresh)).toBeNull(); // on the new branch: edit the file next
    expect(next(play(fresh, edit("f\n")))?.step).toBe("stage");
    expect(next(play(fresh, edit("f\n"), A({ type: "stage" })))?.step).toBe("commit");
    const worked = play(fresh, ...commit("f\n", "f"));
    expect(next(worked)).toEqual({ step: "switch", branch: "main" });
    const back = play(worked, switchTo("main"));
    expect(next(back)).toEqual({ step: "mergeBranch", branch: "feature" });
    expect(next(play(back, merge("feature")))).toBeNull();
  });
});
