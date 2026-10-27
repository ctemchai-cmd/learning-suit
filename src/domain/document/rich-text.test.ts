import { describe, expect, it } from "vitest";
import { applyDocumentCommand } from "./commands";
import { fallbackFontMetrics as metrics } from "./geometry";
import { breakLines } from "./line-break";
import { createProjectContent, type CanvasNode, type RectNode } from "./model";
import { breakRichLines, clampRichLines, hasBoldRuns, parseRichText, plainText, toggleBoldRange, type RichLine } from "./rich-text";
import { parseProjectContent } from "./schema";
import { measureShapeText, shapeTextStyle } from "./shape-text";

const ten = (text: string) => [...text].length * 10;
const weighted = (text: string, bold: boolean) => [...text].length * (bold ? 12 : 10); // bold characters are wider
const flat = (lines: RichLine[]) => lines.map((line) => line.map((run) => (run.bold ? `[${run.text}]` : run.text)).join(""));
const toggle = (text: string, word: string, occurrence = 0) => {
  let from = -1;
  for (let k = 0; k <= occurrence; k++) from = text.indexOf(word, from + 1);
  return toggleBoldRange(text, from, from + word.length);
};

describe("RTX-01: reading bold runs from the text", () => {
  it("a text without ** is exactly as before", () => {
    for (const text of ["", "สวัสดีครับ", "a\nb\n\nc", "5 * 3 = 15", "**", "a ** b ** c"]) {
      expect(hasBoldRuns(text)).toBe(false);
      expect(plainText(text)).toBe(text);
    }
  });
  it("a matched pair is bold, the markers are hidden", () => {
    expect(parseRichText("สวัสดี **ครับ** ผม")).toEqual([[{ text: "สวัสดี ", bold: false }, { text: "ครับ", bold: true }, { text: " ผม", bold: false }]]);
    expect(plainText("สวัสดี **ครับ** ผม")).toBe("สวัสดี ครับ ผม");
    expect(hasBoldRuns("**a**")).toBe(true);
  });
  it("only a pair that looks like **bold** counts: unmatched, empty, spaced or line-crossing markers stay literal", () => {
    for (const text of ["**abc", "abc**", "**** x", "** x**", "**x **", "**a\nb**", "***", "2 ** 3"]) expect(plainText(text)).toBe(text);
    expect(plainText("**a** and **b**")).toBe("a and b");
    expect(parseRichText("**a** and **b**")[0].filter((run) => run.bold).map((run) => run.text)).toEqual(["a", "b"]);
  });
  it("works line by line", () => {
    expect(parseRichText("ก **ข**\nค\n**ง** จ")).toEqual([
      [{ text: "ก ", bold: false }, { text: "ข", bold: true }], [{ text: "ค", bold: false }], [{ text: "ง", bold: true }, { text: " จ", bold: false }],
    ]);
  });
});

describe("RTX-02: ⌘B on a selection", () => {
  it("bolds a selected word, the selection stays on that word", () => {
    const r = toggle("สวัสดี ครับ ผม", "ครับ")!;
    expect(r.text).toBe("สวัสดี **ครับ** ผม");
    expect(r.text.slice(r.start, r.end)).toBe("ครับ");
  });
  it("toggles back: selecting the bold word (with or without the markers) makes it normal again", () => {
    const bolded = toggle("a b c", "b")!;
    const again = toggleBoldRange(bolded.text, bolded.start, bolded.end)!;
    expect(again.text).toBe("a b c");
    expect(again.text.slice(again.start, again.end)).toBe("b");
    const withMarkers = toggleBoldRange("a **b** c", 2, 7)!;
    expect(withMarkers.text).toBe("a b c");
  });
  it("partial overlap: the whole selection becomes bold and runs merge", () => {
    // "**ab** cd" select "b cd" -> not all bold -> all bold, merged into one run
    const r = toggleBoldRange("**ab** cd", 3, 9)!;
    expect(r.text).toBe("**ab cd**");
    expect(r.text.slice(r.start, r.end)).toBe("b cd");
    expect(plainText(r.text)).toBe("ab cd");
  });
  it("selecting part of a bold run unbolds just that part", () => {
    const r = toggleBoldRange("**hello world**", 8, 13)!; // "world"
    expect(r.text).toBe("**hello** world");
    expect(r.text.slice(r.start, r.end)).toBe("world");
  });
  it("adjacent bold runs merge: bolding the space between two bold words", () => {
    const r = toggleBoldRange("**a** **b**", 0, 11)!; // everything: not all bold (the space) -> all bold
    expect(r.text).toBe("**a b**");
  });
  it("leaves spaces at the ends of the selection and line breaks out of the markers; each line is marked separately", () => {
    expect(toggleBoldRange("a b c", 1, 4)!.text).toBe("a **b** c");
    const multi = toggleBoldRange("ab\ncd", 0, 5)!;
    expect(multi.text).toBe("**ab**\n**cd**");
    expect(plainText(multi.text)).toBe("ab\ncd");
  });
  it("works for Thai: a mark stays with its letter, the selection can start or end inside the cluster", () => {
    const text = "เขาไปโรงเรียนที่นี่";
    const r = toggle(text, "โรงเรียน")!;
    expect(r.text).toBe("เขาไป**โรงเรียน**ที่นี่");
    // selection that cuts between ที and the tone mark: it is widened to the whole cluster
    const cut = toggleBoldRange("ก่อนไป", 1, 2)!; // selects only the tone mark
    expect(cut.text).toBe("**ก่**อนไป");
    const emoji = toggle("a 😀 b", "😀")!;
    expect(emoji.text).toBe("a **😀** b");
  });
  it("does nothing for an empty selection, only spaces, or when the length limit would be exceeded", () => {
    expect(toggleBoldRange("abc", 1, 1)).toBeNull();
    expect(toggleBoldRange("a   b", 1, 4)).toBeNull();
    expect(toggleBoldRange("abc", 0, 3, 6)).toBeNull();
    expect(toggleBoldRange("abc", 0, 3, 7)!.text).toBe("**abc**");
  });
  it("never leaves a pair that would not be read back the same", () => {
    for (const [text, from, to] of [["a b c d", 0, 7], ["ก ข\nค ง", 0, 7], ["x **y** z", 0, 9], ["**a** b **c**", 2, 11]] as const) {
      const r = toggleBoldRange(text, from, to)!;
      const again = toggleBoldRange(r.text, r.start, r.end)!; // toggled twice: the words are normal / bold as they were selected
      expect(plainText(again.text)).toBe(plainText(text));
      expect(plainText(r.text)).toBe(plainText(text));
    }
  });
});

