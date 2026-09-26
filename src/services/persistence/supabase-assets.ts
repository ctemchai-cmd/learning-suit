import type { SupabaseClient } from "@supabase/supabase-js";
import { storagePathFor } from "../../domain/document/assets";
import type { AssetReference } from "../../domain/document/model";
import { sha256Hex } from "../../lib/sha256";
import type { AssetOpResult, CloudAssetStore } from "./repository";
import { classifyPostgrestFailure, classifyThrown, CloudRepositoryError, type PostgrestFailure } from "./supabase-repository";

// Supabase adapter for CloudAssetStore: project_assets metadata + private bucket objects
// (plan05 §5 steps 3–5, §7). Object bytes are immutable: upload never upserts.

export const PROJECT_ASSETS_BUCKET = "project-assets";
const ASSET_METADATA_COLUMNS = "id, project_id, storage_path, mime_type, width, height, byte_length, sha256";
const REMOVE_BATCH_SIZE = 100;
const MAX_CLEANUP_ROUNDS = 1_000;

type AssetErrorCode = Extract<AssetOpResult, { status: "error" }>["code"];
const OK: AssetOpResult = { status: "ok" };

function assetError(code: AssetErrorCode, retryable: boolean): AssetOpResult {
  return { status: "error", code, retryable };
}

export interface AssetRow {
  id: string;
  project_id: string;
  storage_path: string;
  mime_type: string;
  width: number;
  height: number;
  byte_length: number;
  sha256: string;
}

export function assetToRow(projectId: string, asset: AssetReference): AssetRow {
  return {
    id: asset.id,
    project_id: projectId,
    storage_path: asset.storagePath,
    mime_type: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byte_length: asset.byteLength,
    sha256: asset.sha256,
  };
}

/** True when an existing metadata row is identical in every immutable field. */
export function assetRowMatches(existing: unknown, expected: AssetRow): boolean {
  if (typeof existing !== "object" || existing === null) return false;
  const row = existing as Record<string, unknown>;
  return (Object.keys(expected) as (keyof AssetRow)[]).every((key) => row[key] === expected[key]);
}

/** PostgREST failures for asset metadata: RLS rejections are rule violations, not expired sessions. */
export function classifyAssetPostgrestFailure(failure: PostgrestFailure): { code: AssetErrorCode; retryable: boolean } {
  if (failure.code === "42501" && failure.status !== 401 && /row-level security/i.test(failure.message ?? "")) {
    return { code: "validation", retryable: false };
  }
  const classification = classifyPostgrestFailure(failure);
  return { code: classification.code === "quota" ? "validation" : classification.code, retryable: classification.retryable };
}

export interface StorageFailure {
  status?: number;
  statusCode?: string;
  code?: string;
  message: string;
  name?: string;
  originalError?: unknown;
}

/** Normalises StorageApiError / StorageUnknownError / thrown values into plain fields. */
export function storageFailureOf(error: unknown): StorageFailure {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  const value = error as Record<string, unknown>;
  return {
    status: typeof value.status === "number" ? value.status : undefined,
    statusCode: typeof value.statusCode === "string" ? value.statusCode : undefined,
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : String(error),
    name: typeof value.name === "string" ? value.name : undefined,
    originalError: value.originalError,
  };
}

function storageStatus(failure: StorageFailure): number {
  const fromBody = Number(failure.statusCode);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody : (failure.status ?? 0);
}

export function isStorageDuplicate(failure: StorageFailure): boolean {
  return storageStatus(failure) === 409 || failure.status === 409
    || /^(Duplicate|ResourceAlreadyExists|KeyAlreadyExists)$/i.test(failure.code ?? "")
    || /already exists|duplicate/i.test(failure.message);
}

export function isStorageNotFound(failure: StorageFailure): boolean {
  return storageStatus(failure) === 404 || failure.status === 404
    || /^(NoSuchKey|not_found|NotFound)$/i.test(failure.code ?? "")
    || /not found/i.test(failure.message);
}

export function isStorageRlsDenied(failure: StorageFailure): boolean {
  return /row-level security/i.test(failure.message);
}

