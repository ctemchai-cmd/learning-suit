/**
 * Portable `.learning-suit` archive (ADR 0006, plan 05 §9).
 *
 * Pure module: no DOM/IndexedDB/network. Runs inside `archive.worker.ts` in the browser and
 * directly in Node for tests (non-worker fallback). Nothing here touches storage — callers
 * commit the import result atomically (`createLocalDraft`).
 *
 * ZIP reading does not trust the streaming local-header scanner: the central directory is
 * parsed and cross-checked against every local header (names, flags, method, sizes, CRC,
 * strict contiguity), then each entry is inflated with fflate's streaming `UnzipInflate`
 * in small chunks while counting the ACTUAL output bytes, aborting as soon as a limit is hit.
 */
import { UnzipInflate, zipSync, type Zippable } from "fflate";
import { referencedAssetIds, normalizeForPersistence } from "../../domain/document/assets";
import type { AssetReference, ProjectContent } from "../../domain/document/model";
import { readImageDimensions } from "../../domain/document/image-rules";
import { remapProjectContent } from "../../domain/document/remap";
import { parseProjectContent } from "../../domain/document/schema";
import { sha256Hex } from "../../lib/sha256";
import {
  ARCHIVE_EXTENSION,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_LIMITS,
  ArchiveError,
  DOCUMENT_ENTRY,
  MANIFEST_ENTRY,
  archiveAssetPath,
  archiveManifestSchema,
  archiveToProjectContent,
  describeZodError,
  parseArchiveDocument,
  toArchiveDocument,
  type ArchiveAsset,
  type ArchiveAssetMimeType,
  type ArchiveDocument,
  type ArchiveLimits,
  type ArchiveManifest,
  type ImportTarget,
  type ProjectArchive,
} from "./archive-types";

export * from "./archive-types";

// ================================================================== shared deps/types

export type ProgressCallback = (done: number, total: number) => void;

export type DecodeImage = (bytes: Uint8Array, mimeType: ArchiveAssetMimeType) => Promise<{ width: number; height: number }>;

export type BuildArchiveDeps = {
  /** Local-first then authenticated download. Reject or resolve null when bytes are unavailable. */
  resolveBlob(asset: AssetReference): Promise<Blob | null>;
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  /** Test-only override of product limits. */
  limits?: Partial<ArchiveLimits>;
};

export type BuildArchiveResult = { bytes: Uint8Array<ArrayBuffer>; filename: string; manifest: ArchiveManifest };

export type ReadArchiveDeps = {
  decodeImage: DecodeImage;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  /** Test-only override of product limits. */
  limits?: Partial<ArchiveLimits>;
};

export type ImportArchiveDeps = ReadArchiveDeps & { newId?: () => string };

export type ImportArchiveResult = {
  content: ProjectContent;
  /** NEW asset ID → validated bytes (typed with the asset MIME type). */
  blobs: Map<string, Blob>;
};

const encoder = new TextEncoder();

function resolveLimits(overrides?: Partial<ArchiveLimits>): ArchiveLimits {
  return { ...ARCHIVE_LIMITS, ...overrides };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError("ABORTED", { cause: signal.reason });
}

// ================================================================== export

/**
 * Export sequence (plan 05 §9): validate/freeze → referenced assets only → resolve all bytes →
 * verify byteLength/MIME/sha256 → sanitized ArchiveDocument + manifest → ZIP → size limits.
 * Throws `ArchiveError` and produces nothing on any failure (no partial archive).
 */
