import { describe, expect, it } from "vitest";
import { createInitialGitState } from "../../domain/git/initial";
import { applyGitAction } from "../../domain/git/reducer";
import type { FileSnapshot, GitAction, GitSimulationState } from "../../domain/git/model";
import {
  INVALID_DRAFT_REASON, READ_ONLY_REASON, codeLines, getActionAvailability, getBranchAvailability, getRequestAvailability, nextReviewStep, nextBranchStep, nextGitStep, previewLines, projectState, truncateCodePoints,
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

describe("merging (conflict) state and the GitHub / GitLab switch", () => {
  const base = "a\nb\nc\nd\ne\n";
  const edit = (machine: "A" | "B", content: string): GitAction[] => [
    { type: "edit", machine, file: { name: "f.txt", content } }, { type: "stage", machine }, { type: "commit", machine, message: "m" },
  ];
  /** B and A change the same line: A's Pull stops on a conflict. */
  function conflicted(): GitSimulationState {
    let state = play(createInitialGitState(), ...edit("A", base), { type: "push", machine: "A" }, { type: "clone", machine: "B" });
    state = play(state, ...edit("B", "a\nB\nc\nd\ne\n"), { type: "push", machine: "B" }, ...edit("A", "a\nA\nc\nd\ne\n"));
    return play(state, { type: "pull", machine: "A" });
  }
  const input = (state: GitSimulationState, extra: Partial<Parameters<typeof getActionAvailability>[0]> = {}) =>
    ({ state, machine: "A" as const, draft: null, message: "Merge origin/main", writable: true, ...extra });

  it("Push / Pull are blocked while merging, the merge buttons are enabled, and Commit says why it cannot run yet", () => {
    const availability = getActionAvailability(input(conflicted()));
    expect(availability.push.reasons).toContain("กำลัง merge อยู่: แก้ไฟล์ให้เสร็จแล้ว Add + Commit หรือกด “ยกเลิก merge” ก่อน");
    expect(availability.pull.enabled).toBe(false);
    expect(availability.mergeAbort).toEqual({ enabled: true, reasons: [] });
    expect(availability.mergeTake.enabled).toBe(true);
    expect(availability.commit.enabled).toBe(false);
    expect(availability.commit.reasons.join(" ")).toContain("ยังมีเครื่องหมาย conflict เหลืออยู่");
    // Not merging: the merge buttons explain themselves.
    expect(getActionAvailability(input(committedA())).mergeAbort.reasons).toContain("ตอนนี้ไม่ได้อยู่ระหว่าง merge");
  });

  it("a fixed file that is not added yet asks for Add; once added Commit is enabled even if the file equals HEAD", () => {
    let state = conflicted();
    const fixedDraft = { name: "f.txt", content: "a\nA\nc\nd\ne\n" };
    expect(getActionAvailability(input(state, { draft: fixedDraft })).commit.reasons.join(" ")).toContain("กด Add ก่อน Commit");
    expect(nextGitStep(projectState(state, "A", fixedDraft).state, "A", getActionAvailability(input(state, { draft: fixedDraft })), true)).toBe("stage");
    state = play(state, { type: "mergeTake", machine: "A", side: "ours" }, { type: "stage", machine: "A" });
    const availability = getActionAvailability(input(state));
    expect(availability.commit).toEqual({ enabled: true, reasons: [] });
    expect(nextGitStep(state, "A", availability, true)).toBe("commit");
  });

  it("ทำต่อ guidance: edit the file while markers remain, then Add, then Commit", () => {
    let state = conflicted();
    expect(nextGitStep(state, "A", getActionAvailability(input(state)), true)).toBe("resolve");
    expect(nextBranchStep(state, "A", getActionAvailability(input(state)))).toEqual({ step: "resolve", branch: null });
    state = play(state, { type: "mergeTake", machine: "A", side: "theirs" });
    expect(nextGitStep(state, "A", getActionAvailability(input(state)), true)).toBe("stage");
  });

  it("branch buttons are blocked while merging", () => {
    const state = conflicted();
    const branches = getBranchAvailability({ state, machine: "A", draft: null, name: "other", writable: true });
    expect(branches.create.enabled).toBe(false);
    expect(branches.create.reasons).toContain("กำลัง merge อยู่: แก้ไฟล์ให้เสร็จแล้ว Add + Commit หรือกด “ยกเลิก merge” ก่อน");
  });

  it("reasons name the chosen site", () => {
    const empty = createInitialGitState();
    const clone = (host?: "github" | "gitlab") => getActionAvailability({ state: empty, machine: "B", draft: null, message: "", writable: true, host }).clone.reasons.join(" ");
    expect(clone()).toContain("GitHub ยังไม่มี commit ให้ Clone");
    expect(clone("github")).toContain("GitHub ยังไม่มี commit ให้ Clone");
    expect(clone("gitlab")).toContain("GitLab ยังไม่มี commit ให้ Clone");
    expect(clone("gitlab")).not.toContain("GitHub");
    const pull = (host?: "github" | "gitlab") => getActionAvailability({ state: committedA(), machine: "A", draft: null, message: "", writable: true, host }).pull.reasons.join(" ");
    expect(pull("gitlab")).toBe("GitLab ยังไม่มี commit ให้ Pull");
  });
});

describe("Merge Request lesson guidance", () => {
  const f = (content: string): FileSnapshot => ({ name: "f.txt", content });
  const base = "a\nb\nc\nd\ne\n";
  const edit = (machine: "A" | "B", content: string): GitAction[] => [{ type: "edit", machine, file: f(content) }, { type: "stage", machine }, { type: "commit", machine, message: "m" }];
  const pushR = (machine: "A" | "B"): GitAction => ({ type: "push", machine, review: true });
  const next = (state: GitSimulationState, machine: "A" | "B") =>
    nextReviewStep(state, machine, getActionAvailability({ state, machine, draft: null, message: "m", writable: true, review: true }));
  const sw = (name: string): GitAction => ({ type: "branchSwitch", machine: "A", name });

  it("walks the whole loop: first push → branch → commit → push branch → open → approve → merge → switch main → pull", () => {
    let state = play(createInitialGitState(), ...edit("A", base));
    expect(next(state, "A")).toEqual({ step: "push", branch: null }); // the project's first push
    state = play(state, pushR("A"), { type: "clone", machine: "B" });
    expect(next(state, "A")).toEqual({ step: "create", branch: null });
    state = play(state, { type: "branchCreate", machine: "A", name: "feature" });
    expect(next(state, "A")).toBeNull(); // on the branch with nothing of its own: edit the file
    state = play(state, ...edit("A", "A\nb\nc\nd\ne\n"));
    expect(next(state, "A")).toEqual({ step: "push", branch: null });
    state = play(state, pushR("A"));
    expect(next(state, "A")).toEqual({ step: "openMr", branch: null });
    state = play(state, { type: "mrOpen", machine: "A" });
    expect(next(state, "A")).toBeNull(); // waiting for the teammate
    expect(next(state, "B")).toEqual({ step: "approve", branch: null, id: 1 });
    state = play(state, { type: "mrApprove", machine: "B", id: 1 });
    expect(next(state, "B")).toEqual({ step: "mergeMr", branch: null, id: 1 });
    expect(next(state, "A")).toEqual({ step: "mergeMr", branch: null, id: 1 });
    state = play(state, { type: "mrMerge", machine: "A", id: 1 });
    expect(next(state, "A")).toEqual({ step: "switch", branch: "main" });
    state = play(state, sw("main"));
    expect(next(state, "A")).toEqual({ step: "pull", branch: null });
    expect(next(state, "B")).toEqual({ step: "pull", branch: null });
    state = play(state, { type: "pull", machine: "A", review: true }, { type: "pull", machine: "B", review: true });
    expect(next(state, "A")).toEqual({ step: "create", branch: null }); // ready for the next change
  });

  it("a conflicting request sends its author back to the branch to pull main in", () => {
    let state = play(createInitialGitState(), ...edit("A", base), pushR("A"), { type: "clone", machine: "B" });
    state = play(state, { type: "branchCreate", machine: "A", name: "one" }, ...edit("A", "X\nb\nc\nd\ne\n"), pushR("A"), sw("main"));
    state = play(state, { type: "branchCreate", machine: "A", name: "two" }, ...edit("A", "Y\nb\nc\nd\ne\n"), pushR("A"), { type: "mrOpen", machine: "A" });
    state = play(state, sw("one"), { type: "mrOpen", machine: "A" }, { type: "mrApprove", machine: "B", id: 1 }, { type: "mrApprove", machine: "B", id: 2 }, { type: "mrMerge", machine: "B", id: 1 });
    // !2 (branch "one") now conflicts with main; A is on "one" and pulls main in
    expect(next(state, "A")).toEqual({ step: "pull", branch: null });
    expect(next(state, "B")).toBeNull();
    state = play(state, sw("two"));
    expect(next(state, "A")).toEqual({ step: "switch", branch: "one" });
    state = play(state, sw("one"), { type: "pull", machine: "A", review: true });
    expect(next(state, "A")).toEqual({ step: "resolve", branch: null });
  });

  it("request buttons carry the reducer's reason, and Push / Pull are not blocked on a branch in the review lesson", () => {
    let state = play(createInitialGitState(), ...edit("A", base), pushR("A"), { type: "clone", machine: "B" });
    state = play(state, { type: "branchCreate", machine: "A", name: "feature" }, ...edit("A", "A\nb\nc\nd\ne\n"));
    const on = { state, machine: "A" as const, draft: null, message: "m", writable: true };
    expect(getActionAvailability({ ...on, review: true }).push.enabled).toBe(true);
    expect(getActionAvailability({ ...on, review: true }).pull.enabled).toBe(true);
    expect(getActionAvailability(on).push.reasons.join(" ")).toContain("ไม่ได้อยู่ที่ main");
    expect(getRequestAvailability({ ...on, id: null }).open.reasons.join(" ")).toContain("ต้อง Push branch ขึ้น GitHub ก่อนเปิด Pull Request");
    expect(getRequestAvailability({ ...on, id: null, host: "gitlab" }).open.reasons.join(" ")).toContain("เปิด Merge Request");
    state = play(state, pushR("A"), { type: "mrOpen", machine: "A" });
    const mine = getRequestAvailability({ state, machine: "A", writable: true, id: 1 });
    expect(mine.open.enabled).toBe(false);
    expect(mine.approve.reasons.join(" ")).toContain("อนุมัติ Pull Request ของตัวเองไม่ได้");
    expect(mine.merge.reasons.join(" ")).toContain("ต้องมีคนอนุมัติ");
    const theirs = getRequestAvailability({ state, machine: "B", writable: true, id: 1 });
    expect(theirs.approve).toEqual({ enabled: true, reasons: [] });
    expect(getRequestAvailability({ state, machine: "B", writable: false, id: 1 }).approve.enabled).toBe(false);
  });
});
