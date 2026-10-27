import { describe, expect, it } from "vitest";
import { fallbackFontMetrics as metrics, getNodeBounds } from "./geometry";
import { LIMITS } from "./limits";
import { createProjectContent, type CanvasNode, type CodeNode, type TextNode } from "./model";
import { parseProjectContent } from "./schema";
import { CODE_LABEL, codeLayout, DEFAULT_CODE, highlightCode, indentAfter, type TokenKind } from "./code";
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

describe("COD-03: terminal language", () => {
  const term = (code: string) => kinds(code, "terminal");
  it("treats prompt lines as commands: prompt, command, subcommand, flags, strings, variables, paths", () => {
    expect(term('$ git commit -m "first" --amend')).toEqual([[["$", "prompt"], ["git", "command"], ["commit", "builtin"], ["-m", "flag"], ['"first"', "string"], ["--amend", "flag"]]]);
    expect(term("$ git push -u origin main")[0].map(([, kind]) => kind)).toEqual(["prompt", "command", "builtin", "flag", "plain"]);
    expect(term("$ ssh -i ~/.ssh/key $HOME/${X} 'a b'")).toEqual([[["$", "prompt"], ["ssh", "command"], ["-i", "flag"], ["~/.ssh/key", "path"], ["$HOME", "variable"], ["/", "path"], ["${X}", "variable"], ["'a b'", "string"]]]);
    expect(term("$ git clone https://github.com/a/b.git")[0].at(-1)).toEqual(["https://github.com/a/b.git", "path"]);
  });
  it("accepts every prompt variant", () => {
    for (const line of ["$ ls", "% ls", "> ls", "# ls", "PS> ls", "PS C:\\Users\\me> ls", "C:\\Users\\me> ls", "me@host:~/app$ ls", "root@host:/# ls"]) {
      const tokens = highlightCode(line, "terminal")[0];
      expect(tokens[0].kind, line).toBe("prompt");
      expect(tokens.at(-1), line).toEqual({ text: "ls", kind: "command" });
    }
  });
  it("colours operators, resets the command word after | && ; and ignores # inside words", () => {
    expect(term("$ cat a.txt | grep x && echo ok > out.txt # เก็บไว้")).toEqual([[
      ["$", "prompt"], ["cat", "command"], ["a.txt", "plain"], ["|", "operator"], ["grep", "command"], ["x", "plain"], ["&&", "operator"],
      ["echo", "command"], ["ok", "plain"], [">", "operator"], ["out.txt", "plain"], ["# เก็บไว้", "comment"]]]);
    expect(term("$ echo a#b")[0].map(([, kind]) => kind)).not.toContain("comment");
    expect(term("$ sudo npm install -g pnpm")[0].map(([, kind]) => kind)).toEqual(["prompt", "command", "command", "builtin", "flag", "plain"]);
    expect(term("$ FOO=1 node app.js")[0].map(([, kind]) => kind)).toEqual(["prompt", "variable", "command", "plain"]);
  });
  it("treats other lines as output, with error / warning / success markers; $ inside output is not a command", () => {
    expect(term("On branch main\nprice is $ 5 and git status\n\nerror: failed to push\nfatal: not a repo\nwarning: LF will be replaced\nnpm WARN deprecated x\nHi student! You've successfully authenticated.\n✓ built")).toEqual([
      [["On branch main", "output"]], [["price is $ 5 and git status", "output"]], [],
      [["error: failed to push", "error"]], [["fatal: not a repo", "error"]], [["warning: LF will be replaced", "warning"]], [["npm WARN deprecated x", "warning"]],
      [["Hi student! You've successfully authenticated.", "success"]], [["✓ built", "success"]],
    ]);
    expect(term("  $ indented is output")[0][0][1]).toBe("output");
  });
  it("continues a command after a trailing backslash and keeps the text intact", () => {
    expect(term("$ docker run \\\n  --rm alpine")).toEqual([[["$", "prompt"], ["docker", "command"], ["run", "builtin"], ["\\", "plain"]], [["--rm", "flag"], ["alpine", "plain"]]]);
    const code = "$ git status\nOn branch main\n\n$ echo \"x\" # y\n\terr";
    expect(highlightCode(code, "terminal").map((line) => line.map((t) => t.text).join("")).join("\n")).toBe(code.replace("\t", "    "));
  });
  it("is a valid language with its own label and sample; old languages stay valid", () => {
    expect(CODE_LABEL.terminal).toBe("Terminal");
    expect(DEFAULT_CODE.terminal.startsWith("$ ")).toBe(true);
    expect(indentAfter("  $ ls {", "terminal")).toBe("  ");
    expect(() => parseProjectContent(withNodes([block({ language: "terminal", code: DEFAULT_CODE.terminal })]))).not.toThrow();
    expect(() => parseProjectContent(withNodes([block({ language: "plain" })]))).not.toThrow();
  });
});
