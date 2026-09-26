import { describe, expect, it } from "vitest";
import type { AssetReference } from "../../domain/document/model";
import { sha256Hex } from "../../lib/sha256";
import {
  assetRowMatches,
  assetToRow,
  classifyAssetPostgrestFailure,
  classifyStorageFailure,
  isStorageDuplicate,
  isStorageNotFound,
  PROJECT_ASSETS_BUCKET,
  storageFailureOf,
  SupabaseAssetStore,
} from "./supabase-assets";
import { type Call, fakeClient } from "./supabase-fakes.test-helpers";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "a1111111-0000-4000-8000-000000000001";
const ASSET_ID = "d0000000-0000-4000-8000-000000000001";
const BYTES = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: "image/png" });

async function assetFor(bytes: Blob, overrides: Partial<AssetReference> = {}): Promise<AssetReference> {
  return {
    id: ASSET_ID,
    mimeType: "image/png",
    width: 64,
    height: 32,
    byteLength: bytes.size,
    sha256: await sha256Hex(bytes),
    storagePath: `${OWNER}/${PROJECT}/${ASSET_ID}.png`,
    ...overrides,
  };
}

const duplicateError = { name: "StorageApiError", status: 400, statusCode: "409", message: "The resource already exists" };
const notFoundError = { name: "StorageApiError", status: 400, statusCode: "404", message: "Object not found" };

/** In-memory private bucket mimicking storage-js list/upload/download/remove results. */
class FakeBucket {
  readonly objects = new Map<string, Blob>();
  readonly calls: Call[] = [];
  uploadError: unknown = null;
  removeIsNoop = false;

  async upload(path: string, body: Blob, options: unknown) {
    this.calls.push({ method: "upload", args: [path, body, options] });
    if (this.uploadError) return { data: null, error: this.uploadError };
    if (this.objects.has(path)) return { data: null, error: duplicateError };
    this.objects.set(path, body);
    return { data: { id: "object-id", path, fullPath: `${PROJECT_ASSETS_BUCKET}/${path}` }, error: null };
  }

  async download(path: string) {
    this.calls.push({ method: "download", args: [path] });
    const blob = this.objects.get(path);
    return blob ? { data: blob, error: null } : { data: null, error: notFoundError };
  }

  async list(prefix: string, options: { limit: number; offset: number }) {
    this.calls.push({ method: "list", args: [prefix, options] });
    const names = [...this.objects.keys()]
      .filter((path) => path.startsWith(`${prefix}/`))
      .map((path) => path.slice(prefix.length + 1))
      .sort()
      .slice(options.offset, options.offset + options.limit);
    return { data: names.map((name) => ({ name, id: `id-${name}` })), error: null };
  }

  async remove(paths: string[]) {
    this.calls.push({ method: "remove", args: [paths] });
    if (!this.removeIsNoop) for (const path of paths) this.objects.delete(path);
    return { data: [], error: null };
  }
}

describe("pure helpers", () => {
  it("compares every immutable metadata field", async () => {
    const asset = await assetFor(BYTES);
    const row = assetToRow(PROJECT, asset);
    expect(row).toEqual({
      id: ASSET_ID, project_id: PROJECT, storage_path: asset.storagePath, mime_type: "image/png",
      width: 64, height: 32, byte_length: BYTES.size, sha256: asset.sha256,
    });
    expect(assetRowMatches({ ...row }, row)).toBe(true);
    expect(assetRowMatches({ ...row, sha256: "0".repeat(64) }, row)).toBe(false);
    expect(assetRowMatches({ ...row, project_id: "a1111111-0000-4000-8000-000000000002" }, row)).toBe(false);
    expect(assetRowMatches(null, row)).toBe(false);
  });

  it("classifies storage failures", () => {
    expect(isStorageDuplicate(storageFailureOf(duplicateError))).toBe(true);
    expect(isStorageNotFound(storageFailureOf(notFoundError))).toBe(true);
    expect(classifyStorageFailure(storageFailureOf({ name: "StorageUnknownError", message: "fetch failed", originalError: new TypeError("fetch failed") })))
      .toEqual({ code: "network", retryable: true });
    expect(classifyStorageFailure(storageFailureOf({ name: "StorageApiError", status: 400, statusCode: "403", message: "new row violates row-level security policy" })))
      .toEqual({ code: "validation", retryable: false });
    expect(classifyStorageFailure(storageFailureOf({ name: "StorageApiError", status: 400, statusCode: "403", message: "jwt expired" })))
      .toEqual({ code: "auth", retryable: false });
    expect(classifyStorageFailure(storageFailureOf({ name: "StorageApiError", status: 503, statusCode: "503", message: "Service Unavailable" })))
      .toEqual({ code: "network", retryable: true });
    expect(classifyStorageFailure(storageFailureOf({ name: "StorageApiError", status: 413, statusCode: "413", message: "Payload too large" })))
      .toEqual({ code: "validation", retryable: false });
  });

  it("treats metadata RLS rejections as validation, not expired sessions", () => {
    expect(classifyAssetPostgrestFailure({ status: 403, code: "42501", message: 'new row violates row-level security policy for table "project_assets"' }))
      .toEqual({ code: "validation", retryable: false });
    expect(classifyAssetPostgrestFailure({ status: 401, code: "42501", message: "permission denied for table project_assets" }))
      .toEqual({ code: "auth", retryable: false });
    expect(classifyAssetPostgrestFailure({ status: 0, code: "", message: "TypeError: Failed to fetch" }))
      .toEqual({ code: "network", retryable: true });
  });
});

