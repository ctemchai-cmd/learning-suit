import { describe, expect, it } from "vitest";
import { fallbackFontMetrics as metrics, getNodeBounds } from "./geometry";
import { LIMITS } from "./limits";
import { createProjectContent, type CanvasNode, type CodeNode, type TextNode } from "./model";
import { parseProjectContent } from "./schema";
import { codeLayout, DEFAULT_CODE, highlightCode, indentAfter, type TokenKind } from "./code";
import { getSingleHandles, scaleSelection, transformSingle } from "./transform";

const block = (overrides: Partial<CodeNode> = {}): CodeNode => ({
  id: crypto.randomUUID(), type: "code", x: 100, y: 50, rotation: 0, opacity: 1, locked: false,
  code: DEFAULT_CODE.python, language: "python", theme: "dark", fontSize: 20, lineNumbers: true, ...overrides,
});
const kinds = (code: string, language: CodeNode["language"]) =>
  highlightCode(code, language).map((line) => line.filter((token) => token.text.trim()).map((token) => [token.text.trim(), token.kind] as [string, TokenKind]));
const withNodes = (nodes: CanvasNode[]) => {
  const content = createProjectContent("โค้ด");
  content.document.slides[0].nodes = nodes;
  return content;
};

describe("COD-01: syntax colours", () => {
  it("colours Python keywords, strings, comments, numbers, calls and builtins; multi-line strings span lines", () => {
    expect(kinds('def add(a, b):  # รวม\n    return "x" + 1', "python")).toEqual([
      [["def", "keyword"], ["add", "function"], ["(a, b):", "plain"], ["# รวม", "comment"]],
      [["return", "keyword"], ['"x"', "string"], ["+", "plain"], ["1", "number"]],
    ]);
    expect(kinds('s = """a\nb"""\nprint(s)', "python")).toEqual([
      [["s =", "plain"], ['"""a', "string"]], [['b"""', "string"]], [["print", "builtin"], ["(s)", "plain"]],
    ]);
  });

  it("colours JavaScript, SQL (any case) and HTML", () => {
    // Neighbouring pieces of the same colour are drawn as one.
    expect(kinds("const n = fetch(`u`) // x", "javascript")).toEqual([[["const", "keyword"], ["n =", "plain"], ["fetch", "builtin"], ["(", "plain"], ["`u`", "string"], [")", "plain"], ["// x", "comment"]]]);
    expect(kinds("select name from menu where price < 60 -- ถูก", "sql")[0].map(([, kind]) => kind)).toEqual(["keyword", "plain", "keyword", "plain", "keyword", "plain", "number", "comment"]);
    expect(kinds('<a href="/x">ไป</a>', "html")).toEqual([[["<a", "tag"], ["href", "attr"], ["=", "plain"], ['"/x"', "string"], [">", "tag"], ["ไป", "plain"], ["</a>", "tag"]]]);
    expect(kinds("def x", "plain")).toEqual([[["def x", "plain"]]]);
  });

  it("indents the next line like an editor would", () => {
    expect(indentAfter("    for x in y:", "python")).toBe("        ");
    expect(indentAfter("    s = 0", "python")).toBe("    ");
    expect(indentAfter("function f() {", "javascript")).toBe("    ");
    expect(indentAfter("  <div>", "html")).toBe("      ");
    expect(indentAfter("  <b>x</b>", "html")).toBe("  ");
  });
});

describe("COD-02: code blocks as board objects", () => {
  it("sizes the box from the code and the font size (linear, so resizing keeps its shape)", () => {
    const small = codeLayout(block({ fontSize: 10 }), metrics);
    const large = codeLayout(block({ fontSize: 20 }), metrics);
    expect(large.width).toBeCloseTo(small.width * 2);
    expect(large.height).toBeCloseTo(small.height * 2);
    expect(large.lines).toBe(5);
    expect(codeLayout(block({ lineNumbers: false }), metrics).width).toBeLessThan(large.width);
    expect(getNodeBounds(block(), metrics)).toMatchObject({ x: 100, y: 50, width: large.width });
  });

  it("resizes from a corner by font size, the opposite corner staying put; group scale changes the font", () => {
    const node = block();
    const box = codeLayout(node, metrics);
    expect(getSingleHandles(node, metrics, 1).map((handle) => handle.id)).toEqual(["nw", "ne", "se", "sw", "rotate"]);
    const bigger = transformSingle(node, "se", { x: 100 + box.width * 1.5, y: 50 + box.height * 1.5 }, { keepAspect: false }, metrics) as CodeNode;
    expect(bigger).toMatchObject({ x: 100, y: 50 });
    expect(bigger.fontSize).toBeCloseTo(30);
    const fromTopLeft = transformSingle(node, "nw", { x: 100 + box.width / 2, y: 50 + box.height / 2 }, { keepAspect: false }, metrics) as CodeNode;
    expect(fromTopLeft.fontSize).toBeCloseTo(10);
    const after = codeLayout(fromTopLeft, metrics);
    expect(fromTopLeft.x + after.width).toBeCloseTo(100 + box.width);
    expect(transformSingle(node, "n", { x: 0, y: 0 }, { keepAspect: false }, metrics)).toEqual(node);
    const [half] = scaleSelection([node], "se", { x: 100 + box.width / 2, y: 50 + box.height / 2 }, metrics) as CodeNode[];
    expect(half.fontSize).toBeCloseTo(10);
  });

  it("validates code blocks and bold text strictly", () => {
    const text: TextNode = {
      id: crypto.randomUUID(), type: "text", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, text: "หัวข้อ", width: 200,
      fontFamily: "Noto Sans Thai", fontSize: 28, lineHeight: 1.25, color: "#111827", align: "left", bold: true,
    };
    expect(() => parseProjectContent(withNodes([block(), block({ language: "sql", theme: "light" }), text]))).not.toThrow();
    for (const bad of [
      { ...block(), language: "ruby" }, block({ fontSize: 60 }), block({ code: "x\n".repeat(LIMITS.codeLines) }),
      { ...block(), extra: 1 }, { ...text, bold: "yes" },
    ]) expect(() => parseProjectContent(withNodes([bad as CanvasNode])), JSON.stringify(bad).slice(0, 70)).toThrow();
  });
});
