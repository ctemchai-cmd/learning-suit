import { describe, expect, it } from "vitest";
import { indentEdit, newlineEdit, type TextEdit } from "./code-edit";

const apply = (value: string, edit: TextEdit) => value.slice(0, edit.from) + edit.text + value.slice(edit.to);

describe("board code editor keys", () => {
  it("Tab at a caret inserts four spaces", () => {
    const edit = indentEdit("print(i)", 0, 0, false);
    expect(apply("print(i)", edit)).toBe("    print(i)");
    expect([edit.selStart, edit.selEnd]).toEqual([4, 4]);
  });

  it("Tab / Shift+Tab indent and outdent every selected line", () => {
    const value = "for i in x:\nprint(i)\nprint(2)\nend";
    const start = value.indexOf("print(i)");
    const end = value.indexOf("end"); // selection ends at the start of "end": that line is not included
    const indented = apply(value, indentEdit(value, start, end, false));
    expect(indented).toBe("for i in x:\n    print(i)\n    print(2)\nend");
    const back = indentEdit(indented, indented.indexOf("    print(i)"), indented.indexOf("end"), true);
    expect(apply(indented, back)).toBe(value);
  });

  it("Shift+Tab removes at most one level, including a tab, and never moves the caret before the line", () => {
    expect(apply("\t\tx", indentEdit("\t\tx", 2, 2, true))).toBe("\tx");
    expect(apply("  x", indentEdit("  x", 1, 1, true))).toBe("x");
    const edit = indentEdit("a\n  b", 3, 3, true);
    expect(edit.selStart).toBe(2);
  });

  it("Enter keeps the indentation and adds a level after a colon", () => {
    expect(newlineEdit("    print(1)", 12, 12).text).toBe("\n    ");
    expect(newlineEdit("for i in range(3):", 18, 18).text).toBe("\n    ");
    expect(newlineEdit("x = 1", 5, 5).text).toBe("\n");
  });
});
