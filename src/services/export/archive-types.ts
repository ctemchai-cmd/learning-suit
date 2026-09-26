import { z } from "zod";
import { ASSET_EXTENSIONS, storagePathFor } from "../../domain/document/assets";
import { LIMITS } from "../../domain/document/limits";
import type { AssetReference, ProjectContent, ProjectDocument } from "../../domain/document/model";
import { assetSchema, projectContentSchema } from "../../domain/document/schema";

// ------------------------------------------------------------------ constants

export const ARCHIVE_FORMAT = "learning-suit";
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_EXTENSION = ".learning-suit";
export const ARCHIVE_MIME_TYPE = "application/zip";
export const MANIFEST_ENTRY = "manifest.json";
export const DOCUMENT_ENTRY = "document.json";

const MiB = 1024 * 1024;

/** Product limits (plan 02 §6). Overridable only through the test-only `limits` dep. */
export const ARCHIVE_LIMITS = {
  compressedBytes: 50 * MiB,
  decompressedBytes: 100 * MiB,
  entries: 1000,
  manifestBytes: 1 * MiB,
  documentBytes: LIMITS.documentBytes,
  imageBytes: 10 * MiB,
  imageEdge: 8192,
  imagePixels: 16_777_216,
} as const;
export type ArchiveLimits = { -readonly [K in keyof typeof ARCHIVE_LIMITS]: number };

export type ArchiveAssetMimeType = AssetReference["mimeType"];

export function archiveAssetPath(id: string, mimeType: ArchiveAssetMimeType): string {
  return `assets/${id}.${ASSET_EXTENSIONS[mimeType]}`;
}

// ------------------------------------------------------------------ wire types

export type ArchiveAsset = Omit<AssetReference, "storagePath">;
export type ArchiveDocument = Omit<ProjectDocument, "assets"> & { assets: Record<string, ArchiveAsset> };
export type ArchiveManifest = {
  format: "learning-suit";
  formatVersion: 1;
  documentSchemaVersion: 1;
  title: string;
  exportedAt: string;
  assets: { id: string; path: string }[];
};
export type ProjectArchive = {
  manifest: ArchiveManifest;
  document: ArchiveDocument;
  /** asset ID (as written in the archive) → validated bytes typed with the asset MIME type. */
  blobs: Map<string, Blob>;
};

const codePoints = (value: string) => [...value].length;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const archiveManifestSchema = z.strictObject({
  format: z.literal(ARCHIVE_FORMAT),
  formatVersion: z.literal(ARCHIVE_FORMAT_VERSION),
  documentSchemaVersion: z.literal(1),
  title: z.string().refine(
    (v) => v === v.trim() && codePoints(v) >= 1 && codePoints(v) <= LIMITS.titleCodePoints,
    "Title must be trimmed and 1–120 characters",
  ),
  exportedAt: z.iso.datetime({ offset: true }),
  assets: z.array(z.strictObject({ id: uuid, path: z.string().min(1).max(512) })).max(ARCHIVE_LIMITS.entries - 2),
}).superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    if (ids.has(asset.id)) ctx.addIssue({ code: "custom", message: `Duplicate manifest asset ${asset.id}` });
    ids.add(asset.id);
  }
});

/**
 * Envelope check only: archive assets are the canonical asset schema minus `storagePath`
 * (strict, so a smuggled `storagePath`/owner field is rejected). Slides/nodes/Git state are
 * validated by `projectContentSchema` in `parseArchiveDocument` — never duplicated here.
 */
const archiveDocumentEnvelope = z.strictObject({
  schemaVersion: z.literal(1),
  slides: z.array(z.unknown()),
  assets: z.record(z.string(), assetSchema.omit({ storagePath: true })),
});

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Same length as a real `<owner>/<project>/<asset>.<ext>` path so the document size limit stays honest. */
function placeholderStoragePath(asset: ArchiveAsset): string {
  return storagePathFor(NIL_UUID, NIL_UUID, asset.id, asset.mimeType);
}

