import { describe, expect, it } from "vitest";
import { breakLines, clampLines } from "./line-break";

const ten = (text: string) => [...text].length * 10; // every character 10 wide
const split = (paragraph: string) => paragraph.split(/(\s+)/).filter(Boolean);

describe("LBR-01: wrapping at word boundaries", () => {
  it("wraps a Thai sentence between words, not inside them", () => {
    const lines = breakLines("สวัสดีครับผมชื่อสมชาย", 100, ten);
    expect(lines).toEqual(["สวัสดีครับ", "ผมชื่อ", "สมชาย"]);
    expect(lines.join("")).toBe("สวัสดีครับผมชื่อสมชาย");
    expect(lines.every((line) => ten(line) <= 100)).toBe(true);
  });
  it("handles mixed Thai and English with spaces, hanging spaces off the line end", () => {
    const lines = breakLines("เปิด Terminal แล้วพิมพ์ git status", 140, ten);
    expect(lines.every((line) => ten(line) <= 140 && line === line.trimEnd())).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain("Terminal");
    expect(lines).toEqual(["เปิด Terminal", "แล้วพิมพ์ git", "status"]); // English words whole, Thai between words
  });
  it("breaks a single word that is wider than the line by character, keeping marks with their letter", () => {
    expect(breakLines("abcdefghijkl", 50, ten)).toEqual(["abcde", "fghij", "kl"]);
    const lines = breakLines("กำกึ๋มมมมมมมมมม".normalize("NFC"), 30, (t) => [...t].filter((c) => !/\p{M}/u.test(c)).length * 10);
    expect(lines.every((line) => !/^\p{M}/u.test(line))).toBe(true);
  });
  it("keeps explicit newlines and empty lines, and an empty text is one empty line", () => {
    expect(breakLines("a\n\nb", 100, ten)).toEqual(["a", "", "b"]);
    expect(breakLines("", 100, ten)).toEqual([""]);
  });
  it("falls back to splitting at spaces when it is given no word segmenter", () => {
    expect(breakLines("aa bb cc", 50, ten, split)).toEqual(["aa bb", "cc"]);
  });
});

describe("LBR-02: cutting to a number of lines", () => {
  it("keeps what fits and ends the last line with an ellipsis that fits the width", () => {
    const cut = clampLines(["aaaaaaaaaa", "bbbbbbbbbb", "cc"], 2, 100, ten);
    expect(cut).toHaveLength(2);
    expect(cut[0]).toBe("aaaaaaaaaa");
    expect(cut[1].endsWith("…")).toBe(true);
    expect(ten(cut[1])).toBeLessThanOrEqual(100);
    expect(clampLines(["a", "b"], 2, 100, ten)).toEqual(["a", "b"]);
    expect(clampLines(["a", "b"], 0, 100, ten)).toEqual(["a…"]);
  });
});
