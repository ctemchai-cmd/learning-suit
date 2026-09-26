import type { FileSnapshot, MachineId } from "../git/model";
import type { CodeNode, ProjectContent, TextNode } from "./model";

export type Camera = { x: number; y: number; zoom: number };

export type PendingEdit =
  | { kind: "text"; slideId: string; nodeId: string; before: TextNode | null; draft: TextNode }
  | { kind: "git-file"; slideId: string; nodeId: string; machine: MachineId; before: FileSnapshot; draft: FileSnapshot }
  | { kind: "code"; slideId: string; nodeId: string; before: CodeNode; draft: CodeNode };

export interface LocalDraft {
  localVersion: 1;
  ownerId: string;
  projectId: string;
  content: ProjectContent;
  /** null = never published; a reservation may already exist on the server. */
  baseRevision: number | null;
  localSequence: number;
  acknowledgedSequence: number;
  pendingEdit: PendingEdit | null;
  /** Display/debug only; never used to resolve conflicts. */
  savedAt: string;
}

/** Durable, immutable in-flight cloud save. Retries reuse the same mutationId and content. */
export interface SaveJob {
  ownerId: string;
  projectId: string;
  mutationId: string;
  /** 0 for the first publish of a reserved project. */
  expectedRevision: number;
  localSequence: number;
  content: ProjectContent;
  createdAt: string;
}

export type DeletionPhase = "requested" | "tombstoned" | "storage-cleaned" | "done";
export interface DeletionJob {
  ownerId: string;
  projectId: string;
  mutationId: string;
  expectedRevision: number | null;
  phase: DeletionPhase;
  title: string;
  createdAt: string;
}
