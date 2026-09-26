import { storagePathFor, normalizeForPersistence } from "./assets";
import { LIMITS } from "./limits";
import type { AssetReference, CanvasNode, ProjectContent } from "./model";
import { parseProjectContent } from "./schema";

export type RemapTarget = { ownerId: string; projectId: string };

export type RemapResult = {
  content: ProjectContent;
  /** old asset ID → new asset ID (copy blobs with this map). */
  assetIdMap: Map<string, string>;
  slideIdMap: Map<string, string>;
  nodeIdMap: Map<string, string>;
};

const defaultId = () => crypto.randomUUID();

/**
 * Gives a project a fresh identity for Duplicate / Import (plan 02 §8, plan 05 §7/§9 step 6):
 * - new slide, node and asset UUIDs; image nodes point at the new asset IDs;
 * - every asset `storagePath` is rebuilt under `target.ownerId/target.projectId`;
 * - Git simulator state is deep-copied; commit IDs (C1, C2, …) are widget-local and kept;
 * - slide order, node (z-)order and all other properties are preserved;
 * - the result shares no mutable reference with the input and passes `parseProjectContent`.
 *
 * Every asset in the registry is remapped. Callers that only want referenced assets
 * (Duplicate) should run `normalizeForPersistence` first — `duplicateProjectContent` does.
 */
export function remapProjectContent(content: ProjectContent, target: RemapTarget, newId: () => string = defaultId): RemapResult {
  const source = structuredClone({ title: content.title, document: content.document });
  const assetIdMap = new Map<string, string>();
  const slideIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();

  const assets: Record<string, AssetReference> = {};
  for (const [oldId, asset] of Object.entries(source.document.assets)) {
    const id = newId();
    assetIdMap.set(oldId, id);
    assets[id] = { ...asset, id, storagePath: storagePathFor(target.ownerId, target.projectId, id, asset.mimeType) };
  }

  const slides = source.document.slides.map((slide) => {
    const slideId = newId();
    slideIdMap.set(slide.id, slideId);
    const nodes = slide.nodes.map((node): CanvasNode => {
      const nodeId = newId();
      nodeIdMap.set(node.id, nodeId);
      if (node.type !== "image") return { ...node, id: nodeId };
      const assetId = assetIdMap.get(node.assetId);
      if (!assetId) throw new Error(`Image node ${node.id} references missing asset ${node.assetId}`);
      return { ...node, id: nodeId, assetId };
    });
    return { ...slide, id: slideId, nodes };
  });

  const next: ProjectContent = {
    title: source.title,
    document: { ...source.document, slides, assets },
  };
  // Single source of truth for limits/uniqueness/reference integrity; also rejects ID collisions from `newId`.
  parseProjectContent(next);
  return { content: next, assetIdMap, slideIdMap, nodeIdMap };
}

/**
 * Dashboard "Duplicate": publishes only referenced assets, remaps every identity and
 * appends `titleSuffix`. The base title is shortened (on grapheme boundaries) so the result
 * stays within the 120 code point title limit; the suffix is never cut.
 */
export function duplicateProjectContent(
  content: ProjectContent,
  target: RemapTarget,
  titleSuffix = " สำเนา",
  newId: () => string = defaultId,
): RemapResult {
  const result = remapProjectContent(normalizeForPersistence(content), target, newId);
  result.content.title = duplicateTitle(content.title, titleSuffix);
  parseProjectContent(result.content);
  return result;
}

export function duplicateTitle(title: string, suffix = " สำเนา", maxCodePoints: number = LIMITS.titleCodePoints): string {
  const room = maxCodePoints - [...suffix].length;
  if (room <= 0) return truncateCodePoints(suffix.trim(), maxCodePoints);
  const base = truncateCodePoints(title.trim(), room).trimEnd();
  return `${base}${suffix}`.trim();
}

/** Longest prefix of whole grapheme clusters (e.g. Thai base + marks) within `max` code points. */
function truncateCodePoints(value: string, max: number): string {
  if ([...value].length <= max) return value;
  const segments = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(value), (s) => s.segment)
    : [...value];
  let out = "";
  let used = 0;
  for (const segment of segments) {
    const size = [...segment].length;
    if (used + size > max) break;
    out += segment;
    used += size;
  }
  return out;
}
