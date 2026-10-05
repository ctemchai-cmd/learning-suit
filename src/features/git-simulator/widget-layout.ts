import { gitBaseSize, type GitView } from "../../domain/document/model";

// Pure geometry of the Git widget per lesson step (plan 04 §5). Steps 1–2 draw in a 1120×680 base frame;
// the two-machine step is 1600×680 so every machine keeps the full-size layout. The domain's
// `gitBaseSize` is the single source for bounds/transform/export; the layout reads the same size.

export const WIDGET_H = gitBaseSize("local").height;
export const widgetWidth = (view: GitView) => gitBaseSize(view).width;
export const CARD_Y = 64;
export const CARD_H = 560;
const CARD_PAD = 18;
const HEADER_H = 52;

export type Box = { x: number; y: number; w: number; h: number };
export type MachineLayout = { card: Box; file: Box; git: Box; /** gap between file and Git columns (Stage arrow) */ stageGap: { x1: number; x2: number } };
export type WidgetLayout = {
  view: GitView;
  A: MachineLayout;
  remote: Box | null;
  B: MachineLayout | null;
  /** Arrow channels between cards at the commits level. */
  left: { x1: number; x2: number } | null;
  right: { x1: number; x2: number } | null;
  pushY: number;
  pullY: number;
  /** Narrow Git columns hide commit messages (IDs, colours and tags stay). */
  compact: boolean;
};

/** Git column internals, relative to the column's top-left. */
export const GIT_COLUMN = { title: 0, pill: 26, stageY: 64, stageH: 62, commitArrowY: 128, commitsY: 158 } as const;

function machine(x: number, width: number, fileWidth: number, gap: number): MachineLayout {
  const innerY = CARD_Y + HEADER_H;
  const innerH = CARD_H - HEADER_H - CARD_PAD;
  const file: Box = { x: x + CARD_PAD, y: innerY, w: fileWidth, h: innerH };
  const gitX = file.x + fileWidth + gap;
  const git: Box = { x: gitX, y: innerY, w: x + width - CARD_PAD - gitX, h: innerH };
  return { card: { x, y: CARD_Y, w: width, h: CARD_H }, file, git, stageGap: { x1: file.x + fileWidth, x2: gitX } };
}

export function widgetLayout(view: GitView): WidgetLayout {
  const pushY = CARD_Y + HEADER_H + GIT_COLUMN.commitsY + 96;
  const pullY = pushY + 64;
  if (view === "local" || view === "branch") {
    const A = machine(24, 1072, 480, 72);
    return { view, A, remote: null, B: null, left: null, right: null, pushY, pullY, compact: false };
  }
  if (view === "remote") {
    const A = machine(24, 680, 280, 64);
    const remote: Box = { x: 776, y: CARD_Y, w: 320, h: CARD_H };
    return { view, A, remote, B: null, left: { x1: A.card.x + A.card.w + 6, x2: remote.x - 6 }, right: null, pushY, pullY, compact: false };
  }
  const A = machine(20, 558, 236, 52);
  const remote: Box = { x: 650, y: CARD_Y, w: 300, h: CARD_H };
  const B = machine(1022, 558, 236, 52);
  return {
    view, A, remote, B,
    left: { x1: A.card.x + A.card.w + 6, x2: remote.x - 6 },
    right: { x1: remote.x + remote.w + 6, x2: B.card.x - 6 },
    pushY, pullY, compact: false,
  };
}

/** Machines and tabs that exist in a lesson step (the Git panel shows only these). */
export function viewRepositories(view: GitView): ("A" | "remote" | "B")[] {
  return view === "local" || view === "branch" ? ["A"] : view === "remote" ? ["A", "remote"] : ["A", "remote", "B"];
}

export const GIT_VIEWS: { id: GitView; label: string; description: string }[] = [
  { id: "local", label: "A → Git", description: "แก้ไฟล์ แล้ว Add และ Commit ในเครื่องเดียว" },
  { id: "remote", label: "A → Git → GitHub", description: "ส่ง commit ขึ้น GitHub ด้วย Push และรับด้วย Pull" },
  { id: "full", label: "A+Git → GitHub → B+Git", description: "สองเครื่องทำงานร่วมกันผ่าน GitHub (Clone / Push / Pull)" },
  { id: "branch", label: "Branch (ทางแยก)", description: "แตกทางแยกลองของใหม่โดย main ไม่โดนกระทบ แล้ว Merge กลับ (สร้าง / สลับ / Merge)" },
];

/** Steps that show GitHub (and so Push / Pull / tracking tags). The Branch step is machine A only. */
export const viewHasRemote = (view: GitView) => view === "remote" || view === "full";

// ---------------------------------------------------------------------------
// Shared geometry for drawing AND for the DOM overlay (edit / commit buttons).
// ---------------------------------------------------------------------------

/** Step 1 has no sync pill, so the Git column contents move up into its place. */
export const gitShift = (view: GitView) => view === "local" ? -30 : 0;

/** File column internals: a small code editor (tab bar with the file name, then code with line numbers). */
export const FILE_COLUMN = { editorTopBig: 44, editorTopCompact: 32, tabHBig: 30, tabHCompact: 24, tabWBig: 200, bottomReserve: 40 } as const;
export const COMMIT_LIST = { top: 34, rowH: 38, rowHTwoLine: 42, twoLineBelow: 360 } as const;