describe("SupabaseAssetStore.register", () => {
  it("rejects non-canonical paths without touching the network", async () => {
    const { client, calls } = fakeClient({});
    const store = new SupabaseAssetStore(client, OWNER);
    const asset = await assetFor(BYTES, { storagePath: `22222222-2222-4222-8222-222222222222/${PROJECT}/${ASSET_ID}.png` });
    expect(await store.register(PROJECT, asset)).toEqual({ status: "error", code: "validation", retryable: false });
    expect(await store.register(PROJECT, await assetFor(BYTES, { storagePath: `${OWNER}/${PROJECT}/${ASSET_ID}.jpg` })))
      .toEqual({ status: "error", code: "validation", retryable: false });
    expect(calls).toEqual([]);
  });

  it("inserts pending metadata", async () => {
    const { client, calls } = fakeClient({ from: [{ data: null, error: null, status: 201 }] });
    const asset = await assetFor(BYTES);
    expect(await new SupabaseAssetStore(client, OWNER).register(PROJECT, asset)).toEqual({ status: "ok" });
    expect(calls).toContainEqual({ method: "from", args: ["project_assets"] });
    expect(calls).toContainEqual({ method: "insert", args: [assetToRow(PROJECT, asset)] });
  });

  it("on unique violation accepts only an identical existing row", async () => {
    const asset = await assetFor(BYTES);
    const conflict = { data: null, error: { code: "23505", message: "duplicate key" }, status: 409 };
    const { client } = fakeClient({
      from: [
        conflict, { data: assetToRow(PROJECT, asset), error: null, status: 200 },
        conflict, { data: { ...assetToRow(PROJECT, asset), width: 65 }, error: null, status: 200 },
        conflict, { data: null, error: null, status: 200 },
      ],
    });
    const store = new SupabaseAssetStore(client, OWNER);
    expect(await store.register(PROJECT, asset)).toEqual({ status: "ok" });
    expect(await store.register(PROJECT, asset)).toEqual({ status: "error", code: "mismatch", retryable: false });
    expect(await store.register(PROJECT, asset)).toEqual({ status: "error", code: "mismatch", retryable: false });
  });

  it("maps RLS rejection (deleted / foreign project) to validation", async () => {
    const { client } = fakeClient({
      from: [{ data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "project_assets"' }, status: 403 }],
    });
    expect(await new SupabaseAssetStore(client, OWNER).register(PROJECT, await assetFor(BYTES)))
      .toEqual({ status: "error", code: "validation", retryable: false });
  });
});

describe("SupabaseAssetStore.upload", () => {
  it("uploads with upsert=false and the asset MIME type", async () => {
    const bucket = new FakeBucket();
    const { client, calls } = fakeClient({ bucket });
    const asset = await assetFor(BYTES);
    expect(await new SupabaseAssetStore(client, OWNER).upload(asset, BYTES)).toEqual({ status: "ok" });
    expect(calls).toContainEqual({ method: "storage.from", args: [PROJECT_ASSETS_BUCKET] });
    expect(bucket.calls[0]).toEqual({ method: "upload", args: [asset.storagePath, BYTES, { upsert: false, contentType: "image/png" }] });
  });

  it("refuses bytes that do not match the metadata before uploading", async () => {
    const bucket = new FakeBucket();
    const { client } = fakeClient({ bucket });
    const store = new SupabaseAssetStore(client, OWNER);
    expect(await store.upload(await assetFor(BYTES, { byteLength: BYTES.size + 1 }), BYTES)).toEqual({ status: "error", code: "mismatch", retryable: false });
    expect(await store.upload(await assetFor(BYTES, { sha256: "0".repeat(64) }), BYTES)).toEqual({ status: "error", code: "mismatch", retryable: false });
    expect(bucket.calls).toEqual([]);
  });

  it("after a lost acknowledgement, an existing object counts only if its sha256 matches", async () => {
    const bucket = new FakeBucket();
    const { client } = fakeClient({ bucket });
    const store = new SupabaseAssetStore(client, OWNER);
    const asset = await assetFor(BYTES);
    bucket.objects.set(asset.storagePath, BYTES);
    expect(await store.upload(asset, BYTES)).toEqual({ status: "ok" });
    expect(bucket.calls.map((call) => call.method)).toEqual(["upload", "download"]);

    const other = new Blob([new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])]);
    bucket.objects.set(asset.storagePath, other);
    expect(await store.upload(asset, BYTES)).toEqual({ status: "error", code: "mismatch", retryable: false });
  });

  it("classifies network failures as retryable and RLS denials without an object as validation", async () => {
    const bucket = new FakeBucket();
    const { client } = fakeClient({ bucket });
    const store = new SupabaseAssetStore(client, OWNER);
    const asset = await assetFor(BYTES);
    bucket.uploadError = { name: "StorageUnknownError", message: "fetch failed", originalError: new TypeError("fetch failed") };
    expect(await store.upload(asset, BYTES)).toEqual({ status: "error", code: "network", retryable: true });
    bucket.uploadError = { name: "StorageApiError", status: 400, statusCode: "403", message: "new row violates row-level security policy" };
    expect(await store.upload(asset, BYTES)).toEqual({ status: "error", code: "validation", retryable: false });
  });
});