export function toArchiveDocument(document: ProjectDocument): ArchiveDocument {
  const assets: Record<string, ArchiveAsset> = {};
  for (const [key, asset] of Object.entries(document.assets)) {
    // Whitelist copy: never leak storagePath or any other runtime field.
    assets[key] = {
      id: asset.id, mimeType: asset.mimeType, width: asset.width, height: asset.height,
      byteLength: asset.byteLength, sha256: asset.sha256,
    };
  }
  return { schemaVersion: document.schemaVersion, slides: document.slides, assets };
}

/** Archive document + manifest title → canonical ProjectContent with placeholder storage paths. */
export function archiveToProjectContent(title: string, document: ArchiveDocument): ProjectContent {
  const assets: ProjectDocument["assets"] = {};
  for (const [key, asset] of Object.entries(document.assets)) assets[key] = { ...asset, storagePath: placeholderStoragePath(asset) };
  return { title, document: { schemaVersion: document.schemaVersion, slides: document.slides, assets } };
}

export type ArchiveDocumentParse =
  | { ok: true; document: ArchiveDocument; content: ProjectContent }
  | { ok: false; issue: string };

/**
 * Validates an untrusted `document.json` value through the single source of truth
 * (`projectContentSchema`): strict objects, version 1, limits, unique IDs, reference
 * integrity and the Git graph. `title` comes from the manifest.
 */
export function parseArchiveDocument(value: unknown, title: string): ArchiveDocumentParse {
  const envelope = archiveDocumentEnvelope.safeParse(value);
  if (!envelope.success) return { ok: false, issue: describeZodError(envelope.error) };
  const candidate = archiveToProjectContent(title, envelope.data as ArchiveDocument);
  const parsed = projectContentSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issue: describeZodError(parsed.error) };
  const content = parsed.data as ProjectContent;
  return { ok: true, content, document: toArchiveDocument(content.document) };
}

