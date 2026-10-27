import { describe, expect, it } from "vitest";
import { applyDocumentCommand } from "./commands";
import { fallbackFontMetrics as metrics } from "./geometry";
import { LIMITS } from "./limits";
import { createProjectContent, type CanvasNode, type EllipseNode, type RectNode } from "./model";
import { parseProjectContent } from "./schema";
import { measureShapeText, SHAPE_TEXT, shapeContains, shapeTextBox, shapeTextStyle, topShapeAt, withShapeText } from "./shape-text";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rect = (overrides: Partial<RectNode> = {}): RectNode => ({
  id: id(1), type: "rectangle", x: 0, y: 0, rotation: 0, opacity: 1, locked: false,
  width: 200, height: 100, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid", fill: "transparent", ...overrides,
});
const ellipse = (overrides: Partial<EllipseNode> = {}): EllipseNode => ({ ...rect(), type: "ellipse", ...overrides } as EllipseNode);
const withNodes = (nodes: CanvasNode[]) => {
  const content = createProjectContent("ข้อความในรูปทรง");
  content.document.slides[0].nodes = nodes;
  return content;
};

describe("SHP-01: text fields of a rectangle / ellipse in the document schema", () => {
  it("accepts shapes with and without text (older documents have none)", () => {
    expect(() => parseProjectContent(withNodes([rect(), ellipse({ id: id(2) })]))).not.toThrow();
    const full = withNodes([rect({ text: "สวัสดี\nบรรทัดสอง", fontSize: 24, color: "#DC2626", bold: true }), ellipse({ id: id(2), text: "วงกลม" })]);
    expect(parseProjectContent(full)).toEqual(full);
  });
  it("bounds the text like a text node and checks the other fields", () => {
    expect(() => parseProjectContent(withNodes([rect({ text: "ก".repeat(LIMITS.textCodePoints) })]))).not.toThrow();
    expect(() => parseProjectContent(withNodes([rect({ text: "ก".repeat(LIMITS.textCodePoints + 1) })]))).toThrow();
    expect(() => parseProjectContent(withNodes([rect({ text: "x", fontSize: 4 })]))).toThrow();
    expect(() => parseProjectContent(withNodes([ellipse({ text: "x", fontSize: 161 })]))).toThrow();
    expect(() => parseProjectContent(withNodes([ellipse({ text: "x", color: "red" })]))).toThrow();
    expect(() => parseProjectContent(withNodes([rect({ text: "x", bold: "yes" as unknown as boolean })]))).toThrow();
  });
  it("still rejects unknown fields on a shape", () => {
    expect(() => parseProjectContent(withNodes([{ ...rect(), label: "x" } as unknown as CanvasNode]))).toThrow();
  });
  it("replacing a shape with its text set is one valid command", () => {
    const content = withNodes([rect()]);
    const slideId = content.document.slides[0].id;
    const result = applyDocumentCommand(content, { label: "แก้ข้อความในรูปทรง", affectedSlideId: slideId, commands: [{ type: "nodes.replace", slideId, nodes: [withShapeText(rect(), "สวัสดีครับ")] }] });
    expect(result.status).not.toBe("invalid");
    expect((result.content.document.slides[0].nodes[0] as RectNode).text).toBe("สวัสดีครับ");
  });
});

