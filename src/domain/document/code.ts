import type { FontMetrics } from "./geometry";
import type { CodeLanguage, CodeNode } from "./model";

// Code blocks (plan 03 §code): syntax colouring and layout, pure so the board, hit testing and export agree.

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "function" | "builtin" | "tag" | "attr";
export type Token = { text: string; kind: TokenKind };

export const CODE_LABEL: Record<CodeLanguage, string> = { python: "Python", javascript: "JavaScript", sql: "SQL", html: "HTML", plain: "ข้อความ" };
export const CODE_LINE_HEIGHT = 1.5;
const TAB = "    ";

const words = (list: string, flags = "") => new RegExp(`\\b(?:${list.trim().split(/\s+/).join("|")})\\b`, `y${flags}`);
type Rule = [TokenKind, RegExp];
const NUMBER: Rule = ["number", /\b(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy];
const FUNCTION: Rule = ["function", /[A-Za-z_$][\w$]*(?=\s*\()/y];
const IDENTIFIER: Rule = ["plain", /[A-Za-z_$][\w$]*/y];

const RULES: Record<CodeLanguage, Rule[]> = {
  python: [
    ["comment", /#.*/y],
    ["string", /[rbfuRBFU]{0,2}(?:"""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S])))/y],
    ["string", /[rbfuRBFU]{0,2}(?:"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)/y],
    NUMBER,
    ["keyword", words("def class return if elif else for while in not and or is None True False import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case")],
    ["builtin", words("print len range int str float list dict set tuple bool input open enumerate zip map filter sum min max abs sorted self type isinstance super")],
    FUNCTION, IDENTIFIER,
  ],
  javascript: [
    ["comment", /\/\/.*|\/\*[\s\S]*?(?:\*\/|$(?![\s\S]))/y],
    ["string", /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/y],
    NUMBER,
    ["keyword", words("const let var function return if else for while do switch case break continue new class extends import export from default try catch finally throw async await typeof instanceof in of this null undefined true false void yield interface type enum implements")],
    ["builtin", words("console document window Math JSON Promise Array Object String Number Boolean Map Set fetch")],
    FUNCTION, IDENTIFIER,
  ],
  sql: [
    ["comment", /--.*|\/\*[\s\S]*?(?:\*\/|$(?![\s\S]))/y],
    ["string", /'(?:''|[^'\n])*'?/y],
    NUMBER,
    ["keyword", words(`select from where insert into values update set delete create table primary key foreign references join left right inner outer on as
      and or not null is in order by group having limit offset distinct alter add drop index unique default check constraint returning like between case when then
      else end asc desc union all exists view grant revoke policy enable row level security`, "i")],
    ["builtin", words("int integer bigint text varchar char boolean date timestamp timestamptz numeric decimal serial uuid real float json jsonb count sum avg min max now", "i")],
    FUNCTION, IDENTIFIER,
  ],
  html: [
    ["comment", /<!--[\s\S]*?(?:-->|$(?![\s\S]))/y],
    ["tag", /<\/?[A-Za-z][\w:-]*|\/?>/y],
    ["attr", /[A-Za-z_:][\w:.-]*(?=\s*=)/y],
    ["string", /"[^"\n]*"?|'[^'\n]*'?/y],
  ],
  plain: [],
};

/** Coloured tokens per line (tabs become four spaces). Multi-line comments/strings are split across lines. */
export function highlightCode(code: string, language: CodeLanguage): Token[][] {
  const source = code.replace(/\t/g, TAB);
  const rules = RULES[language];
  const tokens: Token[] = [];
  const push = (text: string, kind: TokenKind) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };
  let index = 0;
  while (index < source.length) {
    let matched = false;
    for (const [kind, pattern] of rules) {
      pattern.lastIndex = index;
      const match = pattern.exec(source);
      if (match && match[0].length) { push(match[0], kind); index += match[0].length; matched = true; break; }
    }
    if (!matched) { push(source[index], "plain"); index += 1; }
  }
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    token.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, kind: token.kind });
    });
  }
  return lines;
}

export type CodeLayout = { width: number; height: number; header: number; pad: number; gutter: number; lineHeight: number; lines: number };

/** Box of a code block: header strip (language), optional line numbers, the longest line decides the width. */
export function codeLayout(node: CodeNode, metrics: FontMetrics): CodeLayout {
  const { fontSize } = node;
  const lines = node.code.replace(/\t/g, TAB).split("\n");
  const pad = fontSize * 0.9;
  const header = fontSize * 1.8;
  const lineHeight = fontSize * CODE_LINE_HEIGHT;
  const gutter = node.lineNumbers ? metrics.measureMono(String(lines.length), fontSize) + fontSize : 0;
  const longest = Math.max(fontSize * 12, ...lines.map((line) => metrics.measureMono(line, fontSize)));
  return { width: pad * 2 + gutter + longest, height: header + pad * 1.6 + lines.length * lineHeight, header, pad, gutter, lineHeight, lines: lines.length };
}

/** Enter: the new line keeps the indentation, one level deeper after `:` / `{` / `(` / `[` / an opening tag. */
export function indentAfter(line: string, language: CodeLanguage): string {
  const indent = /^[ ]*/.exec(line)?.[0] ?? "";
  const trimmed = line.trimEnd();
  const opens = language === "python" ? /:$/.test(trimmed) : language === "html" ? /<[A-Za-z][^/]*>$/.test(trimmed) && !/<\/[A-Za-z]/.test(trimmed) : /[{([]$/.test(trimmed);
  return opens ? indent + TAB : indent;
}

export const DEFAULT_CODE: Record<CodeLanguage, string> = {
  python: 'def greet(name):\n    # ทักทายผู้เรียน\n    return f"สวัสดี {name}!"\n\nprint(greet("นักเรียน"))',
  javascript: 'function greet(name) {\n  // ทักทายผู้เรียน\n  return `สวัสดี ${name}!`;\n}\n\nconsole.log(greet("นักเรียน"));',
  sql: "SELECT name, price\nFROM menu\nWHERE price < 60\nORDER BY price;",
  html: '<div class="card">\n  <h1>สวัสดี</h1>\n  <button>สั่งกาแฟ</button>\n</div>',
  plain: "พิมพ์ข้อความที่นี่",
};
