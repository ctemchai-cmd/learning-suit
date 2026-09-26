"use client";

import { createProjectContent, type ProjectContent } from "@/domain/document/model";
import { duplicateProjectContent } from "@/domain/document/remap";
import { parseProjectContent } from "@/domain/document/schema";
import { importArchiveInWorker } from "@/services/export/archive-client";
import {
  createLocalDraft, deleteLocalProjectData, getLocalAsset, getLocalDraft, getThumbnail, idbDeletionJobStore,
  listLocalDrafts, withWriterLock, writeDraftContent,
} from "@/services/persistence/local-db";
import type { ProjectOpener } from "@/features/editor/store";
import type { CloudUi } from "@/features/editor/editor";
import type { AssetReference } from "@/domain/document/model";

type Router = { push: (href: string) => void; replace: (href: string) => void };

export type ProjectCard = {
  id: string;
  title: string;
  updatedAt: string;
  /** Only in this browser (never published to the cloud). */
  localOnly: boolean;
  /** Local changes not yet acknowledged by the cloud. */
  pendingSync: boolean;
  deleting: boolean;
  firstSlideId: string | null;
  /** Cloud revision the card was built from (null = never published); deletion is checked against it. */
  revision: number | null;
};

export type DeleteOutcome = { status: "done" } | { status: "pending"; message: string } | { status: "conflict"; message: string };

export interface ProjectService {
  mode: "local" | "cloud";
  ownerId: string;
  list(): Promise<{ projects: ProjectCard[]; warning: string | null }>;
  create(): Promise<string>;
  rename(projectId: string, title: string): Promise<void>;
  duplicate(projectId: string): Promise<string>;
  remove(projectId: string, confirmedRevision?: number | null): Promise<DeleteOutcome>;
  importArchive(file: File, signal?: AbortSignal): Promise<string>;
  thumbnail(projectId: string, slideId: string): Promise<Blob | null>;
  opener: ProjectOpener;
  /** Authenticated download of an attachment that is not in local IndexedDB yet (cloud only). */
  resolveRemoteAsset?: (projectId: string, asset: AssetReference) => Promise<Blob | null>;
  /** Conflict / expired-login actions for the editor banner (cloud only). */
  cloudUi?: (projectId: string, router: Router) => CloudUi;
}

/** Copies referenced blobs to their remapped asset IDs; fails instead of creating a partial copy. */
export async function copyAssetBlobs(ownerId: string, sourceProjectId: string, assetIdMap: Map<string, string>, resolve?: (assetId: string) => Promise<Blob | null>): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  for (const [oldId, newId] of assetIdMap) {
    const blob = await getLocalAsset(ownerId, sourceProjectId, oldId) ?? await resolve?.(oldId) ?? null;
    if (!blob) throw new Error(`ไม่มีข้อมูลรูป ${oldId.slice(0, 8)} ในเครื่อง จึงทำสำเนาไม่ได้ (ลองเปิดโปรเจกต์ต้นฉบับให้รูปโหลดก่อน)`);
    blobs.set(newId, blob);
  }
  return blobs;
}

export async function renameDraft(ownerId: string, projectId: string, title: string): Promise<ProjectContent> {
  const trimmed = title.trim();
  return withWriterLock(ownerId, projectId, async () => {
    const draft = await getLocalDraft(ownerId, projectId);
    if (!draft) throw new Error("ไม่พบโปรเจกต์ในเครื่อง");
    const content = parseProjectContent({ ...draft.content, title: trimmed });
    if (content.title === draft.content.title) return content;
    await writeDraftContent(ownerId, projectId, { content, localSequence: draft.localSequence + 1, pendingEdit: draft.pendingEdit });
    return content;
  });
}

/** Development adapter: IndexedDB only, fixture identity, never used in production builds. */
export function createLocalProjectService(ownerId: string): ProjectService {
  return {
    mode: "local",
    ownerId,
    async list() {
      const [drafts, deletions] = await Promise.all([listLocalDrafts(ownerId), idbDeletionJobStore.list(ownerId)]);
      const deleting = new Set(deletions.map((job) => job.projectId));
      return {
        warning: null,
        projects: drafts.map((draft) => ({
          id: draft.projectId, title: draft.content.title, updatedAt: draft.savedAt,
          localOnly: true, pendingSync: false, deleting: deleting.has(draft.projectId),
          firstSlideId: draft.content.document.slides[0]?.id ?? null, revision: draft.baseRevision,
        })),
      };
    },
    async create() {
      const id = crypto.randomUUID();
      await createLocalDraft(ownerId, id, createProjectContent());
      return id;
    },
    async rename(projectId, title) { await renameDraft(ownerId, projectId, title); },
    async duplicate(projectId) {
      const draft = await getLocalDraft(ownerId, projectId);
      if (!draft) throw new Error("ไม่พบโปรเจกต์ในเครื่อง");
      const id = crypto.randomUUID();
      const copy = duplicateProjectContent(draft.content, { ownerId, projectId: id });
      const blobs = await copyAssetBlobs(ownerId, projectId, copy.assetIdMap);
      await createLocalDraft(ownerId, id, copy.content, blobs);
      return id;
    },
    async remove(projectId) {
      await withWriterLock(ownerId, projectId, () => deleteLocalProjectData(ownerId, projectId));
      return { status: "done" };
    },
    async importArchive(file, signal) {
      const id = crypto.randomUUID();
      const imported = await importArchiveInWorker(file, { ownerId, projectId: id }, { signal });
      await createLocalDraft(ownerId, id, imported.content, imported.blobs);
      return id;
    },
    async thumbnail(projectId, slideId) { return (await getThumbnail(ownerId, projectId, slideId).catch(() => null))?.blob ?? null; },
    opener: async (owner, projectId) => {
      const draft = await getLocalDraft(owner, projectId);
      if (!draft) throw new Error("ไม่พบโปรเจกต์นี้ในเครื่อง");
      return { draft };
    },
  };
}
