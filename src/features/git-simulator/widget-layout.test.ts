import { describe, expect, it } from "vitest";
import { gitBaseSize, type GitView } from "../../domain/document/model";
import { revealForParts } from "../../domain/document/reveal";
import type { GitAction } from "../../domain/git/model";
import { gitActionParts, gitCommitsPart, gitMachineParts, gitParts, gitTransferPart, remoteRequestBox, GIT_VIEWS, gitViewList, viewHasRemote, viewRepositories, widgetLayout, widgetWidth, WIDGET_H, type Box } from "./widget-layout";

const inside = (box: Box, outer: Box) => box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w && box.y + box.h <= outer.y + outer.h;
const frameOf = (view: "local" | "remote" | "full" | "branch"): Box => ({ x: 0, y: 0, w: widgetWidth(view), h: WIDGET_H });

describe("Git widget layout per lesson step", () => {
  it.each(["local", "remote", "full", "branch"] as const)("%s: every card and column stays inside the fixed frame without overlapping", (view) => {
    const layout = widgetLayout(view);
    const frame = frameOf(view);
    const machines = [layout.A, layout.B].filter((item) => item !== null);
    for (const machine of machines) {
      expect(inside(machine.card, frame)).toBe(true);
      expect(inside(machine.file, machine.card)).toBe(true);
      expect(inside(machine.git, machine.card)).toBe(true);
      // File on the left, Git on the right, with room for the Stage arrow between them.
      expect(machine.file.x + machine.file.w).toBeLessThan(machine.git.x);
      expect(machine.stageGap.x2 - machine.stageGap.x1).toBeGreaterThanOrEqual(36);
    }
    if (layout.remote) expect(inside(layout.remote, frame)).toBe(true);
    const cards = [layout.A.card, layout.remote, layout.B?.card].filter((item): item is Box => Boolean(item)).sort((a, b) => a.x - b.x);
    for (let index = 1; index < cards.length; index++) expect(cards[index - 1].x + cards[index - 1].w).toBeLessThan(cards[index].x);
    expect(layout.pushY).toBeLessThan(layout.pullY);
    expect(layout.pullY).toBeLessThan(layout.A.card.y + layout.A.card.h);
  });

  it("shows only the repositories of each step", () => {
    expect(viewRepositories("local")).toEqual(["A"]);
    expect(viewRepositories("remote")).toEqual(["A", "remote"]);
    expect(viewRepositories("full")).toEqual(["A", "remote", "B"]);
    expect(viewRepositories("branch")).toEqual(["A"]);
    expect(widgetLayout("branch")).toMatchObject({ view: "branch", remote: null, B: null, left: null, right: null, compact: false });
    expect(viewHasRemote("branch")).toBe(false);
    expect(viewHasRemote("local")).toBe(false);
    expect(viewHasRemote("remote") && viewHasRemote("full")).toBe(true);
    expect(GIT_VIEWS.map((item) => item.id)).toEqual(["local", "remote", "full", "branch", "review"]);
    expect(GIT_VIEWS[3].label).toBe("Branch (ทางแยก)");
    expect(GIT_VIEWS[4].label).toBe("Pull Request (ทีม)");
    expect(gitViewList("gitlab")[4].label).toBe("Merge Request (ทีม)");
    expect(viewRepositories("review")).toEqual(["A", "remote", "B"]);
    expect(viewHasRemote("review")).toBe(true);
    expect(gitBaseSize("review")).toEqual({ width: 1600, height: 680 });
    // The remote's name follows the GitHub / GitLab switch.
    expect(GIT_VIEWS[1].label).toBe("A → Git → GitHub");
    expect(gitViewList("gitlab").map((item) => item.label)).toEqual(["A → Git", "A → Git → GitLab", "A+Git → GitLab → B+Git", "Branch (ทางแยก)", "Merge Request (ทีม)"]);
    expect(gitViewList("gitlab")[1].description).toContain("GitLab");
    expect(gitViewList("gitlab").some((item) => item.label.includes("GitHub") || item.description.includes("GitHub"))).toBe(false);
    expect(gitBaseSize("branch")).toEqual({ width: 1120, height: 680 });
    expect(widgetLayout("local")).toMatchObject({ remote: null, B: null, left: null, right: null, compact: false });
    expect(widgetLayout("remote").right).toBeNull();
    // The two-machine step is wider so each machine keeps the full-size layout (no compact columns).
    expect(widgetLayout("full").compact).toBe(false);
    expect(gitBaseSize("full")).toEqual({ width: 1600, height: 680 });
    expect(gitBaseSize("local")).toEqual({ width: 1120, height: 680 });
  });

  it("gives the single-machine step large file and Git columns", () => {
    const local = widgetLayout("local");
    expect(local.A.file.w).toBeGreaterThanOrEqual(440);
    expect(local.A.git.w).toBeGreaterThanOrEqual(440);
    expect(widgetLayout("full").A.git.w).toBeGreaterThanOrEqual(230);
    expect(widgetLayout("full").A.file.w).toBeGreaterThanOrEqual(230);
  });
});