export function classifyStorageFailure(failure: StorageFailure): { code: AssetErrorCode; retryable: boolean } {
  const status = storageStatus(failure);
  if (failure.name === "StorageUnknownError" || failure.originalError instanceof TypeError || status === 0) {
    // No HTTP response (fetch rejected / aborted / offline).
    return { code: "network", retryable: true };
  }
  if (isStorageRlsDenied(failure)) return { code: "validation", retryable: false };
  if (status === 401 || /jwt|exp.*claim|invalid.*signature|InvalidJWT/i.test(`${failure.code ?? ""} ${failure.message}`)) {
    return { code: "auth", retryable: false };
  }
  if (status === 403) return { code: "auth", retryable: false };
  if (status === 408 || status === 429 || status >= 500) return { code: "network", retryable: true };
  if (status === 413 || status === 415 || /EntityTooLarge|InvalidMimeType|mime type/i.test(`${failure.code ?? ""} ${failure.message}`)) {
    return { code: "validation", retryable: false };
  }
  return { code: "unknown", retryable: false };
}

interface MetadataResponse {
  data: unknown;
  error: { code?: string; message?: string; details?: string; name?: string } | null;
  status?: number;
}

export class SupabaseAssetStore implements CloudAssetStore {
  constructor(private readonly client: SupabaseClient, private readonly ownerId: string) {}

  private bucket() {
    return this.client.storage.from(PROJECT_ASSETS_BUCKET);
  }

  async listStates(projectId: string): Promise<Record<string, "pending" | "ready">> {
    const response = await this.metadata("list asset states", () =>
      this.client.from("project_assets").select("id, upload_state").eq("project_id", projectId),
    );
    if (!Array.isArray(response.data)) throw new CloudRepositoryError("Malformed project_assets response", { code: "unknown", retryable: false });
    const states: Record<string, "pending" | "ready"> = {};
    for (const row of response.data as { id?: unknown; upload_state?: unknown }[]) {
      if (typeof row.id === "string" && (row.upload_state === "pending" || row.upload_state === "ready")) {
        states[row.id] = row.upload_state;
      }
    }
    return states;
  }

  async register(projectId: string, asset: AssetReference): Promise<AssetOpResult> {
    if (asset.storagePath !== storagePathFor(this.ownerId, projectId, asset.id, asset.mimeType)) {
      return assetError("validation", false);
    }
    const expected = assetToRow(projectId, asset);
    let inserted: MetadataResponse;
    try {
      inserted = await this.client.from("project_assets").insert(expected);
    } catch (cause) {
      return this.thrown(cause);
    }
    if (!inserted.error) return OK;
    if (inserted.error.code !== "23505") {
      const failure = classifyAssetPostgrestFailure({ ...inserted.error, status: inserted.status });
      return assetError(failure.code, failure.retryable);
    }
    // Unique violation (id or storage_path): an identical earlier registration is success.
    let existing: MetadataResponse;
    try {
      existing = await this.client.from("project_assets").select(ASSET_METADATA_COLUMNS).eq("id", asset.id).maybeSingle();
    } catch (cause) {
      return this.thrown(cause);
    }
    if (existing.error) {
      const failure = classifyAssetPostgrestFailure({ ...existing.error, status: existing.status });
      return assetError(failure.code, failure.retryable);
    }
    // Not visible = the id/path belongs to another project/owner: never reuse it.
    return existing.data !== null && assetRowMatches(existing.data, expected) ? OK : assetError("mismatch", false);
  }

  async upload(asset: AssetReference, bytes: Blob): Promise<AssetOpResult> {
    if (!asset.storagePath.startsWith(`${this.ownerId}/`)) return assetError("validation", false);
    if (bytes.size !== asset.byteLength) return assetError("mismatch", false);
    if ((await sha256Hex(bytes)) !== asset.sha256) return assetError("mismatch", false);

    let failure: StorageFailure;
    try {
      const { error } = await this.bucket().upload(asset.storagePath, bytes, { upsert: false, contentType: asset.mimeType });
      if (!error) return OK;
      failure = storageFailureOf(error);
    } catch (cause) {
      failure = storageFailureOf(cause);
    }
    // A lost acknowledgement or a retry after success surfaces as "already exists" (or, once the
    // metadata is ready, as an RLS rejection). Accept only if the stored bytes hash identically.
    if (isStorageDuplicate(failure) || isStorageRlsDenied(failure)) return this.verifyStored(asset, failure);
    const classification = classifyStorageFailure(failure);
    return assetError(classification.code, classification.retryable);
  }