export async function buildArchive(content: ProjectContent, deps: BuildArchiveDeps): Promise<BuildArchiveResult> {
  const limits = resolveLimits(deps.limits);
  const { signal } = deps;
  throwIfAborted(signal);

  // Validate + freeze: Zod returns fresh objects, so later edits to the live store cannot leak in.
  // Only {title, document} is read, so ProjectRecord/LocalDraft fields never reach the archive.
  let snapshot: ProjectContent;
  try {
    snapshot = parseProjectContent({ title: content.title, document: content.document });
  } catch (cause) {
    throw new ArchiveError("INVALID_DOCUMENT", {
      message: "ข้อมูลโปรเจกต์ไม่ถูกต้อง จึงส่งออกไม่ได้", detail: zodDetail(cause), cause,
    });
  }
  const normalized = normalizeForPersistence(snapshot);
  const assets = [...referencedAssetIds(normalized.document)].map((id) => normalized.document.assets[id]);
  if (assets.length + 2 > limits.entries) {
    throw new ArchiveError("TOO_MANY_ENTRIES", {
      message: `โปรเจกต์มีภาพมากเกินกว่าที่ส่งออกได้ (สูงสุด ${limits.entries - 2} ภาพ)`,
    });
  }

  const total = assets.length + 1;
  const tooLargeUncompressed = () => new ArchiveError("DECOMPRESSED_TOO_LARGE", {
    message: "ข้อมูลโปรเจกต์และภาพรวมกันเกิน 100 MiB จึงส่งออกไม่ได้ กรุณาแยกบทเรียนหรือลดขนาดภาพ",
  });
  let uncompressed = 0;
  const assetBytes: { asset: AssetReference; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const [index, asset] of assets.entries()) {
    throwIfAborted(signal);
    const bytes = await resolveAssetBytes(asset, deps.resolveBlob, signal);
    throwIfAborted(signal);
    await verifyAssetBytes(asset, bytes);
    uncompressed += bytes.byteLength;
    if (uncompressed > limits.decompressedBytes) throw tooLargeUncompressed();
    assetBytes.push({ asset, bytes });
    deps.onProgress?.(index + 1, total);
  }

  const exportedAt = deps.now?.() ?? new Date();
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    documentSchemaVersion: 1,
    title: snapshot.title,
    exportedAt: exportedAt.toISOString(),
    assets: assets.map((asset) => ({ id: asset.id, path: archiveAssetPath(asset.id, asset.mimeType) })),
  };
  archiveManifestSchema.parse(manifest);
  const manifestJson = encoder.encode(JSON.stringify(manifest, null, 2));
  const documentJson = encoder.encode(JSON.stringify(toArchiveDocument(normalized.document)));
  uncompressed += manifestJson.byteLength + documentJson.byteLength;
  if (uncompressed > limits.decompressedBytes) throw tooLargeUncompressed();

  const mtime = zipTimestamp(exportedAt);
  const files: Zippable = {
    [MANIFEST_ENTRY]: [manifestJson, { level: 6, mtime }],
    [DOCUMENT_ENTRY]: [documentJson, { level: 6, mtime }],
  };
  // PNG/JPEG/WebP are already compressed: store them to save CPU in the worker.
  for (const { asset, bytes } of assetBytes) files[archiveAssetPath(asset.id, asset.mimeType)] = [bytes, { level: 0, mtime }];

  throwIfAborted(signal);
  const zipped = zipSync(files);
  if (zipped.byteLength > limits.compressedBytes) {
    throw new ArchiveError("TOO_LARGE", {
      message: "ไฟล์ที่ส่งออกจะใหญ่เกิน 50 MiB จึงส่งออกไม่ได้ กรุณาแยกบทเรียนหรือลดขนาดภาพ",
      detail: `${zipped.byteLength} bytes`,
    });
  }
  deps.onProgress?.(total, total);
  return { bytes: zipped, filename: archiveFilename(snapshot.title), manifest };
}

async function resolveAssetBytes(
  asset: AssetReference,
  resolveBlob: BuildArchiveDeps["resolveBlob"],
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  let blob: Blob | null | undefined;
  try {
    blob = await resolveBlob(asset);
  } catch (cause) {
    throwIfAborted(signal);
    throw new ArchiveError("ASSET_MISSING", { assetId: asset.id, detail: String(cause), cause });
  }
  if (!blob) throw new ArchiveError("ASSET_MISSING", { assetId: asset.id });
  try {
    return new Uint8Array(await blob.arrayBuffer());
  } catch (cause) {
    throw new ArchiveError("ASSET_MISSING", { assetId: asset.id, detail: String(cause), cause });
  }
}