describe("SupabaseAssetStore metadata/state", () => {
  it("markReady() requires exactly one updated own row", async () => {
    const { client, calls } = fakeClient({
      from: [{ data: [{ id: ASSET_ID }], error: null, status: 200 }, { data: [], error: null, status: 200 }],
    });
    const store = new SupabaseAssetStore(client, OWNER);
    expect(await store.markReady(PROJECT, ASSET_ID)).toEqual({ status: "ok" });
    expect(calls).toContainEqual({ method: "update", args: [{ upload_state: "ready" }] });
    expect(calls).toContainEqual({ method: "eq", args: ["project_id", PROJECT] });
    expect(await store.markReady(PROJECT, ASSET_ID)).toEqual({ status: "error", code: "validation", retryable: false });
  });

  it("listStates() maps rows and throws on failure", async () => {
    const { client } = fakeClient({
      from: [
        { data: [{ id: ASSET_ID, upload_state: "ready" }, { id: "d0000000-0000-4000-8000-000000000002", upload_state: "pending" }], error: null, status: 200 },
        { data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 },
      ],
    });
    const store = new SupabaseAssetStore(client, OWNER);
    expect(await store.listStates(PROJECT)).toEqual({ [ASSET_ID]: "ready", "d0000000-0000-4000-8000-000000000002": "pending" });
    await expect(store.listStates(PROJECT)).rejects.toMatchObject({ code: "network", retryable: true });
  });

  it("download() distinguishes a missing object from other failures", async () => {
    const bucket = new FakeBucket();
    const { client } = fakeClient({ bucket });
    const asset = await assetFor(BYTES);
    await expect(new SupabaseAssetStore(client, OWNER).download(asset)).rejects.toMatchObject({ reason: "not_found", code: "validation" });
    bucket.objects.set(asset.storagePath, BYTES);
    expect(await new SupabaseAssetStore(client, OWNER).download(asset)).toBe(BYTES);
  });
});

describe("SupabaseAssetStore.removeProjectObjects", () => {
  it("re-lists the first page and removes in batches until the prefix is empty", async () => {
    const bucket = new FakeBucket();
    const prefix = `${OWNER}/${PROJECT}`;
    for (let i = 0; i < 250; i += 1) bucket.objects.set(`${prefix}/${String(i).padStart(4, "0")}.png`, BYTES);
    bucket.objects.set(`${OWNER}/a1111111-0000-4000-8000-000000000002/keep.png`, BYTES);
    const { client } = fakeClient({ bucket });
    await new SupabaseAssetStore(client, OWNER).removeProjectObjects(OWNER, PROJECT);
    expect([...bucket.objects.keys()]).toEqual([`${OWNER}/a1111111-0000-4000-8000-000000000002/keep.png`]);
    const lists = bucket.calls.filter((call) => call.method === "list");
    expect(lists).toHaveLength(4);
    expect(lists.every((call) => (call.args[1] as { offset: number }).offset === 0)).toBe(true);
    expect(bucket.calls.filter((call) => call.method === "remove").map((call) => (call.args[0] as string[]).length)).toEqual([100, 100, 50]);
  });

  it("stops with a retryable error when deletes make no progress (e.g. policy denied)", async () => {
    const bucket = new FakeBucket();
    bucket.removeIsNoop = true;
    bucket.objects.set(`${OWNER}/${PROJECT}/${ASSET_ID}.png`, BYTES);
    const { client } = fakeClient({ bucket });
    await expect(new SupabaseAssetStore(client, OWNER).removeProjectObjects(OWNER, PROJECT))
      .rejects.toMatchObject({ reason: "no_progress", retryable: true });
  });

  it("refuses to clean up another account's prefix", async () => {
    const { client } = fakeClient({ bucket: new FakeBucket() });
    await expect(new SupabaseAssetStore(client, OWNER).removeProjectObjects("22222222-2222-4222-8222-222222222222", PROJECT))
      .rejects.toThrow(/another account/);
  });
});
