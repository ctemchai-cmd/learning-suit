import type { GitSimulatorNode } from "@/domain/document/model";
import type { PendingEdit } from "@/domain/document/session";
import { applyGitAction } from "@/domain/git/reducer";
import type { FileSnapshot, MachineId } from "@/domain/git/model";
import { validateFileSnapshot } from "@/domain/git/selectors";
import { useEditorStore } from "@/features/editor/store";

// The file being edited on the board (plan 04 §5 "inline file editor") lives in the editor store's
// pendingEdit: the canvas textarea writes it, the Git panel reads it for button states, and ONE
// flusher turns it into a single "Edit" transaction before any other change (blur, Add, selection…).

export type GitFileEdit = Extract<PendingEdit, { kind: "git-file" }>;

/** True while an IME composition is running in the board editor (flushing then would split a syllable). */
export const gitDraftComposition = { active: false };

/** The node as currently stored, so actions never start from a stale render. */
export function findGitNode(slideId: string, nodeId: string): GitSimulatorNode | null {
  const slide = useEditorStore.getState().history?.content.document.slides.find((item) => item.id === slideId);
  const node = slide?.nodes.find((item) => item.id === nodeId);
  return node?.type === "git-simulator" ? node : null;
}

export function gitDraftFor(edit: PendingEdit | null, nodeId: string, machine: MachineId): GitFileEdit | null {
  return edit?.kind === "git-file" && edit.nodeId === nodeId && edit.machine === machine ? edit : null;
}

/** Stores a new draft. A draft of another file is flushed first; false if that one cannot be saved yet. */
export function updateGitDraft(slideId: string, nodeId: string, machine: MachineId, file: FileSnapshot): boolean {
  const store = useEditorStore.getState();
  const current = store.pendingEdit;
  if (current && !gitDraftFor(current, nodeId, machine) && !store.flushPendingEdits()) return false;
  const node = findGitNode(slideId, nodeId);
  const before = gitDraftFor(useEditorStore.getState().pendingEdit, nodeId, machine)?.before ?? node?.state.machines[machine].working;
  if (!node || !before) return false;
  store.setPendingEdit({ kind: "git-file", slideId, nodeId, machine, before, draft: file });
  return true;
}

export function cancelGitDraft(): void {
  if (useEditorStore.getState().pendingEdit?.kind === "git-file") useEditorStore.getState().setPendingEdit(null);
}

/** Fields of the board editor carry `data-git-field="<machine>-<field>"`. */
export const gitFieldKey = (machine: MachineId, field: "name" | "content") => `${machine}-${field}`;

function focusField(machine: MachineId, field: "name" | "content") {
  if (typeof document === "undefined") return;
  document.querySelector<HTMLElement>(`[data-git-field="${gitFieldKey(machine, field)}"]`)?.focus();
}

/**
 * Registered once as an editor flusher. Applies the board draft as one Edit transaction.
 * Returns false (and focuses the bad field) while the draft is invalid or mid-composition.
 */
export function flushGitDraft(): boolean {
  const store = useEditorStore.getState();
  const edit = store.pendingEdit;
  if (edit?.kind !== "git-file") return true;
  if (gitDraftComposition.active) return false;
  const node = findGitNode(edit.slideId, edit.nodeId);
  // The widget (or its machine) is gone: nothing left to apply the draft to.
  if (!node || node.locked || !node.state.machines[edit.machine].initialized) {
    store.setPendingEdit(null);
    return true;
  }
  const validation = validateFileSnapshot(edit.draft);
  if (!validation.ok) {
    focusField(edit.machine, validation.field);
    return false;
  }
  const transition = applyGitAction(node.state, { type: "edit", machine: edit.machine, file: validation.file });
  if (transition.code === "INVALID_FILE") {
    focusField(edit.machine, "name");
    return false;
  }
  if (transition.changed && !store.transact({
    label: `Git (จำลอง): แก้ไฟล์ เครื่อง ${edit.machine}`,
    affectedSlideId: edit.slideId,
    commands: [{ type: "nodes.replace", slideId: edit.slideId, nodes: [{ ...node, state: transition.nextState }] }],
  })) return false;
  store.setPendingEdit(null);
  return true;
}