/** DOS timestamps only cover 1980–2099 (fflate throws outside that range). */
function zipTimestamp(date: Date): Date {
  const year = date.getFullYear();
  return Number.isFinite(year) && year >= 1980 && year <= 2099 ? date : new Date(1980, 0, 1);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** `<title>.learning-suit`; only filename-unsafe characters are replaced (Thai is kept). */
export function archiveFilename(title: string): string {
  let base = "";
  for (const char of title) {
    const code = char.codePointAt(0) ?? 0;
    const unsafe = code < 0x20 || code === 0x7f || '\\/:*?"<>|'.includes(char)
      || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f;
    base += unsafe ? "_" : char;
  }
  base = base.trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  return `${base || "learning-suit"}${ARCHIVE_EXTENSION}`;
}

// ================================================================== asset verification

export function sniffImageMime(bytes: Uint8Array): ArchiveAssetMimeType | null {
  const at = (i: number) => bytes[i];
  if (bytes.byteLength >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47
    && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (bytes.byteLength >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

async function verifyAssetBytes(asset: ArchiveAsset, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== asset.byteLength) {
    throw new ArchiveError("ASSET_MISMATCH", { assetId: asset.id, detail: `byteLength ${bytes.byteLength} != ${asset.byteLength}` });
  }
  const sniffed = sniffImageMime(bytes);
  if (sniffed !== asset.mimeType) {
    throw new ArchiveError("ASSET_MISMATCH", { assetId: asset.id, detail: `MIME ${sniffed ?? "unknown"} != ${asset.mimeType}` });
  }
  const hash = await sha256Hex(bytes);
  if (hash !== asset.sha256) {
    throw new ArchiveError("ASSET_MISMATCH", { assetId: asset.id, detail: `sha256 ${hash} != ${asset.sha256}` });
  }
}

/** Browser/worker image decoder: decode, read dimensions, release the bitmap immediately. */
export async function decodeImageWithBitmap(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }));
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

// ================================================================== import

/**
 * Import steps 1–5 (plan 05 §9): size → signature → structural ZIP validation → streamed,
 * byte-counted decompression → strict manifest/document validation → every image checked
 * (byteLength, sha256, sniffed MIME, decoded dimensions, per-image limits) one at a time.
 */
export async function readArchive(input: Blob | Uint8Array, deps: ReadArchiveDeps): Promise<ProjectArchive> {
  const limits = resolveLimits(deps.limits);
  const { signal } = deps;
  throwIfAborted(signal);

  const size = input instanceof Uint8Array ? input.byteLength : input.size;
  if (size > limits.compressedBytes) throw new ArchiveError("TOO_LARGE", { detail: `${size} bytes` });
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  throwIfAborted(signal);

  const entries = readZipDirectory(bytes, limits);
  const manifestEntry = entries.get(MANIFEST_ENTRY);
  if (!manifestEntry) throw new ArchiveError("MISSING_ENTRY", { entry: MANIFEST_ENTRY });
  const documentEntry = entries.get(DOCUMENT_ENTRY);
  if (!documentEntry) throw new ArchiveError("MISSING_ENTRY", { entry: DOCUMENT_ENTRY });

  const budget: Budget = { used: 0, max: limits.decompressedBytes };
  const total = entries.size;
  let done = 0;
  const step = () => deps.onProgress?.(++done, total);

  // ---- manifest
  const manifest = parseManifest(inflateEntry(bytes, manifestEntry, limits.manifestBytes, budget));
  step();
  const listed = new Set(manifest.assets.map((asset) => asset.path));
  for (const name of entries.keys()) {
    if (name !== MANIFEST_ENTRY && name !== DOCUMENT_ENTRY && !listed.has(name)) throw new ArchiveError("UNEXPECTED_ENTRY", { entry: display(name) });
  }
  for (const { path } of manifest.assets) {
    if (!entries.has(path)) throw new ArchiveError("MISSING_ENTRY", { entry: display(path) });
  }
  throwIfAborted(signal);

  // ---- document
  const document = parseDocument(inflateEntry(bytes, documentEntry, limits.documentBytes, budget), manifest.title);
  step();
  checkManifestMatchesDocument(manifest, document, limits);
  throwIfAborted(signal);

  // ---- assets, strictly one at a time
  const blobs = new Map<string, Blob>();
  for (const { id, path } of manifest.assets) {
    throwIfAborted(signal);
    const asset = document.assets[id];
    const entry = entries.get(path)!;
    if (entry.uncompressedSize !== asset.byteLength) {
      throw new ArchiveError("ASSET_MISMATCH", { assetId: id, detail: `entry size ${entry.uncompressedSize} != ${asset.byteLength}` });
    }
    const data = inflateEntry(bytes, entry, asset.byteLength, budget);
    await verifyAssetBytes(asset, data);
    throwIfAborted(signal);
    // The browser allocates by the size written in the file header, not the manifest: check the real
    // header first so a tiny file claiming a small size cannot force a huge decode (same rule as ingest).
    const header = readImageDimensions(data, asset.mimeType);
    if (header && (header.width !== asset.width || header.height !== asset.height)) {
      throw new ArchiveError("ASSET_MISMATCH", { assetId: id, detail: `header ${header.width}x${header.height} != ${asset.width}x${asset.height}` });
    }
    let decoded: { width: number; height: number };
    try {
      decoded = await deps.decodeImage(data, asset.mimeType);
    } catch (cause) {
      throwIfAborted(signal);
      throw new ArchiveError("ASSET_MISMATCH", { assetId: id, detail: `decode failed: ${String(cause)}`, cause });
    }
    if (decoded.width !== asset.width || decoded.height !== asset.height) {
      throw new ArchiveError("ASSET_MISMATCH", {
        assetId: id, detail: `decoded ${decoded.width}x${decoded.height} != ${asset.width}x${asset.height}`,
      });
    }
    blobs.set(id, new Blob([data], { type: asset.mimeType }));
    step();
  }
  return { manifest, document, blobs };
}

/**
 * readArchive + new project/slide/node/asset identities and storage paths under the current
 * owner (step 6). Pure: never touches IndexedDB/cloud — the caller writes blobs + draft in one
 * IDB transaction (`createLocalDraft(ownerId, projectId, content, blobs)`).
 */
export async function importArchive(input: Blob | Uint8Array, target: ImportTarget, deps: ImportArchiveDeps): Promise<ImportArchiveResult> {
  const archive = await readArchive(input, deps);
  throwIfAborted(deps.signal);
  let remapped: ReturnType<typeof remapProjectContent>;
  try {
    remapped = remapProjectContent(archiveToProjectContent(archive.manifest.title, archive.document), target, deps.newId);
  } catch (cause) {
    throw new ArchiveError("INVALID_DOCUMENT", { detail: zodDetail(cause), cause });
  }
  const blobs = new Map<string, Blob>();
  for (const [oldId, newId] of remapped.assetIdMap) {
    const blob = archive.blobs.get(oldId);
    if (!blob) throw new ArchiveError("MISSING_ENTRY", { assetId: oldId });
    blobs.set(newId, blob);
  }
  return { content: remapped.content, blobs };
}

function parseJson(raw: Uint8Array, entry: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (cause) {
    throw new ArchiveError("BAD_JSON", { entry, detail: String(cause), cause });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseManifest(raw: Uint8Array): ArchiveManifest {
  const json = parseJson(raw, MANIFEST_ENTRY);
  if (!isRecord(json)) throw new ArchiveError("INVALID_MANIFEST", { detail: "manifest is not an object" });
  if (json.format !== ARCHIVE_FORMAT) throw new ArchiveError("UNSUPPORTED_FORMAT", { detail: `format ${String(json.format)}` });
  if (json.formatVersion !== ARCHIVE_FORMAT_VERSION || json.documentSchemaVersion !== 1) {
    throw new ArchiveError("UNSUPPORTED_VERSION", {
      detail: `formatVersion ${String(json.formatVersion)}, documentSchemaVersion ${String(json.documentSchemaVersion)}`,
    });
  }
  const parsed = archiveManifestSchema.safeParse(json);
  if (!parsed.success) throw new ArchiveError("INVALID_MANIFEST", { detail: describeZodError(parsed.error) });
  return parsed.data as ArchiveManifest;
}

function parseDocument(raw: Uint8Array, title: string): ArchiveDocument {
  const json = parseJson(raw, DOCUMENT_ENTRY);
  if (!isRecord(json)) throw new ArchiveError("INVALID_DOCUMENT", { detail: "document is not an object" });
  if (json.schemaVersion !== 1) throw new ArchiveError("UNSUPPORTED_VERSION", { detail: `schemaVersion ${String(json.schemaVersion)}` });
  const result = parseArchiveDocument(json, title);
  if (!result.ok) throw new ArchiveError("INVALID_DOCUMENT", { detail: result.issue });
  return result.document;
}

function checkManifestMatchesDocument(manifest: ArchiveManifest, document: ArchiveDocument, limits: ArchiveLimits): void {
  const referenced = referencedAssetIds({ ...document, assets: {} });
  const documentIds = Object.keys(document.assets);
  for (const id of documentIds) {
    if (!referenced.has(id)) throw new ArchiveError("INVALID_DOCUMENT", { detail: `asset ${id} is not referenced by any image` });
  }
  if (documentIds.length !== manifest.assets.length) {
    throw new ArchiveError("INVALID_MANIFEST", { detail: `manifest lists ${manifest.assets.length} assets, document has ${documentIds.length}` });
  }
  for (const { id, path } of manifest.assets) {
    const asset = document.assets[id];
    if (!asset) throw new ArchiveError("INVALID_MANIFEST", { detail: `manifest asset ${id} is not in document` });
    if (path !== archiveAssetPath(asset.id, asset.mimeType)) {
      throw new ArchiveError("INVALID_MANIFEST", { detail: `path ${display(path)} != ${archiveAssetPath(asset.id, asset.mimeType)}` });
    }
  }
  for (const asset of Object.values(document.assets)) {
    if (asset.byteLength > limits.imageBytes || asset.width > limits.imageEdge || asset.height > limits.imageEdge
      || asset.width * asset.height > limits.imagePixels) {
      throw new ArchiveError("INVALID_DOCUMENT", {
        detail: `asset ${asset.id} exceeds image limits (${asset.width}x${asset.height}, ${asset.byteLength} bytes)`,
      });
    }
  }
}

function zodDetail(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    return describeZodError(error as Parameters<typeof describeZodError>[0]);
  }
  return String(error);
}

/** Attacker-controlled names are shown to users: strip controls/bidi and cap length. */
function display(name: string): string {
  let out = "";
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) ? "?" : char;
  }
  return out.length > 120 ? `${out.slice(0, 117)}...` : out;
}

