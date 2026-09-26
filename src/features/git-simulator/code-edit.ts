// Small code-editor behaviours for the file text box on the board (pure, so they are unit-tested):
// Tab / Shift+Tab indent or outdent the current lines, Enter keeps the indentation (one level more after ":").

export const INDENT = "    ";

/** Replace `from..to` with `text`, then select `selStart..selEnd`. */
export type TextEdit = { from: number; to: number; text: string; selStart: number; selEnd: number };

export function indentEdit(value: string, start: number, end: number, outdent: boolean): TextEdit {
  if (start === end && !outdent) return { from: start, to: end, text: INDENT, selStart: start + INDENT.length, selEnd: start + INDENT.length };
  const from = value.lastIndexOf("\n", start - 1) + 1;
  // A selection that ends right after a newline does not include the next line.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = value.indexOf("\n", last);
  const to = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(from, to).split("\n");
  if (!outdent) {
    const text = lines.map((line) => INDENT + line).join("\n");
    return { from, to, text, selStart: start + INDENT.length, selEnd: end + INDENT.length * lines.length };
  }
  let removedFirst = 0;
  let removed = 0;
  const text = lines.map((line, index) => {
    const count = line.startsWith("\t") ? 1 : (line.match(/^ {1,4}/)?.[0].length ?? 0);
    if (index === 0) removedFirst = count;
    removed += count;
    return line.slice(count);
  }).join("\n");
  return { from, to, text, selStart: Math.max(from, start - removedFirst), selEnd: Math.max(from, end - removed) };
}

export function newlineEdit(value: string, start: number, end: number): TextEdit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const before = value.slice(lineStart, start);
  const indent = before.match(/^[ \t]*/)?.[0] ?? "";
  const text = `\n${indent}${/:\s*$/.test(before) ? INDENT : ""}`;
  return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length };
}

/** Applies an edit through the browser's editing commands so the field's own Undo (Cmd+Z) keeps working. */
export function applyTextEdit(field: HTMLTextAreaElement, edit: TextEdit): void {
  // WebKit's insertText("") also eats the newline before the selection; replace one more character instead.
  const from = edit.text === "" && edit.from > 0 ? edit.from - 1 : edit.from;
  const text = field.value.slice(from, edit.from) + edit.text;
  field.setSelectionRange(from, edit.to);
  const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!inserted) {
    field.setRangeText(text, from, edit.to, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(edit.selStart, edit.selEnd);
}