describe("overlay geometry", () => {
  it("places the code area inside the file column and commit rows inside the commit list", async () => {
    const { fileCodeBox, fileEditorBox, commitListBox, commitRowBox, commitRowLimit, fileNameBox, codeText, remoteCodeBox, remoteCodeText, remoteFileBox } = await import("./widget-layout");
    for (const view of ["local", "remote", "full", "branch"] as const) {
      const layout = widgetLayout(view);
      const editor = fileEditorBox(layout, "A")!;
      const code = fileCodeBox(layout, "A")!;
      const tab = fileNameBox(layout, "A")!;
      expect(inside(editor, layout.A.file)).toBe(true);
      expect(inside(code, editor)).toBe(true);
      expect(inside(tab, editor)).toBe(true);
      // Tab bar sits directly above the code; the code area has room for several lines.
      expect(tab.y + tab.h).toBe(code.y);
      expect(Math.floor((code.h - 2 * codeText(layout).pad) / codeText(layout).lineH)).toBeGreaterThanOrEqual(10);
      const list = commitListBox(layout, "A")!;
      expect(inside(list, layout.A.git)).toBe(true);
      expect(commitRowLimit(layout, "A")).toBeGreaterThanOrEqual(6);
      if (layout.remote) expect(inside(commitListBox(layout, "remote")!, layout.remote)).toBe(true);
      // Every row the drawing shows has a click target inside its list.
      for (const repository of ["A", "remote"] as const) {
        const limit = commitRowLimit(layout, repository);
        if (!limit) continue;
        expect(inside(commitRowBox(layout, repository, limit - 1)!, commitListBox(layout, repository)!)).toBe(true);
      }
      if (layout.remote) {
        const file = remoteFileBox(layout)!;
        expect(inside(file, layout.remote)).toBe(true);
        expect(inside(remoteCodeBox(layout)!, file)).toBe(true);
        expect(file.y + file.h).toBeLessThan(commitListBox(layout, "remote")!.y);
        // Several lines of the pushed file and at least five commits fit on the GitHub card.
        const text = remoteCodeText(layout);
        expect(Math.floor((remoteCodeBox(layout)!.h - 2 * text.pad) / text.lineH)).toBeGreaterThanOrEqual(6);
        expect(commitRowLimit(layout, "remote")).toBeGreaterThanOrEqual(5);
      }
    }
    // Review lesson: the Merge Request card sits between the remote's file and its commit list, all inside the card.
    const review = widgetLayout("review");
    const request = remoteRequestBox(review)!;
    expect(inside(request, review.remote!)).toBe(true);
    expect(remoteFileBox(review)!.y + remoteFileBox(review)!.h).toBeLessThan(request.y);
    expect(request.y + request.h).toBeLessThan(commitListBox(review, "remote")!.y);
    expect(commitRowLimit(review, "remote")).toBeGreaterThanOrEqual(3);
    expect(remoteRequestBox(widgetLayout("full"))).toBeNull();
    expect(fileCodeBox(widgetLayout("local"), "B")).toBeNull();
    expect(commitListBox(widgetLayout("local"), "remote")).toBeNull();
  });
});