// ================================================================== ZIP structure

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_DATA_DESCRIPTOR = 0x08074b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const FLAG_MASKED_HEADERS = 0x2000;
/** Deflate option bits (1–2), data descriptor (3) and UTF-8 names (11). */
const ALLOWED_FLAGS = 0x0002 | 0x0004 | FLAG_DATA_DESCRIPTOR | FLAG_UTF8;
const CONSISTENT_FLAGS = FLAG_ENCRYPTED | FLAG_DATA_DESCRIPTOR | FLAG_STRONG_ENCRYPTION | FLAG_UTF8 | FLAG_MASKED_HEADERS;
const ASSET_ENTRY = /^assets\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(png|jpg|webp)$/;
/** Compressed bytes handed to the inflater per push; bounds a single burst to ~1032× this. */
const INFLATE_CHUNK = 8 * 1024;

type ZipEntry = {
  name: string;
  nameBytes: Uint8Array;
  method: 0 | 8;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  dataStart: number;
  dataEnd: number;
};

type Budget = { used: number; max: number };

const corrupt = (detail: string, entry?: string) => new ArchiveError("CORRUPT_ARCHIVE", { detail, entry: entry && display(entry) });

/**
 * Parses and validates the whole ZIP layout before any byte is inflated. Returns entries by name.
 * Rejects: non-ZIP, ZIP64/multi-disk, >limit entries, unsafe/duplicate/unexpected names,
 * directories, symlinks/special files, encryption, methods other than stored/deflate,
 * local/central header disagreement, gaps/overlaps/trailing data, declared total over budget.
 */
