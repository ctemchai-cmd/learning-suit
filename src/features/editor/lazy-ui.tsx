"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

// Parts of the editor that are not needed to draw the first board: the five simulator panels (only when a widget is
// selected), the export dialog (with pdf-lib), the shortcut sheet and the context menu. They load as separate chunks,
// and `preloadSecondaryUi` fetches them in the background once the board is up so the first click does not wait.

function PanelPlaceholder() {
  return <div className="p-4 text-sm muted" role="status">กำลังเปิดแผงตัวจำลอง…</div>;
}

export const GitPanel = dynamic(() => import("@/features/git-simulator/git-panel").then((module) => module.GitPanel), { ssr: false, loading: PanelPlaceholder });
export const DataPanel = dynamic(() => import("@/features/data-simulator/data-panel").then((module) => module.DataPanel), { ssr: false, loading: PanelPlaceholder });
export const DeployPanel = dynamic(() => import("@/features/deploy-simulator/deploy-panel").then((module) => module.DeployPanel), { ssr: false, loading: PanelPlaceholder });
export const AiPanel = dynamic(() => import("@/features/ai-simulator/ai-panel").then((module) => module.AiPanel), { ssr: false, loading: PanelPlaceholder });
export const SshPanel = dynamic(() => import("@/features/ssh-simulator/ssh-panel").then((module) => module.SshPanel), { ssr: false, loading: PanelPlaceholder });
export const ExportDialog = dynamic(() => import("./export-dialog"), { ssr: false });
export const ShortcutHelp = dynamic(() => import("./shortcut-help"), { ssr: false });
export const ContextMenu = dynamic(() => import("./context-menu"), { ssr: false });

/** Downloads the lazy chunks without rendering them; failures are ignored (they load on demand anyway). */
export function preloadSecondaryUi(): void {
  const loaders = [
    () => import("@/features/git-simulator/git-panel"), () => import("@/features/data-simulator/data-panel"),
    () => import("@/features/deploy-simulator/deploy-panel"), () => import("@/features/ai-simulator/ai-panel"),
    () => import("@/features/ssh-simulator/ssh-panel"), () => import("./export-dialog"), () => import("./shortcut-help"), () => import("./context-menu"),
  ];
  for (const load of loaders) void load().catch(() => undefined);
}

/** True from the first time `flag` is true on: lets a lazy dialog mount only once it is wanted, then stay mounted (keeps its close animation). */
export function useOnceTrue(flag: boolean): boolean {
  const [seen, setSeen] = useState(flag);
  if (flag && !seen) setSeen(true);
  return seen;
}
