import { describe, expect, it } from "vitest";
import { conflictLineRoles, hasConflictMarkers, mergeCommitMessage, mergeFiles, mergeText, splitLines } from "./merge3";

// Expected texts are written out by hand from how `git merge` behaves (diff3), not computed with the code under test.
const L = { ours: "HEAD (ของเรา)", theirs: "feature" };
const merge = (base: string, ours: string, theirs: string) => mergeText(base, ours, theirs, L);
const BASE = "a\nb\nc\nd\ne\n";

describe("mergeText — changes on one side are taken by themselves", () => {
  it("takes their change when only they changed the file", () => {
    expect(merge(BASE, BASE, "a\nB\nc\nd\ne\n")).toEqual({ content: "a\nB\nc\nd\ne\n", conflicts: 0 });
  });
  it("takes our change when only we changed the file", () => {
    expect(merge(BASE, "a\nb\nc\nd\nE\n", BASE)).toEqual({ content: "a\nb\nc\nd\nE\n", conflicts: 0 });
  });
  it("neither side changed anything", () => {
    expect(merge(BASE, BASE, BASE)).toEqual({ content: BASE, conflicts: 0 });
  });
});

describe("mergeText — both sides, different lines", () => {
  it("joins changes that are apart from each other (first line and last line)", () => {
    expect(merge(BASE, "A\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n")).toEqual({ content: "A\nb\nc\nd\nE\n", conflicts: 0 });
  });
  it("joins an insertion in the middle with a deletion at the top", () => {
    expect(merge(BASE, "a\nb\nc\nnew\nd\ne\n", "b\nc\nd\ne\n")).toEqual({ content: "b\nc\nnew\nd\ne\n", conflicts: 0 });
  });
  it("two separate edits on one side and one on the other all survive", () => {
    expect(merge(BASE, "A\nb\nC\nd\ne\n", "a\nb\nc\nd\nE\n")).toEqual({ content: "A\nb\nC\nd\nE\n", conflicts: 0 });
  });
});

describe("mergeText — the same line changed differently is a conflict", () => {
  it("writes Git's markers around the two versions", () => {
    expect(merge(BASE, "a\nOURS\nc\nd\ne\n", "a\nTHEIRS\nc\nd\ne\n")).toEqual({
      content: "a\n<<<<<<< HEAD (ของเรา)\nOURS\n=======\nTHEIRS\n>>>>>>> feature\nc\nd\ne\n",
      conflicts: 1,
    });
  });
  it("adjacent changed lines count as one conflict, like Git", () => {
    expect(merge(BASE, "a\nB\nc\nd\ne\n", "a\nb\nC\nd\ne\n")).toEqual({
      content: "a\n<<<<<<< HEAD (ของเรา)\nB\nc\n=======\nb\nC\n>>>>>>> feature\nd\ne\n",
      conflicts: 1,
    });
  });
  it("two far-apart conflicts give two hunks", () => {
    const result = merge("1\n2\n3\n4\n5\n", "x\n2\n3\n4\ny\n", "p\n2\n3\n4\nq\n");
    expect(result.conflicts).toBe(2);
    expect(result.content).toBe("<<<<<<< HEAD (ของเรา)\nx\n=======\np\n>>>>>>> feature\n2\n3\n4\n<<<<<<< HEAD (ของเรา)\ny\n=======\nq\n>>>>>>> feature\n");
  });
  it("one side deleted a line the other changed: conflict with an empty side", () => {
    expect(merge(BASE, "a\nc\nd\ne\n", "a\nB\nc\nd\ne\n")).toEqual({
      content: "a\n<<<<<<< HEAD (ของเรา)\n=======\nB\n>>>>>>> feature\nc\nd\ne\n",
      conflicts: 1,
    });
  });
  it("lines both versions share inside the hunk stay outside the markers", () => {
    expect(merge("x\nold\ny\n", "x\nnear\nsame\ny\n", "x\nfar\nsame\ny\n")).toEqual({
      content: "x\n<<<<<<< HEAD (ของเรา)\nnear\n=======\nfar\n>>>>>>> feature\nsame\ny\n",
      conflicts: 1,
    });
  });
});

describe("mergeText — identical changes are not a conflict", () => {
  it("the same edit on both sides appears once", () => {
    expect(merge(BASE, "a\nb\nX\nd\ne\n", "a\nb\nX\nd\ne\n")).toEqual({ content: "a\nb\nX\nd\ne\n", conflicts: 0 });
  });
  it("the same deletion on both sides", () => {
    expect(merge(BASE, "a\nc\nd\ne\n", "a\nc\nd\ne\n")).toEqual({ content: "a\nc\nd\ne\n", conflicts: 0 });
  });
});

