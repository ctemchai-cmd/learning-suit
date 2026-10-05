"use client";

import { useEffect, useMemo, useRef, type JSX } from "react";
import { Arrow, Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import { gitViewOf, type GitSimulatorNode, type GitView } from "@/domain/document/model";
import type { GitSimulationState, MachineId, RepositoryId } from "@/domain/git/model";
import { currentBranch } from "@/domain/git/selectors";
import { GIT_TRANSFER_DURATION_MS, type GitPreview, type GitTab, type GitTransferAnimation } from "./session-store";
import { branchPill, commitGraph, laneMetrics, machineDiagram, remoteDiagram, shortSyncText, type GraphRow, type Tone, type ZoneLine } from "./diagram-model";
import { diffCounts, diffWindow, lineDiff } from "@/domain/git/diff";
import { codeLines } from "./view-model";
import {
  COMMIT_LIST, codeText, commitListBox, commitListStyle, commitRowLimit, fileCodeBox, fileEditorBox, fileNameBox, GIT_COLUMN, gitShift, remoteCodeBox,
  remoteCodeText, remoteFileBox, REMOTE_COLUMN, viewHasRemote, widgetLayout, widgetWidth, WIDGET_H,
  type Box, type MachineLayout, type WidgetLayout,
} from "./widget-layout";


// Each machine card is split in two: the file being edited on the LEFT (edited in place on the
// board), the Git state on the RIGHT (Add → Commit → commits). GitHub has only Git state.
// Clicking a commit previews its code read-only in the file area (session state, never exported).

const C = {
  frame: "#FFFFFF", frameStroke: "#CBD5E1",
  card: "#FFFFFF", cardStroke: "#E2E8F0", remoteCard: "#F8F7FF", active: "#2563EB",
  title: "#0F172A", text: "#1E293B", muted: "#64748B",
  arrow: "#334155", fileCol: "#FFFFFF", gitCol: "#F8FAFC",
  previewFill: "#EFF6FF", previewStroke: "#3B82F6",
};
/** Dark code editor inside the file column (same colours as the textarea on top of it). */
export const EDITOR = {
  bg: "#0F172A", bar: "#1E293B", text: "#E2E8F0", muted: "#64748B", gutter: "#475569", dot: "#FACC15", badge: "#93C5FD",
} as const;
const TONE: Record<Tone, { stroke: string; fill: string; text: string }> = {
  pending: { stroke: "#F59E0B", fill: "#FFFBEB", text: "#B45309" },
  ready: { stroke: "#3B82F6", fill: "#EFF6FF", text: "#1D4ED8" },
  clean: { stroke: "#E2E8F0", fill: "#FFFFFF", text: "#15803D" },
  empty: { stroke: "#E2E8F0", fill: "#FFFFFF", text: "#64748B" },
  info: { stroke: "#DDD6FE", fill: "#F5F3FF", text: "#6D28D9" },
};

type LabelProps = { x: number; y: number; width: number; text: string; size: number; color?: string; bold?: boolean; align?: "left" | "center" | "right"; font: string; lineHeight?: number; strike?: boolean };
/** Single-line, fixed-width text that can never overflow its box. `lineHeight` (px) centres it in a CSS-like line box. */
function Label({ x, y, width, text, size, color = C.text, bold = false, align = "left", font, lineHeight, strike = false }: LabelProps) {
  return <Text x={x} y={y} width={width} text={text} fontSize={size} fontFamily={font} fontStyle={bold ? "bold" : "normal"}
    fill={color} align={align} wrap="none" ellipsis listening={false} lineHeight={lineHeight ? lineHeight / size : 1} textDecoration={strike ? "line-through" : ""} />;
}

function Pill({ x, y, width, line, font }: { x: number; y: number; width: number; line: ZoneLine; font: string }) {
  const tone = TONE[line.tone];
  return <Group x={x} y={y} listening={false}>
    <Rect width={width} height={28} cornerRadius={14} fill={tone.fill} stroke={tone.stroke} strokeWidth={1} />
    <Label x={10} y={6} width={width - 20} text={line.text} size={14} bold color={tone.text} font={font} />
  </Group>;
}

/** LEFT: the file being edited (working copy), or a read-only preview of a clicked commit, as a small code editor. */
function FileColumn({ layout, machine, state, previewCommit, font }: { layout: WidgetLayout; machine: MachineId; state: GitSimulationState; previewCommit: string | null; font: string }) {
  const box = layout[machine]!.file;
  const big = !layout.compact;
  const model = machineDiagram(state, machine);
  const commit = previewCommit ? state.commits[previewCommit] : null;
  const snapshot = commit ? commit.snapshot : state.machines[machine].working;
  const content = snapshot?.content ?? "";
  const metrics = codeText(layout);
  const local = (b: Box) => ({ ...b, x: b.x - box.x, y: b.y - box.y });
  const editor = local(fileEditorBox(layout, machine)!);
  const tab = local(fileNameBox(layout, machine)!);
  const code = local(fileCodeBox(layout, machine)!);
  const tone = commit ? { stroke: C.previewStroke, text: "#1D4ED8" } : TONE[model.working.tone];
  const rows = Math.max(1, Math.floor((code.h - 2 * metrics.pad) / metrics.lineH));
  const textX = code.x + metrics.gutter + metrics.pad;
  const textW = code.w - metrics.gutter - 2 * metrics.pad;
  const maxChars = Math.max(8, Math.floor(textW / (big ? 8.2 : 6.8)));
  const view = codeLines(content, rows, maxChars);
  const lineY = (index: number) => code.y + metrics.pad + index * metrics.lineH;
  const radius = 10;
  // Previewing a commit shows what it changed compared with its (first) parent.
  const parent = commit?.parentId ? state.commits[commit.parentId]?.snapshot.content ?? "" : "";
  const diff = commit ? lineDiff(parent, commit.snapshot.content) : null;
  const counts = diff ? diffCounts(diff) : null;
  const shownDiff = diff ? diffWindow(diff, rows) : null;
  // While previewing, the file name tab gives way so the “+N −M” badge always fits beside it.
  const tabW = commit ? Math.min(tab.w, Math.max(72, editor.w - 120)) : tab.w;
  return <Group x={box.x} y={box.y} listening={false}>
    <Rect width={box.w} height={box.h} cornerRadius={12} fill={commit ? C.previewFill : C.fileCol} stroke={tone.stroke} strokeWidth={commit || model.working.tone === "pending" ? 2 : 1} />
    <Label x={12} y={big ? 12 : 9} width={box.w - 24} text={commit ? `โค้ดของ ${commit.id} (ดูอย่างเดียว)` : layout.view === "branch" ? `ไฟล์ที่แก้อยู่ (branch ${currentBranch(state.machines[machine])})` : "ไฟล์ที่แก้อยู่"} size={big ? 17 : 13} bold color={commit ? "#1D4ED8" : C.title} font={font} />
    <Rect x={editor.x} y={editor.y} width={editor.w} height={editor.h} cornerRadius={radius} fill={EDITOR.bg} />
    <Rect x={editor.x} y={editor.y} width={editor.w} height={tab.h} cornerRadius={[radius, radius, 0, 0]} fill={EDITOR.bar} />
    <Rect x={tab.x} y={tab.y} width={tabW} height={tab.h} cornerRadius={[radius, tabW < editor.w ? 6 : radius, 0, 0]} fill={EDITOR.bg} />
    <Circle x={tab.x + 12} y={tab.y + tab.h / 2} radius={big ? 4 : 3} fill={EDITOR.dot} />
    <Label x={tab.x + 22} y={tab.y} width={tabW - 30} text={snapshot?.name || "—"} size={big ? 13 : 11} color={EDITOR.text} font={font} lineHeight={tab.h} />
    {commit && counts && <Label x={tab.x + tabW + 8} y={tab.y} width={editor.w - tabW - 18}
      text={editor.w - tabW > 110 ? `${commit.id} · +${counts.added} −${counts.removed}` : `+${counts.added} −${counts.removed}`} size={12} bold color={EDITOR.badge} align="right" font={font} lineHeight={tab.h} />}
    {shownDiff ? <>
      {shownDiff.lines.map((line, index) => {
        const added = line.kind === "add", removed = line.kind === "del";
        return <Group key={index}>
          {(added || removed) && <Rect x={code.x + 2} y={lineY(index)} width={code.w - 4} height={metrics.lineH} fill={added ? "#22C55E" : "#EF4444"} opacity={0.2} />}
          {metrics.gutter > 0 && <Label x={code.x} y={lineY(index)} width={metrics.gutter - 6} text={added ? "+" : removed ? "−" : String(line.line)} size={added || removed ? metrics.size : metrics.gutterSize}
            bold={added || removed} color={added ? "#4ADE80" : removed ? "#F87171" : EDITOR.gutter} align="right" font={font} lineHeight={metrics.lineH} />}
          <Label x={textX} y={lineY(index)} width={textW} text={metrics.gutter > 0 ? line.text : `${added ? "+ " : removed ? "− " : "  "}${line.text}`}
            size={metrics.size} color={added ? "#BBF7D0" : removed ? "#FECACA" : EDITOR.text} strike={removed} font={font} lineHeight={metrics.lineH} />
        </Group>;
      })}
      {shownDiff.lines.length === 0 && <Label x={textX} y={lineY(0)} width={textW} text="(ไม่มีบรรทัดที่เปลี่ยน)" size={metrics.size} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />}
      {shownDiff.after > 0 && <Label x={textX} y={lineY(shownDiff.lines.length)} width={textW} text={`… อีก ${shownDiff.after} บรรทัด`} size={big ? 13 : 11} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />}
    </> : <>
      {metrics.gutter > 0 && view.lines.map((_, index) => <Label key={`n${index}`} x={code.x} y={lineY(index)} width={metrics.gutter - 6} text={String(index + 1)} size={metrics.gutterSize} color={EDITOR.gutter} align="right" font={font} lineHeight={metrics.lineH} />)}
      {content === ""
        ? <Label x={textX} y={lineY(0)} width={textW} text="(ไฟล์ว่าง)" size={metrics.size} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />
        : view.lines.map((line, index) => <Label key={index} x={textX} y={lineY(index)} width={textW} text={line} size={metrics.size} color={EDITOR.text} font={font} lineHeight={metrics.lineH} />)}
      {view.more > 0 && <Label x={textX} y={lineY(view.lines.length)} width={textW} text={`… อีก ${view.more} บรรทัด`} size={big ? 13 : 11} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />}
    </>}
    <Label x={12} y={box.h - 30} width={box.w - 24} text={commit ? (big ? "เขียว = เพิ่ม · แดง = ลบ · คลิกซ้ำเพื่อกลับ" : "คลิกซ้ำเพื่อกลับ") : model.working.text} size={big ? 15 : 12} bold color={tone.text} font={font} />
  </Group>;
}

const TAG_W = { main: 44, "origin/main": 84 } as const;
const TAG_W_SMALL = { main: 34, "origin/main": 70 } as const;

type TagStyle = { label: string; width: number; fill: string; stroke: string; text: string };
/** main (dark), origin/main (purple), other branches (green), HEAD → current branch (blue, the one the learner is on). */
function tagStyle(row: GraphRow, tag: string, small: boolean): TagStyle {
  const head = row.headTag === tag;
  const label = head ? `HEAD → ${tag}` : tag;
  const known = !head && (tag === "main" || tag === "origin/main") ? (small ? TAG_W_SMALL : TAG_W)[tag] : null;
  const width = known ?? Math.min(small ? 130 : 168, Math.round([...label].length * (small ? 6.4 : 7.6) + (small ? 14 : 20)));
  if (head) return { label, width, fill: "#2563EB", stroke: "#1D4ED8", text: "#FFFFFF" };
  if (tag === "main") return { label, width, fill: "#0F172A", stroke: "#0F172A", text: "#FFFFFF" };
  if (tag === "origin/main") return { label, width, fill: "#FFFFFF", stroke: "#7C3AED", text: "#6D28D9" };
  return { label, width, fill: "#F0FDF4", stroke: "#16A34A", text: "#15803D" };
}

/**
 * Commit circles (ID inside, colour per commit) with parent lines, branch tags and the commit message.
 * Wide lists: one line (message left, tags right). Narrow lists: two lines — small tags on top, the message
 * under them — so the message is never squeezed out (`commitListStyle`). Each branch with commits has its own lane.
 */
function CommitList({ box, rows, hiddenCount, twoLine, rowH, selected, font, headHint = false }: { box: Box; rows: GraphRow[]; hiddenCount: number; twoLine: boolean; rowH: number; selected: string | null; font: string; headHint?: boolean }) {
  const index = new Map(rows.map((row, position) => [row.id, position]));
  const compact = twoLine;
  const cy = (position: number) => COMMIT_LIST.top + position * rowH + (twoLine ? rowH / 2 : 14);
  const metrics = laneMetrics(Math.max(1, ...rows.map((row) => row.lane + 1)), twoLine);
  const lane = (value: number) => metrics.x0 + value * metrics.gap;
  const radius = metrics.radius;
  const textX = metrics.textX;
  const tagH = twoLine ? 16 : 20;
  const headWidth = headHint ? 176 : 0;
  return <Group x={box.x} y={box.y} listening={false}>
    <Rect width={box.w} height={box.h} cornerRadius={10} fill="#FFFFFF" stroke={C.cardStroke} />
    <Label x={10} y={9} width={hiddenCount > 0 ? box.w - 90 - headWidth : box.w - 20 - headWidth} text="Commits" size={14} bold color={C.title} font={font} />
    {headHint && <Label x={box.w - 10 - headWidth - (hiddenCount > 0 ? 84 : 0)} y={10} width={headWidth} text="HEAD = คุณอยู่ที่นี่" size={12} bold color="#1D4ED8" align="right" font={font} />}
    {hiddenCount > 0 && <Label x={box.w - 94} y={10} width={84} text={`+${hiddenCount} ก่อนหน้า`} size={11} color={C.muted} align="right" font={font} />}
    {rows.length === 0 && <Label x={10} y={COMMIT_LIST.top + 6} width={box.w - 20} text="ยังไม่มี commit" size={13} color={C.muted} font={font} />}
    {rows.map((row, position) => row.id === selected
      ? <Rect key={`sel-${row.id}`} x={4} y={COMMIT_LIST.top + position * rowH} width={box.w - 8} height={rowH - 2} cornerRadius={8} fill={C.previewFill} stroke={C.previewStroke} />
      : null)}
    {rows.flatMap((row, position) => [row.parentId, row.mergeParentId].map((parentId, which) => {
      const key = `e-${row.id}-${which}`;
      const parent = parentId ? index.get(parentId) : undefined;
      if (parent !== undefined) return <Line key={key} points={[lane(row.lane), cy(position), lane(rows[parent].lane), cy(parent)]} stroke="#94A3B8" strokeWidth={3} lineCap="round" />;
      if (parentId) return <Line key={key} points={[lane(row.lane), cy(position), lane(row.lane) + which * 10, cy(position) + 26]} stroke="#CBD5E1" strokeWidth={3} dash={[4, 4]} />;
      return null;
    }))}
    {rows.map((row, position) => {
      const y = cy(position);
      const styles = row.tags.map((tag) => tagStyle(row, tag, twoLine));
      const tagsWidth = styles.reduce((sum, tag) => sum + tag.width + 4, 0);
      // Wide: tags at the right end of the line. Narrow: tags on the first line, message on the second.
      let tagX = compact ? textX : box.w - 8 - tagsWidth;
      const tagY = compact ? y - 18 : y - 10;
      const message = compact
        ? <Label x={textX} y={row.tags.length ? y + 2 : y - 8} width={box.w - textX - 8} text={row.message} size={13} color={C.text} font={font} />
        : <Label x={textX} y={y - 8} width={Math.max(20, box.w - 12 - tagsWidth - textX)} text={row.message} size={14} font={font} />;
      return <Group key={row.id}>
        {row.headTag && <Circle x={lane(row.lane)} y={y} radius={radius + 4} stroke="#2563EB" strokeWidth={2.5} />}
        <Circle x={lane(row.lane)} y={y} radius={radius} fill={row.color} stroke={row.id === selected ? "#1D4ED8" : "#FFFFFF"} strokeWidth={row.id === selected ? 3 : 2} />
        <Label x={lane(row.lane) - radius} y={y - 7} width={radius * 2} text={row.id} size={radius < 14 ? 10 : 12} bold color="#FFFFFF" align="center" font={font} />
        {message}
        {styles.map((style) => {
          const node = <Group key={style.label} x={tagX} y={tagY}>
            <Rect width={style.width} height={tagH} cornerRadius={tagH / 2} fill={style.fill} stroke={style.stroke} strokeWidth={compact ? 1 : 1.5} />
            <Label x={0} y={0} width={style.width} text={style.label} size={compact ? 10 : 12} bold color={style.text} align="center" font={font} lineHeight={tagH} />
          </Group>;
          tagX += style.width + 4;
          return node;
        })}
      </Group>;
    })}
  </Group>;
}

/** RIGHT: the Git side of a machine (staging area → Commit → commits). */
function GitColumn({ layout, machine, state, selected, font }: { layout: WidgetLayout; machine: MachineId; state: GitSimulationState; selected: string | null; font: string }) {
  const { view, compact } = layout;
  const box = layout[machine]!.git;
  const model = machineDiagram(state, machine);
  const graph = commitGraph(state, machine, commitRowLimit(layout, machine));
  // Steps without GitHub hide tracking tags and the sync pill; only the Branch step names other branches and HEAD.
  const branchStep = view === "branch";
  const keep = (tag: string) => branchStep ? tag !== "origin/main" : tag === "main" || (viewHasRemote(view) && tag === "origin/main");
  const rows = graph.rows.map((row) => ({ ...row, tags: row.tags.filter(keep), headTag: branchStep ? row.headTag : null }));
  const staged = TONE[model.staged.tone];
  const g = GIT_COLUMN;
  const shift = gitShift(view);
  const list = commitListBox(layout, machine)!;
  return <Group listening={false}>
    <Group x={box.x} y={box.y}>
      <Rect width={box.w} height={box.h} cornerRadius={12} fill={C.gitCol} stroke={C.cardStroke} />
      <Label x={12} y={10} width={box.w - 24} text={machine === "A" ? "Git ของเครื่อง A" : "Git ของเครื่อง B"} size={compact ? 14 : 17} bold color={C.title} font={font} />
      {branchStep && <Pill x={8} y={g.pill + 8} width={box.w - 16} line={branchPill(state, machine)} font={font} />}
      {viewHasRemote(view) && <Pill x={8} y={g.pill + 8} width={box.w - 16} line={compact ? { ...model.sync, text: shortSyncText(model.sync.text) } : model.sync} font={font} />}
      <Group x={8} y={g.stageY + 8 + shift}>
        <Rect width={box.w - 16} height={g.stageH} cornerRadius={10} fill={staged.fill} stroke={staged.stroke} strokeWidth={model.staged.tone === "ready" ? 2 : 1} />
        <Label x={10} y={8} width={box.w - 36} text={compact ? "Staging" : "Staging (สิ่งที่ Add แล้ว)"} size={14} bold color={C.title} font={font} />
        <Label x={10} y={32} width={box.w - 36} text={model.staged.text} size={compact ? 12 : 14} bold color={staged.text} font={font} />
      </Group>
      <Arrow points={[box.w / 2, g.commitArrowY + 10 + shift, box.w / 2, g.commitsY + 4 + shift]} stroke={C.arrow} fill={C.arrow} strokeWidth={2} pointerLength={7} pointerWidth={8} />
      <Label x={box.w / 2 + 8} y={g.commitArrowY + 12 + shift} width={box.w / 2 - 12} text="Commit" size={13} bold color={C.arrow} font={font} />
    </Group>
    <CommitList box={list} rows={rows} hiddenCount={graph.hiddenCount} {...commitListStyle(layout, machine)} selected={selected} font={font} headHint={branchStep} />
  </Group>;
}

function CardFrame({ box, active, fill }: { box: Box; active: boolean; fill: string }) {
  return <Rect x={box.x} y={box.y} width={box.w} height={box.h} cornerRadius={16} fill={fill}
    stroke={active ? C.active : C.cardStroke} strokeWidth={active ? 3 : 1.5}
    shadowColor="#0F172A" shadowOpacity={0.06} shadowBlur={12} shadowOffsetY={2} listening={false} />;
}

function MachineCard({ layout, machine, state, active, preview, font }: {
  layout: WidgetLayout; machine: MachineId; state: GitSimulationState; active: boolean; preview: GitPreview | null; font: string;
}) {
  const repo = state.machines[machine];
  const { card, file, git, stageGap } = layout[machine] as MachineLayout;
  const stageY = git.y + GIT_COLUMN.stageY + 8 + gitShift(layout.view) + GIT_COLUMN.stageH / 2;
  const selected = preview?.repository === machine ? preview.commitId : null;
  return <Group>
    <CardFrame box={card} active={active} fill={C.card} />
    <Label x={card.x + 18} y={card.y + 14} width={card.w - 36} text={machine === "A" ? "เครื่อง A" : "เครื่อง B"} size={22} bold color={C.title} font={font} />
    {repo.initialized ? <>
      <FileColumn layout={layout} machine={machine} state={state} previewCommit={selected} font={font} />
      <Arrow points={[stageGap.x1 + 4, stageY, stageGap.x2 - 4, stageY]} stroke={C.arrow} fill={C.arrow} strokeWidth={2.5} pointerLength={9} pointerWidth={9} listening={false} />
      <Label x={stageGap.x1 - 6} y={stageY - 24} width={stageGap.x2 - stageGap.x1 + 12} text="Add" size={13} bold color={C.arrow} align="center" font={font} />
      <GitColumn layout={layout} machine={machine} state={state} selected={selected} font={font} />
    </> : <Group x={file.x} y={file.y} listening={false}>
      <Rect width={git.x + git.w - file.x} height={file.h} cornerRadius={12} stroke="#CBD5E1" strokeWidth={2} dash={[8, 6]} />
      <Label x={0} y={file.h / 2 - 40} width={git.x + git.w - file.x} text="ยังไม่ได้ Clone" size={22} bold color={C.muted} align="center" font={font} />
      <Text x={16} y={file.h / 2} width={git.x + git.w - file.x - 32} text={"ยังไม่มีไฟล์และ Git บนเครื่องนี้\nกด Clone เพื่อคัดลอกจาก GitHub"} fontSize={15} fontFamily={font}
        fill={C.muted} align="center" lineHeight={1.5} listening={false} />
    </Group>}
  </Group>;
}

/** GitHub: no working file, only commits. Its file box shows the pushed file of `main` (or of the clicked commit). */
function RemoteCard({ layout, state, active, preview, font }: { layout: WidgetLayout; state: GitSimulationState; active: boolean; preview: GitPreview | null; font: string }) {
  const box = layout.remote!;
  const compact = layout.compact;
  const model = remoteDiagram(state);
  const graph = commitGraph(state, "remote", commitRowLimit(layout, "remote"));
  const inner = { x: box.x + 10, w: box.w - 20 };
  const colY = box.y + 52;
  const selected = preview?.repository === "remote" ? preview.commitId : null;
  const shown = selected ? state.commits[selected] : null;
  const commitId = shown?.id ?? state.remote.mainHead;
  const file = commitId ? state.commits[commitId]?.snapshot ?? null : null;
  const frame = remoteFileBox(layout)!;
  const code = remoteCodeBox(layout)!;
  const tabH = code.y - frame.y;
  const metrics = remoteCodeText(layout);
  const rows = Math.max(1, Math.floor((code.h - 2 * metrics.pad) / metrics.lineH));
  const textX = code.x + metrics.gutter + metrics.pad;
  const textW = code.w - metrics.gutter - 2 * metrics.pad;
  const view = file ? codeLines(file.content, rows, Math.max(8, Math.floor(textW / (compact ? 6.2 : 7.2)))) : { lines: [], more: 0 };
  const lineY = (index: number) => code.y + metrics.pad + index * metrics.lineH;
  // Which commit the file comes from, in the tab bar: "C2 • main" normally, "C2 • ดูอย่างเดียว" while previewing.
  const badge = commitId ? (compact ? commitId : `${commitId} • ${shown ? "ดูอย่างเดียว" : "main"}`) : "";
  return <Group>
    <CardFrame box={box} active={active} fill={C.remoteCard} />
    <Label x={box.x + 16} y={box.y + 14} width={box.w - 32} text="GitHub" size={22} bold color={C.title} font={font} />
    <Label x={inner.x + 2} y={colY + REMOTE_COLUMN.subtitleY} width={inner.w - 4} text={compact ? "เก็บ commit ที่ Push ขึ้นมา" : "เก็บ commit ที่ Push ขึ้นมา (แก้ไฟล์ตรงนี้ไม่ได้)"} size={compact ? 11 : 13} color={C.muted} font={font} />
    <Pill x={inner.x} y={colY + REMOTE_COLUMN.pillY} width={inner.w} line={model.sync} font={font} />
    {file ? <Group listening={false}>
      <Rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} cornerRadius={10} fill={EDITOR.bg} stroke={shown ? C.previewStroke : undefined} strokeWidth={shown ? 2.5 : 0} />
      <Rect x={frame.x} y={frame.y} width={frame.w} height={tabH} cornerRadius={[10, 10, 0, 0]} fill={EDITOR.bar} />
      <Circle x={frame.x + 12} y={frame.y + tabH / 2} radius={compact ? 3 : 3.5} fill={EDITOR.dot} />
      <Label x={frame.x + 21} y={frame.y} width={frame.w * 0.55 - 21} text={file.name} size={compact ? 11 : 12} color={EDITOR.text} font={font} lineHeight={tabH} />
      <Label x={frame.x + frame.w * 0.55} y={frame.y} width={frame.w * 0.45 - 10} text={badge} size={compact ? 10 : 11} color={shown ? EDITOR.badge : EDITOR.muted} align="right" font={font} lineHeight={tabH} />
      {metrics.gutter > 0 && view.lines.map((_, index) => <Label key={`n${index}`} x={code.x} y={lineY(index)} width={metrics.gutter - 6} text={String(index + 1)} size={metrics.gutterSize} color={EDITOR.gutter} align="right" font={font} lineHeight={metrics.lineH} />)}
      {file.content === ""
        ? <Label x={textX} y={lineY(0)} width={textW} text="(ไฟล์ว่าง)" size={metrics.size} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />
        : view.lines.map((line, index) => <Label key={index} x={textX} y={lineY(index)} width={textW} text={line} size={metrics.size} color={EDITOR.text} font={font} lineHeight={metrics.lineH} />)}
      {view.more > 0 && <Label x={textX} y={lineY(view.lines.length)} width={textW} text={`… อีก ${view.more} บรรทัด`} size={compact ? 10 : 11} color={EDITOR.muted} font={font} lineHeight={metrics.lineH} />}
    </Group> : <Group x={frame.x} y={frame.y} listening={false}>
      <Rect width={frame.w} height={frame.h} cornerRadius={10} fill="#FFFFFF" stroke="#DDD6FE" dash={[6, 5]} />
      <Label x={10} y={frame.h / 2 - 22} width={frame.w - 20} text="ยังไม่มีไฟล์บน GitHub" size={compact ? 11 : 14} bold color={C.muted} align="center" font={font} />
      <Label x={10} y={frame.h / 2 + 2} width={frame.w - 20} text="รอ Push ครั้งแรก" size={compact ? 11 : 13} color={C.muted} align="center" font={font} />
    </Group>}
    <CommitList box={commitListBox(layout, "remote")!} rows={graph.rows} hiddenCount={graph.hiddenCount} {...commitListStyle(layout, "remote")} selected={selected} font={font} />
  </Group>;
}

