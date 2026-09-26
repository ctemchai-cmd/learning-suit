import { describe, expect, it } from "vitest";
import { diffCounts, diffWindow, lineDiff } from "./diff";

const kinds = (before: string, after: string) => lineDiff(before, after).map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);

describe("line diff of a commit", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(kinds("print(\"Hello World\")\n", "name = \"A\"\nprint(\"Hello\", name)\n")).toEqual([
      "-print(\"Hello World\")", "+name = \"A\"", "+print(\"Hello\", name)",
    ]);
    expect(kinds("a\nb\nc\n", "a\nB\nc\n")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("treats the first commit as all added and ignores a final newline", () => {
    expect(kinds("", "x\ny\n")).toEqual(["+x", "+y"]);
    expect(kinds("x", "x\n")).toEqual([" x"]);
    expect(diffCounts(lineDiff("a\nb\n", "a\nc\nd\n"))).toEqual({ added: 2, removed: 1 });
  });

  it("numbers lines of the new file only", () => {
    expect(lineDiff("a\nb\n", "a\nc\n").map((line) => line.line)).toEqual([1, null, 2]);
  });

  it("shows the window around the first change", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "changed 20");
    const view = diffWindow(lineDiff(before, after), 8);
    expect(view.lines[0].text).toBe("line 18");
    expect(view.lines.some((line) => line.kind === "add")).toBe(true);
    expect(view.before).toBe(18);
    expect(view.before + view.lines.length + view.after).toBe(31);
  });
});
