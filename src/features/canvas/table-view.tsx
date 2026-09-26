"use client";

import { Group, Line, Rect, Text } from "react-konva";
import type { TableNode } from "@/domain/document/model";
import { isHeaderRow, isTitleCell, readableOn, TABLE_LINE_HEIGHT, tableLayout, tablePadding } from "@/domain/document/table";
import { CANVAS_FONT, konvaFontMetrics } from "./font-metrics";

// Konva drawing of a table node in its local frame (plan 03 §tables); shared by editor and export.
// Grid: lines between every row and column. Class box: title bar, then rows without lines except section dividers.

export function TableBody({ node }: { node: TableNode }) {
  const layout = tableLayout(node, konvaFontMetrics);
  const pad = tablePadding(node.fontSize);
  const { width, height, colX, rowY, rowH } = layout;
  const radius = node.variant === "class" ? 8 : 4;
  const headerH = isHeaderRow(node, 0) ? rowH[0] : 0;
  // Strong lines: under the header/title and section dividers; the others are thin.
  const lines: { points: number[]; strong: boolean }[] = [];
  node.rows.forEach((row, index) => {
    if (index === 0) return;
    const strong = (index === 1 && headerH > 0) || row.divider;
    if (node.variant === "grid" || strong) lines.push({ points: [0, rowY[index], width, rowY[index]], strong });
  });
  if (node.variant === "grid") colX.slice(1).forEach((x) => lines.push({ points: [x, 0, x, height], strong: false }));
  const headerText = readableOn(node.headerFill);
  return <Group>
    {/* Opaque background: the whole table is one object to click, and lines drawn behind it stay hidden. */}
    <Rect width={width} height={height} cornerRadius={radius} fill="#FFFFFF" />
    {headerH > 0 && <Rect width={width} height={headerH} cornerRadius={[radius, radius, 0, 0]} fill={node.headerFill} listening={false} />}
    {lines.map((line, index) => <Line key={index} points={line.points} stroke={node.stroke} strokeWidth={line.strong ? 1.5 : 1} opacity={line.strong ? 1 : 0.45} listening={false} />)}
    {node.rows.map((row, r) => row.cells.map((text, c) => text && <Text key={`${r}:${c}`} x={colX[c] + pad.x} y={rowY[r] + pad.y}
      width={Math.max(1, node.columns[c] - pad.x * 2)} text={text} fontSize={node.fontSize} fontFamily={CANVAS_FONT} lineHeight={TABLE_LINE_HEIGHT}
      fontStyle={isHeaderRow(node, r) ? "bold" : "normal"} fill={isHeaderRow(node, r) ? headerText : node.color}
      align={isTitleCell(node, r) ? "center" : "left"} wrap="word" listening={false} />))}
    <Rect width={width} height={height} cornerRadius={radius} stroke={node.stroke} strokeWidth={1.5} listening={false} />
  </Group>;
}