describe("reveal parts (plan 07 §2)", () => {
  const VIEWS: GitView[] = ["local", "remote", "full", "branch", "review"];
  const ids = (view: GitView) => gitParts(view).map((part) => part.id);

  it("each step lists its ordered parts", () => {
    expect(ids("local")).toEqual(["a.file", "a.git"]);
    expect(ids("remote")).toEqual(["a.file", "a.git", "remote"]);
    expect(ids("full")).toEqual(["a.file", "a.git", "remote", "b.file", "b.git"]);
    expect(ids("review")).toEqual(["a.file", "a.git", "remote", "b.file", "b.git", "request"]);
    expect(ids("branch")).toEqual(["a.file", "a.stage", "a.commits"]);
  });
  it.each(VIEWS)("%s: 2–6 parts with unique ids and Thai labels; the host name is used", (view) => {
    const parts = gitParts(view, "gitlab");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(6);
    expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
    for (const part of parts) expect(part.label).toMatch(/\S/);
    if (view !== "local" && view !== "branch") expect(parts.some((part) => part.label.includes("GitLab"))).toBe(true);
    if (view === "review") expect(parts.at(-1)?.label).toBe("การ์ด Merge Request");
    if (view === "full") expect(parts.some((part) => part.label.includes("GitHub"))).toBe(false);
  });
  it("every repository drawn in a step has its commit list in a listed part; machines have file and git parts", () => {
    for (const view of VIEWS) {
      for (const repository of viewRepositories(view)) expect(ids(view), `${view} ${repository}`).toContain(gitCommitsPart(view, repository));
      for (const machine of ["A", "B"] as const) {
        if (!widgetLayout(view)[machine]) continue;
        const parts = gitMachineParts(view, machine);
        expect(ids(view)).toEqual(expect.arrayContaining([parts.file, parts.stage, parts.commits]));
        expect(ids(view).indexOf(parts.file)).toBeLessThan(ids(view).indexOf(parts.stage));
      }
    }
  });
  it("arrows come with the later of their two parts", () => {
    expect(gitTransferPart("remote", "A", "remote")).toBe("remote");
    expect(gitTransferPart("full", "remote", "A")).toBe("remote");
    expect(gitTransferPart("full", "B", "remote")).toBe("b.file");
    expect(gitTransferPart("review", "remote", "B")).toBe("b.file");
    expect(gitTransferPart("local", "A", "remote")).toBeNull();
    expect(gitTransferPart("remote", "B", "remote")).toBeNull();
  });

  // Typed over every action: adding an action type without a sample here is a compile error.
  const SAMPLES: Record<GitAction["type"], GitAction> = {
    edit: { type: "edit", machine: "A", file: { name: "a.txt", content: "x" } }, stage: { type: "stage", machine: "A" }, commit: { type: "commit", machine: "A", message: "m" },
    push: { type: "push", machine: "A" }, clone: { type: "clone", machine: "B" }, pull: { type: "pull", machine: "A" },
    mrOpen: { type: "mrOpen", machine: "A" }, mrApprove: { type: "mrApprove", machine: "B", id: 1 }, mrMerge: { type: "mrMerge", machine: "A", id: 1 },
    mergeTake: { type: "mergeTake", machine: "A", side: "ours" }, mergeAbort: { type: "mergeAbort", machine: "A" }, resetToRemote: { type: "resetToRemote", machine: "A" },
    branchCreate: { type: "branchCreate", machine: "A", name: "x" }, branchSwitch: { type: "branchSwitch", machine: "A", name: "x" },
    branchMerge: { type: "branchMerge", machine: "A", name: "x" }, branchDelete: { type: "branchDelete", machine: "A", name: "x" }, reset: { type: "reset" },
  };
  it("every action maps to parts; ids outside the step are ignored when revealing; reset needs none", () => {
    expect(Object.keys(SAMPLES).length).toBeGreaterThanOrEqual(17);
    for (const [type, action] of Object.entries(SAMPLES)) {
      expect(action.type).toBe(type);
      if (type !== "reset") expect(gitActionParts("full", action).length, type).toBeGreaterThan(0);
      for (const view of VIEWS) expect(revealForParts(gitParts(view), 0, gitActionParts(view, action)), `${view} ${type}`).toBeLessThanOrEqual(gitParts(view).length);
    }
    expect(gitActionParts("full", SAMPLES.reset)).toEqual([]);
  });
  it("what each action reveals (counts are in part order)", () => {
    const need = (view: GitView, action: GitAction) => revealForParts(gitParts(view), 0, gitActionParts(view, action));
    expect(need("local", SAMPLES.edit)).toBe(1);
    expect(need("local", SAMPLES.stage)).toBe(2);
    expect(need("local", SAMPLES.commit)).toBe(2);
    expect(need("remote", SAMPLES.push)).toBe(3);
    expect(need("remote", SAMPLES.pull)).toBe(3);
    expect(need("full", SAMPLES.push)).toBe(3);
    expect(need("full", SAMPLES.clone)).toBe(5);
    expect(need("full", { type: "push", machine: "B" })).toBe(5);
    expect(need("full", SAMPLES.reset)).toBe(0);
    expect(need("branch", SAMPLES.stage)).toBe(2);
    expect(need("branch", SAMPLES.commit)).toBe(3);
    expect(need("branch", SAMPLES.branchCreate)).toBe(3);
    expect(need("review", SAMPLES.mrOpen)).toBe(6);
    expect(need("review", SAMPLES.push)).toBe(3);
  });
  it("planted omission: an action that forgot the remote would not show the GitHub card", () => {
    const forgetful = revealForParts(gitParts("remote"), 0, ["a.git"]);
    expect(forgetful).toBeLessThan(revealForParts(gitParts("remote"), 0, gitActionParts("remote", SAMPLES.push))!);
  });
});
