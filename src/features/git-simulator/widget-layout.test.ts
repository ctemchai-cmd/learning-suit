import { describe, expect, it } from "vitest";
import { gitBaseSize } from "../../domain/document/model";
import { viewRepositories, widgetLayout, widgetWidth, WIDGET_H, type Box } from "./widget-layout";

const inside = (box: Box, outer: Box) => box.x >= outer.x && box.y >= outer.y && box.x + box.w <= outer.x + outer.w && box.y + box.h <= outer.y + outer.h;
const frameOf = (view: "local" | "remote" | "full"): Box => ({ x: 0, y: 0, w: widgetWidth(view), h: WIDGET_H });

describe("Git widget layout per lesson step", () => {
  it.each(["local", "remote", "full"] as const)("%s: every card and column stays inside the fixed frame without overlapping", (view) => {
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
    for (const view of ["local", "remote", "full"] as const) {
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
    expect(fileCodeBox(widgetLayout("local"), "B")).toBeNull();
    expect(commitListBox(widgetLayout("local"), "remote")).toBeNull();
  });
});