function readZipDirectory(bytes: Uint8Array, limits: ArchiveLimits = ARCHIVE_LIMITS): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  if (length < 4 || u32(0) !== SIG_LOCAL) throw new ArchiveError("BAD_SIGNATURE");

  // End of central directory: must end exactly at EOF (comment included).
  let eocd = -1;
  for (let offset = length - 22; offset >= Math.max(0, length - 22 - 0xffff); offset--) {
    if (u32(offset) === SIG_EOCD && offset + 22 + u16(offset + 20) === length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw corrupt("end of central directory not found");
  if (eocd >= 20 && u32(eocd - 20) === SIG_ZIP64_LOCATOR) throw corrupt("ZIP64 is not supported");
  const entryCount = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== entryCount) throw corrupt("multi-disk archives are not supported");
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw corrupt("ZIP64 is not supported");
  if (entryCount > limits.entries) throw new ArchiveError("TOO_MANY_ENTRIES", { detail: `${entryCount} entries` });
  if (cdOffset + cdSize !== eocd) throw corrupt("central directory bounds mismatch");

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const folded = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > eocd || u32(p) !== SIG_CENTRAL) throw corrupt("bad central directory header");
    const madeBy = u16(p + 4);
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const compressedSize = u32(p + 20);
    const uncompressedSize = u32(p + 24);
    const nameLength = u16(p + 28);
    const next = p + 46 + nameLength + u16(p + 30) + u16(p + 32);
    const diskStart = u16(p + 34);
    const externalAttributes = u32(p + 38);
    const localOffset = u32(p + 42);
    if (next > eocd) throw corrupt("central directory entry overflows");
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    const name = decodeEntryName(nameBytes, flags);

    assertSafePath(name);
    if (names.has(name) || folded.has(name.toLowerCase())) throw new ArchiveError("DUPLICATE_ENTRY", { entry: display(name) });
    names.add(name);
    folded.add(name.toLowerCase());
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_HEADERS)) throw new ArchiveError("ENCRYPTED_ENTRY", { entry: display(name) });
    if (method !== 0 && method !== 8) throw new ArchiveError("UNSUPPORTED_COMPRESSION", { entry: display(name), detail: `method ${method}` });
    if (flags & ~ALLOWED_FLAGS) throw new ArchiveError("UNSUPPORTED_COMPRESSION", { entry: display(name), detail: `flags 0x${flags.toString(16)}` });
    assertRegularFile(name, madeBy, externalAttributes);
    if (name !== MANIFEST_ENTRY && name !== DOCUMENT_ENTRY && !ASSET_ENTRY.test(name)) throw new ArchiveError("UNEXPECTED_ENTRY", { entry: display(name) });
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw corrupt("ZIP64 is not supported", name);
    if (diskStart !== 0) throw corrupt("multi-disk entry", name);
    if (method === 0 && compressedSize !== uncompressedSize) throw corrupt("stored entry size mismatch", name);

    declaredTotal += uncompressedSize;
    entries.push({ name, nameBytes, method, flags, crc, compressedSize, uncompressedSize, localOffset, dataStart: 0, dataEnd: 0 });
    p = next;
  }
  if (p !== eocd) throw corrupt("central directory size mismatch");
  if (declaredTotal > limits.decompressedBytes) {
    throw new ArchiveError("DECOMPRESSED_TOO_LARGE", { detail: `declared ${declaredTotal} bytes` });
  }

  // Local headers must agree with the central directory and tile the file with no gaps/overlaps.
  let cursor = 0;
  for (const entry of [...entries].sort((a, b) => a.localOffset - b.localOffset)) {
    const at = entry.localOffset;
    if (at !== cursor) throw corrupt("entries overlap or have gaps", entry.name);
    if (at + 30 > cdOffset || u32(at) !== SIG_LOCAL) throw corrupt("bad local header", entry.name);
    const flags = u16(at + 6);
    const nameLength = u16(at + 26);
    const dataStart = at + 30 + nameLength + u16(at + 28);
    if (u16(at + 8) !== entry.method || (flags & CONSISTENT_FLAGS) !== (entry.flags & CONSISTENT_FLAGS)) {
      throw corrupt("local header disagrees with central directory", entry.name);
    }
    if (dataStart > cdOffset || !sameBytes(bytes.subarray(at + 30, at + 30 + nameLength), entry.nameBytes)) {
      throw corrupt("local header name disagrees with central directory", entry.name);
    }
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > cdOffset) throw corrupt("entry data overflows", entry.name);
    if (entry.flags & FLAG_DATA_DESCRIPTOR) {
      const matches = (offset: number) => offset + 12 <= cdOffset
        && u32(offset) === entry.crc && u32(offset + 4) === entry.compressedSize && u32(offset + 8) === entry.uncompressedSize;
      if (dataEnd + 16 <= cdOffset && u32(dataEnd) === SIG_DATA_DESCRIPTOR && matches(dataEnd + 4)) cursor = dataEnd + 16;
      else if (matches(dataEnd)) cursor = dataEnd + 12;
      else throw corrupt("data descriptor disagrees with central directory", entry.name);
    } else {
      if (u32(at + 14) !== entry.crc || u32(at + 18) !== entry.compressedSize || u32(at + 22) !== entry.uncompressedSize) {
        throw corrupt("local sizes disagree with central directory", entry.name);
      }
      cursor = dataEnd;
    }
    entry.dataStart = dataStart;
    entry.dataEnd = dataEnd;
  }
  if (cursor !== cdOffset) throw corrupt("unexpected data before central directory");
  return new Map(entries.map((entry) => [entry.name, entry]));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