describe("mergeText — insertions at the end and empty files", () => {
  it("both sides appending different lines is a conflict", () => {
    expect(merge("a\nb\n", "a\nb\nc\n", "a\nb\nd\n")).toEqual({ content: "a\nb\n<<<<<<< HEAD (ของเรา)\nc\n=======\nd\n>>>>>>> feature\n", conflicts: 1 });
  });
  it("only one side appending takes it", () => {
    expect(merge("a\nb\n", "a\nb\n", "a\nb\nc\n")).toEqual({ content: "a\nb\nc\n", conflicts: 0 });
    expect(merge("a\nb\n", "a\nb\nc\n", "a\nb\n")).toEqual({ content: "a\nb\nc\n", conflicts: 0 });
  });
  it("both appending the same line keeps one", () => {
    expect(merge("a\n", "a\nb\n", "a\nb\n")).toEqual({ content: "a\nb\n", conflicts: 0 });
  });
  it("an appended line and a change at the top are joined", () => {
    expect(merge("a\nb\n", "A\nb\n", "a\nb\nc\n")).toEqual({ content: "A\nb\nc\n", conflicts: 0 });
  });
  it("empty base: only one side adds text", () => {
    expect(merge("", "", "hello\n")).toEqual({ content: "hello\n", conflicts: 0 });
    expect(merge("", "hello\n", "")).toEqual({ content: "hello\n", conflicts: 0 });
  });
  it("empty base: both add different text is a conflict, the same text is not", () => {
    expect(merge("", "one\n", "two\n")).toEqual({ content: "<<<<<<< HEAD (ของเรา)\none\n=======\ntwo\n>>>>>>> feature\n", conflicts: 1 });
    expect(merge("", "same\n", "same\n")).toEqual({ content: "same\n", conflicts: 0 });
  });
  it("deleting everything on one side while the other is unchanged gives an empty file", () => {
    expect(merge("a\nb\n", "", "a\nb\n")).toEqual({ content: "", conflicts: 0 });
    expect(merge("a\nb\n", "", "")).toEqual({ content: "", conflicts: 0 });
  });
  it("everything deleted on one side but edited on the other is a conflict", () => {
    expect(merge("a\nb\n", "", "a\nB\n")).toEqual({ content: "<<<<<<< HEAD (ของเรา)\n=======\na\nB\n>>>>>>> feature\n", conflicts: 1 });
  });
  it("a missing final newline follows the side that changed it", () => {
    expect(merge("a\nb\n", "a\nb\n", "a\nb")).toEqual({ content: "a\nb", conflicts: 0 });
    expect(merge("a\nb\n", "a\nb", "a\nb\n")).toEqual({ content: "a\nb", conflicts: 0 });
  });
});

describe("mergeFiles", () => {
  it("merges the content and keeps the new name when one side renamed the file", () => {
    const base = { name: "main.py", content: BASE };
    expect(mergeFiles(base, { name: "main.py", content: "A\nb\nc\nd\ne\n" }, { name: "app.py", content: "a\nb\nc\nd\nE\n" }, L)).toEqual({ file: { name: "app.py", content: "A\nb\nc\nd\nE\n" }, conflicts: 0 });
    expect(mergeFiles(base, { name: "ours.py", content: BASE }, { name: "app.py", content: BASE }, L).file.name).toBe("ours.py");
  });
  it("works without a common ancestor (treated as an empty base)", () => {
    expect(mergeFiles(null, { name: "a.txt", content: "x\n" }, { name: "a.txt", content: "y\n" }, L)).toMatchObject({ conflicts: 1 });
  });
});

describe("conflict markers in a file", () => {
  const marked = "keep\n<<<<<<< HEAD (ของเรา)\nours\n=======\ntheirs\n>>>>>>> feature\nend\n";
  it("detects any marker line and none in a resolved file", () => {
    expect(hasConflictMarkers(marked)).toBe(true);
    expect(hasConflictMarkers("a\n=======\n")).toBe(true);
    expect(hasConflictMarkers("<<<<<<< HEAD\n")).toBe(true);
    expect(hasConflictMarkers("x\n>>>>>>> feature")).toBe(true);
    expect(hasConflictMarkers("ours\ntheirs\n")).toBe(false);
    expect(hasConflictMarkers("a <<<<<<< not at the start\n====== six\n>>>>>>>>>>x\n")).toBe(false);
    expect(hasConflictMarkers("")).toBe(false);
  });
  it("labels every row: text, marker lines, our half and their half", () => {
    expect(conflictLineRoles(marked)).toEqual(["text", "marker", "ours", "marker", "theirs", "marker", "text", "text"]);
  });
  it("a lone ======= outside a conflict is only a marker line, not a half", () => {
    expect(conflictLineRoles("a\n=======\nb")).toEqual(["text", "text", "text"]);
  });
  it("roundtrip: a conflict written by mergeText is read back with the right roles", () => {
    const { content } = merge(BASE, "a\nOURS\nc\nd\ne\n", "a\nTHEIRS\nc\nd\ne\n");
    expect(conflictLineRoles(content)).toEqual(["text", "marker", "ours", "marker", "theirs", "marker", "text", "text", "text", "text"]);
    expect(hasConflictMarkers(content)).toBe(true);
  });
});

describe("helpers", () => {
  it("splitLines drops the final newline and CR", () => {
    expect(splitLines("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });
  it("proposes Git's merge commit messages", () => {
    expect(mergeCommitMessage("origin/main")).toBe("Merge origin/main");
    expect(mergeCommitMessage("feature")).toBe("Merge branch 'feature'");
  });
});

describe("planted omission (the checks above would notice a broken merge)", () => {
  it("a merge that ignored their change would differ from the hand-written expectation", () => {
    const wrong = "a\nb\nc\nd\ne\n";
    expect(merge(BASE, BASE, "a\nB\nc\nd\ne\n").content).not.toBe(wrong);
  });
});