describe("RTX-03: line breaking with mixed weights", () => {
  it("without bold runs it breaks exactly like breakLines", () => {
    for (const text of ["สวัสดีครับผมชื่อสมชาย", "เปิด Terminal แล้วพิมพ์ git status", "abcdefghijkl", "a\n\nb", ""]) {
      expect(flat(breakRichLines(text, 100, ten))).toEqual(breakLines(text, 100, ten));
    }
  });
  it("measures each run in its own weight", () => {
    // "aa " 30 + "bbbb" bold 48 = 78 <= 80 fits; with a regular 'bbbb' (40) it would leave room for more
    expect(flat(breakRichLines("aa **bbbb** cc", 80, weighted))).toEqual(["aa [bbbb]", "cc"]);
    expect(flat(breakRichLines("aa bbbb cc", 80, weighted))).toEqual(["aa bbbb", "cc"]);
    expect(flat(breakRichLines("aa **bbbbb** cc", 80, weighted))).toEqual(["aa", "[bbbbb]", "cc"]);
  });
  it("breaks Thai between words and keeps a word that is partly bold together", () => {
    const lines = flat(breakRichLines("สวัสดี**ครับ**ผมชื่อสมชาย", 100, ten));
    expect(lines.join("")).toBe("สวัสดี[ครับ]ผมชื่อสมชาย");
    expect(lines.every((line) => ten(line.replace(/[[\]]/g, "")) <= 100)).toBe(true);
  });
  it("cuts a word wider than the line by character, carrying the weight, and keeps explicit newlines", () => {
    expect(flat(breakRichLines("ab**cdefgh**ij", 50, ten))).toEqual(["ab[cde]", "[fgh]ij"]);
    expect(flat(breakRichLines("a\n\n**b**", 100, ten))).toEqual(["a", "", "[b]"]);
  });
  it("clamps with … in the weight of the last word", () => {
    const lines = breakRichLines("aaa bbb **ccc ddd** eee", 70, ten);
    const clamped = clampRichLines(lines, 2, 70, ten);
    expect(clamped).toHaveLength(2);
    expect(flat(clamped)[1].endsWith("…") || flat(clamped)[1].endsWith("…]")).toBe(true);
    expect(clamped[1].reduce((sum, run) => sum + ten(run.text), 0)).toBeLessThanOrEqual(70);
  });
});

describe("RTX-04: old documents and the schema", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const rect = (overrides: Partial<RectNode> = {}): RectNode => ({ id, type: "rectangle", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, width: 200, height: 100, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides });
  const withNodes = (nodes: CanvasNode[]) => { const content = createProjectContent("x"); content.document.slides[0].nodes = nodes; return content; };

  it("text with bold markers is an ordinary string for the schema, commands and a round trip", () => {
    const content = withNodes([rect({ text: "สวัสดี **ครับ**" })]);
    expect(parseProjectContent(content)).toEqual(content);
    const slideId = content.document.slides[0].id;
    const result = applyDocumentCommand(content, { label: "x", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [rect({ text: "**a** b" })] }] });
    expect(result.status).not.toBe("invalid");
  });
  it("align of a shape is optional (older documents have none) and checked", () => {
    expect(() => parseProjectContent(withNodes([rect({ text: "x" })]))).not.toThrow();
    for (const align of ["left", "center", "right"] as const) expect(() => parseProjectContent(withNodes([rect({ text: "x", align })]))).not.toThrow();
    expect(() => parseProjectContent(withNodes([rect({ text: "x", align: "justify" as unknown as "left" })]))).toThrow();
  });
  it("a shape's style reads align (default centre) and the measuring keeps the markers out of the way", () => {
    expect(shapeTextStyle(rect({ text: "x" }))!.align).toBe("center");
    expect(shapeTextStyle(rect({ text: "x", align: "right" }))!.align).toBe("right");
    expect(measureShapeText(rect({ text: "**ab**" }), metrics)!.textHeight).toBe(measureShapeText(rect({ text: "ab" }), metrics)!.textHeight);
  });
});