function decodeEntryName(raw: Uint8Array, flags: number): string {
  if (flags & FLAG_UTF8 && raw.some((byte) => byte >= 0x80)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw corrupt("entry name is not valid UTF-8");
    }
  }
  // No UTF-8 flag: ASCII (our writer) or CP437 legacy; non-ASCII names are rejected later anyway.
  return Array.from(raw, (byte) => String.fromCharCode(byte)).join("");
}

function assertSafePath(name: string): void {
  const unsafe = () => new ArchiveError("UNSAFE_PATH", { entry: display(name) });
  if (!name) throw unsafe();
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) throw unsafe();
  }
  if (name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw unsafe();
  const segments = name.split("/");
  if (name.endsWith("/")) segments.pop();
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw unsafe();
}

/** Directories are unexpected; symlinks, devices, FIFOs and sockets are unsafe. */
function assertRegularFile(name: string, madeBy: number, externalAttributes: number): void {
  const host = madeBy >>> 8;
  const unixMode = (externalAttributes >>> 16) & 0xf000;
  if (name.endsWith("/") || externalAttributes & 0x10 || ((host === 3 || host === 19) && unixMode === 0x4000)) {
    throw new ArchiveError("UNEXPECTED_ENTRY", { entry: display(name), detail: "directory entry" });
  }
  if ((host === 3 || host === 19) && unixMode !== 0 && unixMode !== 0x8000) {
    throw new ArchiveError("UNSAFE_PATH", { entry: display(name), detail: `unix file type 0x${unixMode.toString(16)}` });
  }
}