describe("SHP-02: where the text sits and what fits", () => {
  it("a rectangle's text box is the shape less a padding (and half the outline) on every side", () => {
    expect(shapeTextBox(rect())).toEqual({ x: 9, y: 9, width: 182, height: 82 });
    expect(shapeTextBox(rect({ strokeWidth: 8 }))).toEqual({ x: 12, y: 12, width: 176, height: 76 });
  });
  it("an ellipse's text box is the centred rectangle of 70% inscribed in it, narrower than the rectangle's", () => {
    const box = shapeTextBox(ellipse());
    expect(box.width).toBeCloseTo(140);
    expect(box.height).toBeCloseTo(70);
    expect(box.x).toBeCloseTo(30);
    expect(box.y).toBeCloseTo(15);
    expect(box.width).toBeLessThan(shapeTextBox(rect()).width);
    // the corners of the box lie inside the curve
    for (const corner of [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]) {
      expect(shapeContains(ellipse(), { x: corner[0], y: corner[1] })).toBe(true);
    }
  });
  it("a tiny shape still has a box of at least one unit", () => {
    expect(shapeTextBox(rect({ width: 4, height: 4 })).width).toBeGreaterThanOrEqual(1);
    expect(shapeTextBox(ellipse({ width: 1, height: 1 })).height).toBeGreaterThanOrEqual(1);
  });
  it("shows nothing for no / blank text and the defaults for unset text settings", () => {
    expect(shapeTextStyle(rect())).toBeNull();
    expect(shapeTextStyle(rect({ text: "  \n " }))).toBeNull();
    expect(shapeTextStyle({ ...rect(), type: "arrow" } as unknown as CanvasNode)).toBeNull();
    expect(shapeTextStyle(ellipse({ text: "ก" }))).toEqual({ text: "ก", fontSize: SHAPE_TEXT.fontSize, color: SHAPE_TEXT.color, bold: false, lineHeight: SHAPE_TEXT.lineHeight });
    expect(shapeTextStyle(rect({ text: "ก", fontSize: 30, color: "#16A34A", bold: true }))).toMatchObject({ fontSize: 30, color: "#16A34A", bold: true });
  });
  it("withShapeText sets the text, and removes it (only it) when blank", () => {
    const labelled = withShapeText(rect({ fontSize: 30 }), "ข้อความ");
    expect(labelled.text).toBe("ข้อความ");
    const emptied = withShapeText(labelled, "   ");
    expect("text" in emptied).toBe(false);
    expect(emptied.fontSize).toBe(30);
    expect(labelled.text).toBe("ข้อความ"); // the original is untouched
  });
  it("measures the wrapped text in the box and says when it is cut", () => {
    const short = measureShapeText(rect({ text: "สวัสดี" }), metrics)!;
    expect(short.overflow).toBe(false);
    const long = measureShapeText(rect({ text: "ก".repeat(400) }), metrics)!;
    expect(long.overflow).toBe(true);
    expect(long.textHeight).toBeGreaterThan(long.lineBox.height);
    // the same words need more lines in the narrower ellipse box
    const words = "ข้อความที่ค่อนข้างยาวสักหน่อย ".repeat(3);
    expect(measureShapeText(ellipse({ text: words }), metrics)!.textHeight).toBeGreaterThanOrEqual(measureShapeText(rect({ text: words }), metrics)!.textHeight);
    expect(measureShapeText(rect(), metrics)).toBeNull();
  });
});

describe("SHP-03: finding the shape under a point (also without fill)", () => {
  it("is inside the whole rectangle / ellipse, rotated ones included", () => {
    expect(shapeContains(rect(), { x: 100, y: 50 })).toBe(true);
    expect(shapeContains(rect(), { x: 201, y: 50 })).toBe(false);
    expect(shapeContains(ellipse(), { x: 2, y: 2 })).toBe(false); // the corner outside the curve
    expect(shapeContains(ellipse(), { x: 100, y: 50 })).toBe(true);
    const turned = rect({ x: 100, y: 0, rotation: 90 }); // covers x 0..100, y 0..200
    expect(shapeContains(turned, { x: 50, y: 150 })).toBe(true);
    expect(shapeContains(turned, { x: 150, y: 50 })).toBe(false);
  });
  it("picks the topmost unlocked shape", () => {
    const low = rect({ id: id(1) }), high = ellipse({ id: id(2) }), locked = rect({ id: id(3), locked: true });
    expect(topShapeAt([low, high], { x: 100, y: 50 })?.id).toBe(id(2));
    expect(topShapeAt([low, high, locked], { x: 100, y: 50 })?.id).toBe(id(2));
    expect(topShapeAt([low, high], { x: 3, y: 3 })?.id).toBe(id(1)); // outside the ellipse's curve
    expect(topShapeAt([low], { x: 500, y: 500 })).toBeNull();
  });
});