export function describeZodError(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

// ------------------------------------------------------------------ errors

export type ArchiveErrorCode =
  | "TOO_LARGE"
  | "DECOMPRESSED_TOO_LARGE"
  | "TOO_MANY_ENTRIES"
  | "BAD_SIGNATURE"
  | "CORRUPT_ARCHIVE"
  | "UNSAFE_PATH"
  | "DUPLICATE_ENTRY"
  | "UNSUPPORTED_COMPRESSION"
  | "ENCRYPTED_ENTRY"
  | "UNEXPECTED_ENTRY"
  | "MISSING_ENTRY"
  | "BAD_JSON"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "INVALID_MANIFEST"
  | "INVALID_DOCUMENT"
  | "ASSET_MISSING"
  | "ASSET_MISMATCH"
  | "ABORTED"
  | "WORKER_FAILED";

export type ArchiveErrorInit = {
  /** Overrides the default Thai message. */
  message?: string;
  assetId?: string;
  entry?: string;
  /** Technical detail for logs/tests (English, may contain Zod issue paths). Not for end users. */
  detail?: string;
  cause?: unknown;
};

export type SerializedArchiveError = { code: ArchiveErrorCode; message: string; assetId?: string; entry?: string; detail?: string };

function defaultMessage(code: ArchiveErrorCode, init: ArchiveErrorInit): string {
  const entry = init.entry ? ` (${init.entry})` : "";
  const asset = init.assetId ? ` ${init.assetId}` : "";
  switch (code) {
    case "TOO_LARGE": return "ไฟล์ .learning-suit ใหญ่เกิน 50 MiB ที่รองรับ";
    case "DECOMPRESSED_TOO_LARGE": return `ข้อมูลในไฟล์เมื่อแตกออกแล้วใหญ่เกินขนาดที่รองรับ (รวมไม่เกิน 100 MiB)${entry}`;
    case "TOO_MANY_ENTRIES": return "ไฟล์มีรายการเกิน 1,000 รายการที่รองรับ";
    case "BAD_SIGNATURE": return "ไฟล์นี้ไม่ใช่ไฟล์ .learning-suit (ไม่ใช่ไฟล์ ZIP)";
    case "CORRUPT_ARCHIVE": return `ไฟล์เสียหรือโครงสร้างไฟล์ไม่ถูกต้อง${entry}`;
    case "UNSAFE_PATH": return `ไฟล์มีตำแหน่งไฟล์ที่ไม่ปลอดภัย${entry}`;
    case "DUPLICATE_ENTRY": return `ไฟล์มีรายการชื่อซ้ำกัน${entry}`;
    case "UNSUPPORTED_COMPRESSION": return `ไฟล์ใช้วิธีบีบอัดที่ไม่รองรับ${entry}`;
    case "ENCRYPTED_ENTRY": return `ไม่รองรับไฟล์ที่เข้ารหัสไว้${entry}`;
    case "UNEXPECTED_ENTRY": return `ไฟล์มีรายการที่ไม่ได้อยู่ในรูปแบบ .learning-suit${entry}`;
    case "MISSING_ENTRY": return `ไฟล์ขาดรายการที่จำเป็น${entry}`;
    case "BAD_JSON": return `อ่านข้อมูลในไฟล์ไม่ได้ เพราะ JSON เสียหาย${entry}`;
    case "UNSUPPORTED_FORMAT": return "ไฟล์นี้ไม่ใช่ไฟล์โปรเจกต์ Learning Suit";
    case "UNSUPPORTED_VERSION": return "ไฟล์นี้มาจาก Learning Suit รุ่นที่ยังไม่รองรับ กรุณาอัปเดตแอปแล้วลองใหม่";
    case "INVALID_MANIFEST": return "ข้อมูลสรุปไฟล์ (manifest) ไม่ถูกต้อง";
    case "INVALID_DOCUMENT": return "ข้อมูลโปรเจกต์ในไฟล์ไม่ถูกต้องหรือเกินขีดจำกัด";
    case "ASSET_MISSING": return `ไม่พบไฟล์ภาพ${asset} ทั้งในเครื่องและบนคลาวด์ จึงยกเลิกการส่งออกเพื่อไม่ให้ได้ไฟล์ไม่ครบ`;
    case "ASSET_MISMATCH": return `ไฟล์ภาพ${asset} ไม่ตรงกับข้อมูลที่บันทึกไว้ (ขนาด/ชนิด/ลายนิ้วมือไฟล์)`;
    case "ABORTED": return "ยกเลิกแล้ว";
    case "WORKER_FAILED": return "ระบบประมวลผลไฟล์ขัดข้อง กรุณาลองใหม่อีกครั้ง";
  }
}

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  readonly assetId?: string;
  readonly entry?: string;
  readonly detail?: string;

  constructor(code: ArchiveErrorCode, init: ArchiveErrorInit = {}) {
    super(init.message ?? defaultMessage(code, init), init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ArchiveError";
    this.code = code;
    if (init.assetId !== undefined) this.assetId = init.assetId;
    if (init.entry !== undefined) this.entry = init.entry;
    if (init.detail !== undefined) this.detail = init.detail;
  }

  toJSON(): SerializedArchiveError {
    return { code: this.code, message: this.message, assetId: this.assetId, entry: this.entry, detail: this.detail };
  }

  static from(value: SerializedArchiveError): ArchiveError {
    return new ArchiveError(value.code, value);
  }
}

export function isArchiveError(value: unknown): value is ArchiveError {
  return value instanceof ArchiveError;
}

// ------------------------------------------------------------------ worker protocol

export type ImportTarget = { ownerId: string; projectId: string };

export type ArchiveWorkerRequest =
  | {
      type: "export";
      id: number;
      content: ProjectContent;
      /** Referenced asset bytes resolved on the main thread (transferred). */
      assets: { id: string; bytes: ArrayBuffer }[];
      exportedAt: string;
    }
  | { type: "import"; id: number; file: Blob; target: ImportTarget }
  | { type: "cancel"; id: number };

export type ArchiveWorkerResponse =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "export-result"; id: number; bytes: Uint8Array<ArrayBuffer>; filename: string; manifest: ArchiveManifest }
  | { type: "import-result"; id: number; content: ProjectContent; blobs: Map<string, Blob> }
  | { type: "error"; id: number; error: SerializedArchiveError };