/** Text metrics shared by the drawn code and the DOM textarea on top of it, so both line up exactly. */
export function codeText(layout: WidgetLayout) {
  return layout.compact
    ? { size: 12, lineH: 17, gutter: 0, gutterSize: 10, pad: 8 }
    : { size: 15, lineH: 22, gutter: 36, gutterSize: 12, pad: 8 };
}

export function machineOf(layout: WidgetLayout, machine: "A" | "B"): MachineLayout | null {
  return machine === "A" ? layout.A : layout.B;
}

/** Whole editor frame (tab bar + code) inside a machine's file column (widget base coordinates). */
export function fileEditorBox(layout: WidgetLayout, machine: "A" | "B"): Box | null {
  const target = machineOf(layout, machine);
  if (!target) return null;
  const top = layout.compact ? FILE_COLUMN.editorTopCompact : FILE_COLUMN.editorTopBig;
  const { file } = target;
  return { x: file.x + 10, y: file.y + top, w: file.w - 20, h: file.h - top - FILE_COLUMN.bottomReserve };
}

/** File name tab at the left of the editor's tab bar. */
export function fileNameBox(layout: WidgetLayout, machine: "A" | "B"): Box | null {
  const editor = fileEditorBox(layout, machine);
  if (!editor) return null;
  const h = layout.compact ? FILE_COLUMN.tabHCompact : FILE_COLUMN.tabHBig;
  return { x: editor.x, y: editor.y, w: layout.compact ? editor.w : Math.min(editor.w, FILE_COLUMN.tabWBig), h };
}

/** Editable code area (line numbers + text) under the tab bar. */
export function fileCodeBox(layout: WidgetLayout, machine: "A" | "B"): Box | null {
  const editor = fileEditorBox(layout, machine);
  if (!editor) return null;
  const tab = layout.compact ? FILE_COLUMN.tabHCompact : FILE_COLUMN.tabHBig;
  return { x: editor.x, y: editor.y + tab, w: editor.w, h: editor.h - tab };
}

/** GitHub card internals, relative to the card's content top (`remote.y + 52`). */
export const REMOTE_COLUMN = { subtitleY: 10, pillY: 34, fileY: 72, fileH: 150, listGap: 12, tabH: 26, tabHCompact: 22 } as const;

/** Read-only file of a GitHub commit (tab bar + code) on the GitHub card. */
export function remoteFileBox(layout: WidgetLayout): Box | null {
  const remote = layout.remote;
  if (!remote) return null;
  return { x: remote.x + 10, y: remote.y + 52 + REMOTE_COLUMN.fileY, w: remote.w - 20, h: REMOTE_COLUMN.fileH };
}

/** Code area of the GitHub file (below its tab bar). */
export function remoteCodeBox(layout: WidgetLayout): Box | null {
  const file = remoteFileBox(layout);
  if (!file) return null;
  const tab = layout.compact ? REMOTE_COLUMN.tabHCompact : REMOTE_COLUMN.tabH;
  return { x: file.x, y: file.y + tab, w: file.w, h: file.h - tab };
}

/** Text metrics of the GitHub file (smaller than a machine's editor: the card is narrower). */
export function remoteCodeText(layout: WidgetLayout) {
  return layout.compact
    ? { size: 11, lineH: 15, gutter: 0, gutterSize: 9, pad: 6 }
    : { size: 13, lineH: 18, gutter: 28, gutterSize: 11, pad: 8 };
}

export function commitListBox(layout: WidgetLayout, repository: "A" | "B" | "remote"): Box | null {
  if (repository === "remote") {
    const remote = layout.remote;
    const file = remoteFileBox(layout);
    if (!remote || !file) return null;
    const y = file.y + file.h + REMOTE_COLUMN.listGap;
    return { x: remote.x + 10, y, w: remote.w - 20, h: remote.y + remote.h - y - 18 };
  }
  const target = machineOf(layout, repository);
  if (!target) return null;
  const shift = gitShift(layout.view);
  const { git } = target;
  return { x: git.x + 8, y: git.y + GIT_COLUMN.commitsY + 8 + shift, w: git.w - 16, h: git.h - GIT_COLUMN.commitsY - 16 - shift };
}

/**
 * Rows of a commit list: one line (message left, tags right) when the list is wide; two lines (small tags
 * over the message) when narrow, so the message is never squeezed out by the tags.
 */
export function commitListStyle(layout: WidgetLayout, repository: "A" | "B" | "remote"): { twoLine: boolean; rowH: number } {
  const list = commitListBox(layout, repository);
  const twoLine = layout.compact || !list || list.w < COMMIT_LIST.twoLineBelow;
  return { twoLine, rowH: twoLine ? COMMIT_LIST.rowHTwoLine : COMMIT_LIST.rowH };
}

/** How many commit rows fit in a repository's list (the drawing and the click targets use the same number). */
export function commitRowLimit(layout: WidgetLayout, repository: "A" | "B" | "remote"): number {
  const list = commitListBox(layout, repository);
  if (!list) return 0;
  return Math.max(1, Math.floor((list.h - COMMIT_LIST.top - 4) / commitListStyle(layout, repository).rowH));
}

export function commitRowBox(layout: WidgetLayout, repository: "A" | "B" | "remote", index: number): Box | null {
  const list = commitListBox(layout, repository);
  if (!list) return null;
  const { rowH } = commitListStyle(layout, repository);
  return { x: list.x, y: list.y + COMMIT_LIST.top + index * rowH, w: list.w, h: rowH };
}
