import type { AssetReference, ProjectContent, ProjectDocument } from "./model";

export const ASSET_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const satisfies Record<AssetReference["mimeType"], string>;

/** Canonical private-bucket path: `<owner-uuid>/<project-uuid>/<asset-uuid>.<ext>`. */
export function storagePathFor(ownerId: string, projectId: string, assetId: string, mimeType: AssetReference["mimeType"]): string {
  return `${ownerId}/${projectId}/${assetId}.${ASSET_EXTENSIONS[mimeType]}`;
}

export function referencedAssetIds(document: ProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const slide of document.slides) {
    for (const node of slide.nodes) if (node.type === "image") ids.add(node.assetId);
  }
  return ids;
}

/**
 * Serialization normalizer for cloud snapshots, archives and semantic equality.
 * Unreferenced assets stay in the in-memory registry (Undo/Redo may need them)
 * but are never published.
 */
export function normalizeForPersistence(content: ProjectContent): ProjectContent {
  const used = referencedAssetIds(content.document);
  const entries = Object.entries(content.document.assets);
  if (entries.every(([id]) => used.has(id))) return content;
  return {
    ...content,
    document: { ...content.document, assets: Object.fromEntries(entries.filter(([id]) => used.has(id))) },
  };
}
