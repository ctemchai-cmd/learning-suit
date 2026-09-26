"use client";

import type { AssetReference, CanvasNode } from "@/domain/document/model";
import { storagePathFor } from "@/domain/document/assets";
import { DEFAULTS } from "@/domain/document/limits";
import { getLocalAsset, putLocalAsset } from "@/services/persistence/local-db";

// In-app object clipboard (plan03 §6). Lives in memory for the browser session only; it never
// writes the system clipboard. Cross-project paste re-ingests image bytes under new asset IDs.

type ClipboardPayload = {
  ownerId: string;
  projectId: string;
  nodes: CanvasNode[];
  assets: AssetReference[];
  pasteCount: number;
};

let payload: ClipboardPayload | null = null;

export function copyToClipboard(ownerId: string, projectId: string, nodes: CanvasNode[], assets: Record<string, AssetReference>): number {
  const copied = structuredClone(nodes);
  const used = new Set(copied.flatMap((node) => node.type === "image" ? [node.assetId] : []));
  payload = { ownerId, projectId, nodes: copied, assets: [...used].map((id) => structuredClone(assets[id])).filter(Boolean), pasteCount: 0 };
  return copied.length;
}

export function hasClipboard(): boolean { return Boolean(payload?.nodes.length); }

export type PastePlan = { nodes: CanvasNode[]; assets: AssetReference[] };

/**
 * Builds the nodes (and, across projects, new asset references) for one paste. Offsets grow by
 * 24 world units per repeated paste; relative positions and z-order are preserved.
 */
export async function preparePaste(target: { ownerId: string; projectId: string }): Promise<PastePlan | null> {
  const source = payload;
  if (!source || !source.nodes.length || source.ownerId !== target.ownerId) return null;
  source.pasteCount++;
  const offset = DEFAULTS.pasteOffset * source.pasteCount;
  const nodes = source.nodes.map((node) => ({ ...structuredClone(node), id: crypto.randomUUID(), x: node.x + offset, y: node.y + offset, locked: false }) as CanvasNode);
  if (source.projectId === target.projectId) return { nodes, assets: [] };
  const remap = new Map<string, AssetReference>();
  for (const asset of source.assets) {
    const blob = await getLocalAsset(source.ownerId, source.projectId, asset.id);
    if (!blob) throw new Error(`ไม่มีข้อมูลรูปต้นฉบับในเครื่อง จึงวางวัตถุที่มีรูปนี้ไม่ได้ (${asset.id.slice(0, 8)})`);
    const id = crypto.randomUUID();
    const copy: AssetReference = { ...asset, id, storagePath: storagePathFor(target.ownerId, target.projectId, id, asset.mimeType) };
    await putLocalAsset(target.ownerId, target.projectId, copy, blob);
    remap.set(asset.id, copy);
  }
  return {
    nodes: nodes.map((node) => node.type === "image" ? { ...node, assetId: remap.get(node.assetId)!.id } : node),
    assets: [...remap.values()],
  };
}