function ConnectorArrows({ layout, bCloned, font }: { layout: WidgetLayout; bCloned: boolean; font: string }) {
  const arrow = { stroke: C.arrow, fill: C.arrow, strokeWidth: 3, pointerLength: 11, pointerWidth: 11, listening: false } as const;
  // Narrow gaps show just the word; the arrowheads already give the direction.
  const label = (gap: { x1: number; x2: number }, y: number, text: string) =>
    <Label x={gap.x1 - 4} y={y} width={gap.x2 - gap.x1 + 8} text={layout.compact ? text.replace(/[←→]/g, "").trim() : text} size={layout.compact ? 13 : 14} bold color={C.arrow} align="center" font={font} />;
  const { left, right, pushY, pullY } = layout;
  return <Group listening={false}>
    {left && <>
      {label(left, pushY - 24, "Push →")}
      <Arrow points={[left.x1, pushY, left.x2, pushY]} {...arrow} />
      <Arrow points={[left.x2, pullY, left.x1, pullY]} {...arrow} />
      {label(left, pullY + 8, "← Pull")}
    </>}
    {right && <>
      {label(right, pushY - 24, "← Push")}
      <Arrow points={[right.x2, pushY, right.x1, pushY]} {...arrow} />
      <Arrow points={[right.x1, pullY, right.x2, pullY]} {...arrow} />
      {label(right, pullY + 8, bCloned ? "Pull →" : "Clone →")}
    </>}
  </Group>;
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

/** Arrow segment used by a transfer, or null for directions without an arrow in this step. */
export function transferSegment(from: RepositoryId, to: RepositoryId, view: GitView = "full"): Segment | null {
  const { left, right, pushY, pullY } = widgetLayout(view);
  if (left && from === "A" && to === "remote") return { x1: left.x1, y1: pushY, x2: left.x2, y2: pushY };
  if (left && from === "remote" && to === "A") return { x1: left.x2, y1: pullY, x2: left.x1, y2: pullY };
  if (right && from === "B" && to === "remote") return { x1: right.x2, y1: pushY, x2: right.x1, y2: pushY };
  if (right && from === "remote" && to === "B") return { x1: right.x1, y1: pullY, x2: right.x2, y2: pullY };
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A dot that runs once along the arrow (GIT_TRANSFER_DURATION_MS). Rendered hidden; the effect animates the Konva node
 * imperatively so React output stays identical (and export never captures a moving dot).
 */
function TransferDot({ transfer, view, font }: { transfer: GitTransferAnimation; view: GitView; font: string }) {
  const groupRef = useRef<Konva.Group>(null);
  const { from, to, key } = transfer;
  const label = transfer.commitIds.length > 2 ? `${transfer.commitIds.length} commit` : transfer.commitIds.join(", ");
  const segment = transferSegment(from, to, view);
  const labelY = segment && segment.y1 === widgetLayout(view).pushY ? 20 : -38;

  useEffect(() => {
    const group = groupRef.current;
    const path = transferSegment(from, to, view);
    if (!group || !path || prefersReducedMotion()) return;
    let frame = 0;
    let start: number | null = null;
    const place = (t: number) => group.position({ x: path.x1 + (path.x2 - path.x1) * t, y: path.y1 + (path.y2 - path.y1) * t });
    const tick = (time: number) => {
      start ??= time;
      const t = Math.min(1, (time - start) / GIT_TRANSFER_DURATION_MS);
      place(t);
      group.visible(t < 1);
      group.getLayer()?.batchDraw();
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    place(0);
    group.visible(true);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      group.visible(false);
      group.getLayer()?.batchDraw();
    };
  }, [from, to, key, view]);

  return <Group ref={groupRef} visible={false} listening={false}>
    <Circle radius={15} fill={C.active} stroke="#FFFFFF" strokeWidth={3} shadowColor="#1D4ED8" shadowOpacity={0.35} shadowBlur={10} />
    <Label x={-60} y={labelY} width={120} text={label} size={15} color={C.active} bold align="center" font={font} />
  </Group>;
}

const TITLES: Record<GitView, string> = {
  local: "Git ในเครื่องเดียว: แก้ไฟล์ → Add → Commit",
  remote: "Git: เครื่อง A → GitHub",
  full: "Git: เครื่อง A ↔ GitHub ↔ เครื่อง B",
  branch: "Git: Branch (ทางแยก) บนเครื่อง A",
};
const FOOTERS: Record<GitView, string> = {
  local: "แบบจำลอง • main เท่านั้น • C1/C2 เป็นหมายเลขจำลอง • ซ้าย = ไฟล์ที่แก้อยู่ • ขวา = สิ่งที่ Git เก็บไว้",
  remote: "แบบจำลอง • main เท่านั้น • สีเดียวกัน = commit เดียวกัน • ↑↓ เทียบกับ GitHub ล่าสุดที่เครื่องนั้นรู้",
  full: "แบบจำลอง • main เท่านั้น • สีเดียวกัน = commit เดียวกัน • ↑↓ เทียบกับ GitHub ล่าสุดที่เครื่องนั้นรู้",
  branch: "แบบจำลอง • หนึ่งแถว = หนึ่ง branch • HEAD = branch ที่คุณอยู่ • commit ใหม่ต่อท้าย branch ที่อยู่ • สีเดียวกัน = commit เดียวกัน",
};

/**
 * Canvas rendering of a Git simulator node (plan 04 §5). Draw inside a Group already translated to node.x/node.y.
 * Deterministic for export: the same props produce the same drawing; no DOM measurement.
 */
export function GitWidgetView({ node, activeTab, transfer, preview = null, fontFamily }: {
  node: GitSimulatorNode;
  /** editor passes the machine chosen in the Git panel to highlight its card; export passes null */
  activeTab: GitTab | null;
  /** transfer animation (a dot along the arrow). export passes null. */
  transfer: GitTransferAnimation | null;
  /** read-only commit preview in a file area (session only). export passes null. */
  preview?: GitPreview | null;
  /** fontFamily for all Text */
  fontFamily: string;
}): JSX.Element {
  const { scale, state } = node;
  const view = gitViewOf(node);
  const layout = useMemo(() => widgetLayout(view), [view]);
  const width = widgetWidth(view);
  // A preview of a commit the repository no longer knows (e.g. after Undo) falls back to the working file.
  const validPreview = preview && (preview.repository === "remote" ? state.remote.knownCommitIds : state.machines[preview.repository].knownCommitIds).includes(preview.commitId) ? preview : null;
  return <Group scaleX={scale} scaleY={scale} clipX={0} clipY={0} clipWidth={width} clipHeight={WIDGET_H}>
    <Rect x={1} y={1} width={width - 2} height={WIDGET_H - 2} cornerRadius={18} fill={C.frame} stroke={C.frameStroke} strokeWidth={2} />
    <Label x={24} y={18} width={width - 48} text={TITLES[view]} size={24} bold color={C.title} font={fontFamily} />
    <ConnectorArrows layout={layout} bCloned={state.machines.B.initialized} font={fontFamily} />
    <MachineCard layout={layout} machine="A" state={state} active={activeTab === "A" && view === "full"} preview={validPreview} font={fontFamily} />
    {layout.remote && <RemoteCard layout={layout} state={state} active={false} preview={validPreview} font={fontFamily} />}
    {layout.B && <MachineCard layout={layout} machine="B" state={state} active={activeTab === "B"} preview={validPreview} font={fontFamily} />}
    <Label x={24} y={WIDGET_H - 34} width={width - 48} size={13} color={C.muted} font={fontFamily} text={FOOTERS[view]} />
    {transfer && <TransferDot key={transfer.key} transfer={transfer} view={view} font={fontFamily} />}
  </Group>;
}