/**
 * Streams one entry through fflate's `UnzipInflate` in INFLATE_CHUNK pieces, counting the
 * actual output. Aborts as soon as the archive-wide budget, the entry's declared size or the
 * per-entry cap is exceeded — header sizes are never trusted for allocation beyond `cap`.
 */
function inflateEntry(bytes: Uint8Array, entry: ZipEntry, cap: number, budget: Budget): Uint8Array<ArrayBuffer> {
  if (entry.uncompressedSize > cap) {
    throw new ArchiveError("DECOMPRESSED_TOO_LARGE", { entry: display(entry.name), detail: `declared ${entry.uncompressedSize} > cap ${cap}` });
  }
  const out = new Uint8Array(entry.uncompressedSize);
  let written = 0;
  let finished = false;
  let failure: ArchiveError | undefined;
  const accept = (chunk: Uint8Array) => {
    if (failure) return;
    budget.used += chunk.byteLength;
    if (budget.used > budget.max) {
      failure = new ArchiveError("DECOMPRESSED_TOO_LARGE", { entry: display(entry.name), detail: `actual total > ${budget.max} bytes` });
    } else if (written + chunk.byteLength > out.byteLength) {
      failure = new ArchiveError("DECOMPRESSED_TOO_LARGE", {
        entry: display(entry.name), detail: `actual bytes exceed declared ${entry.uncompressedSize}`,
      });
    } else {
      out.set(chunk, written);
      written += chunk.byteLength;
    }
  };

  const data = bytes.subarray(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) {
    accept(data);
    finished = true;
  } else {
    const inflater = new UnzipInflate();
    inflater.ondata = (error, chunk, final) => {
      if (error) {
        failure ??= corrupt(`inflate failed: ${error.message}`, entry.name);
        return;
      }
      accept(chunk);
      if (final) finished = true;
    };
    if (data.byteLength === 0) inflater.push(new Uint8Array(0), true);
    for (let offset = 0; offset < data.byteLength && !failure; offset += INFLATE_CHUNK) {
      const end = Math.min(offset + INFLATE_CHUNK, data.byteLength);
      inflater.push(data.subarray(offset, end), end === data.byteLength);
    }
  }
  if (failure) throw failure;
  if (!finished || written !== entry.uncompressedSize) throw corrupt(`size ${written} != declared ${entry.uncompressedSize}`, entry.name);
  if (crc32(out) !== entry.crc) throw corrupt("CRC-32 mismatch", entry.name);
  return out;
}

let crcTable: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.byteLength; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