  async markReady(projectId: string, assetId: string): Promise<AssetOpResult> {
    let response: MetadataResponse;
    try {
      response = await this.client
        .from("project_assets")
        .update({ upload_state: "ready" })
        .eq("id", assetId)
        .eq("project_id", projectId)
        .select("id");
    } catch (cause) {
      return this.thrown(cause);
    }
    if (response.error) {
      const failure = classifyAssetPostgrestFailure({ ...response.error, status: response.status });
      return assetError(failure.code, failure.retryable);
    }
    return Array.isArray(response.data) && response.data.length === 1 ? OK : assetError("validation", false);
  }

  async download(asset: AssetReference): Promise<Blob> {
    let result: { data: Blob | null; error: unknown };
    try {
      result = await this.bucket().download(asset.storagePath);
    } catch (cause) {
      throw new CloudRepositoryError(`Download failed for ${asset.id}`, classifyThrown(cause), { cause });
    }
    if (result.error || !result.data) {
      const failure = storageFailureOf(result.error);
      if (isStorageNotFound(failure)) {
        throw new CloudRepositoryError(`Asset ${asset.id} is not stored`, { code: "validation", retryable: false }, { reason: "not_found", cause: result.error });
      }
      const classification = classifyStorageFailure(failure);
      throw new CloudRepositoryError(`Download failed for ${asset.id}: ${failure.message}`, {
        code: classification.code === "mismatch" ? "unknown" : classification.code,
        retryable: classification.retryable,
      }, { cause: result.error });
    }
    return result.data;
  }

  async removeProjectObjects(ownerId: string, projectId: string): Promise<void> {
    if (ownerId !== this.ownerId) throw new Error("Refusing to clean up another account's storage prefix");
    const prefix = `${ownerId}/${projectId}`;
    let previous: string | null = null;
    for (let round = 0; round < MAX_CLEANUP_ROUNDS; round += 1) {
      // Always re-list the FIRST page: deleting shifts later pages, so offsets would skip objects.
      const listed = await this.bucket().list(prefix, { limit: REMOVE_BATCH_SIZE, offset: 0, sortBy: { column: "name", order: "asc" } });
      if (listed.error) throw this.storageError(`List ${prefix} failed`, listed.error);
      const paths = listed.data.filter((entry) => entry.id !== null).map((entry) => `${prefix}/${entry.name}`);
      if (!paths.length) return;
      const signature = paths.join("\n");
      if (signature === previous) {
        throw new CloudRepositoryError(`Storage cleanup of ${prefix} made no progress`, { code: "unknown", retryable: true }, { reason: "no_progress" });
      }
      previous = signature;
      const removed = await this.bucket().remove(paths);
      if (removed.error) throw this.storageError(`Remove under ${prefix} failed`, removed.error);
    }
    throw new CloudRepositoryError(`Storage cleanup of ${prefix} exceeded ${MAX_CLEANUP_ROUNDS} rounds`, { code: "unknown", retryable: true });
  }

  private async verifyStored(asset: AssetReference, original: StorageFailure): Promise<AssetOpResult> {
    let stored: Blob;
    try {
      stored = await this.download(asset);
    } catch (error) {
      if (error instanceof CloudRepositoryError) {
        if (error.reason === "not_found") {
          // Duplicate without a readable object is a transient race; an RLS denial means not allowed.
          return isStorageRlsDenied(original) ? assetError("validation", false) : assetError("unknown", true);
        }
        return assetError(error.code === "quota" ? "validation" : error.code, error.retryable);
      }
      return this.thrown(error);
    }
    const matches = stored.size === asset.byteLength && (await sha256Hex(stored)) === asset.sha256;
    return matches ? OK : assetError("mismatch", false);
  }

  private storageError(message: string, error: unknown): CloudRepositoryError {
    const classification = classifyStorageFailure(storageFailureOf(error));
    return new CloudRepositoryError(message, {
      code: classification.code === "mismatch" ? "unknown" : classification.code,
      retryable: classification.retryable,
    }, { cause: error });
  }

  private thrown(cause: unknown): AssetOpResult {
    const classification = classifyThrown(cause);
    return assetError(classification.code === "quota" ? "validation" : classification.code, classification.retryable);
  }

  private async metadata(label: string, run: () => PromiseLike<MetadataResponse>): Promise<MetadataResponse> {
    let response: MetadataResponse;
    try {
      response = await run();
    } catch (cause) {
      throw new CloudRepositoryError(`${label} failed`, classifyThrown(cause), { cause });
    }
    if (response.error) {
      throw new CloudRepositoryError(
        `${label} failed: ${response.error.message ?? "unknown error"}`,
        classifyPostgrestFailure({ ...response.error, status: response.status }),
        { cause: response.error },
      );
    }
    return response;
  }
}
