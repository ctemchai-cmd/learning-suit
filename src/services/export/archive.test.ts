import { Zip, ZipDeflate, ZipPassThrough, deflateSync, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeForPersistence, storagePathFor } from "../../domain/document/assets";
import type { AssetReference, CanvasNode, ProjectContent } from "../../domain/document/model";
import { parseProjectContent } from "../../domain/document/schema";
import type { GitSimulationState } from "../../domain/git/model";
import { sha256Hex } from "../../lib/sha256";
import {
  ArchiveError,
  archiveFilename,
  buildArchive,
  crc32,
  importArchive,
  readArchive,
  sniffImageMime,
  type ArchiveErrorCode,
  type DecodeImage,
} from "./archive";
import { exportArchiveInWorker, importArchiveInWorker } from "./archive-client";

// ================================================================== fixtures

const b64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
/** Real images generated with Pillow: PNG 3×2, JPEG 2×3, lossless WebP 4×1. */
const PNG = b64("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAE0lEQVR42mP8dUb0PwMUMDEgAQBDpQLeNquxrAAAAABJRU5ErkJggg==");
const JPEG = b64("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDk6KKK0IP/2Q==");
const WEBP = b64("UklGRhwAAABXRUJQVlA4TBAAAAAvAwAAAAdQwOh//wMR0f8A");

/** Test decoder that reads real header dimensions (PNG IHDR, JPEG SOFn, WebP VP8L). */
const decodeImage: DecodeImage = async (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mime = sniffImageMime(bytes);
  if (mime === "image/png" && bytes.byteLength >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === "image/jpeg") {
    let p = 2;
    while (p + 9 < bytes.byteLength && bytes[p] === 0xff) {
      const marker = bytes[p + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(p + 5), width: view.getUint16(p + 7) };
      }
      p += 2 + view.getUint16(p + 2);
    }
  }
  if (mime === "image/webp" && strFromU8(bytes.subarray(12, 16)) === "VP8L" && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error("cannot decode");
};

const OWNER = "a0000000-0000-4000-8000-000000000001";
const PROJECT = "b0000000-0000-4000-8000-000000000001";
const TARGET = { ownerId: "a0000000-0000-4000-8000-0000000000ff", projectId: "b0000000-0000-4000-8000-0000000000ff" };
const PNG_ID = "c0000000-0000-4000-8000-000000000001";
const JPEG_ID = "c0000000-0000-4000-8000-000000000002";
const WEBP_ID = "c0000000-0000-4000-8000-000000000003";
const UNUSED_ID = "c0000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-09-24T12:00:00.000Z");

const BYTES: Record<string, Uint8Array> = { [PNG_ID]: PNG, [JPEG_ID]: JPEG, [WEBP_ID]: WEBP, [UNUSED_ID]: PNG };

function gitState(): GitSimulationState {
  const v1 = { name: "README.md", content: "สวัสดี Git\n" };
  const v2 = { name: "README.md", content: "สวัสดี Git\nบทที่ 2\n" };
  return {
    version: 1,
    commits: {
      C1: { id: "C1", parentId: null, message: "เริ่มต้นโปรเจกต์", snapshot: v1 },
      C2: { id: "C2", parentId: "C1", message: "เพิ่มบทที่ 2", snapshot: v2 },
    },
    machines: {
      A: { initialized: true, working: { ...v2 }, index: { ...v2 }, mainHead: "C2", originMainHead: "C1", knownCommitIds: ["C1", "C2"] },
      B: { initialized: true, working: { ...v1 }, index: { ...v1 }, mainHead: "C1", originMainHead: "C1", knownCommitIds: ["C1"] },
    },
    remote: { mainHead: "C1", knownCommitIds: ["C1"] },
    nextCommitNumber: 3,
  };
}

let fixture: ProjectContent;

async function assetRef(id: string, mimeType: AssetReference["mimeType"], width: number, height: number): Promise<AssetReference> {
  const bytes = BYTES[id];
  return { id, mimeType, width, height, byteLength: bytes.byteLength, sha256: await sha256Hex(bytes), storagePath: storagePathFor(OWNER, PROJECT, id, mimeType) };
}

beforeAll(async () => {
  const base = { rotation: 0, opacity: 1, locked: false };
  fixture = parseProjectContent({
    title: "Git เบื้องต้น: บทที่ 1",
    document: {
      schemaVersion: 1,
      slides: [
        {
          id: "10000000-0000-4000-8000-000000000001", name: "Commit อยู่ในเครื่อง", background: "#FFFFFF",
          nodes: [
            { ...base, id: "20000000-0000-4000-8000-000000000001", type: "rectangle", x: 120, y: 80, rotation: 15, width: 300, height: 160, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "dashed", fill: "#FACC15" },
            { ...base, id: "20000000-0000-4000-8000-000000000002", type: "image", x: 10, y: 20, width: 30, height: 20, assetId: PNG_ID, locked: true },
            { ...base, id: "20000000-0000-4000-8000-000000000003", type: "git-simulator", x: 0, y: 400, scale: 1.5, state: gitState() },
            { ...base, id: "20000000-0000-4000-8000-000000000004", type: "text", x: 40, y: -20, text: "ข้อความภาษาไทย\nบรรทัดที่สอง", width: 320, fontFamily: "Noto Sans Thai", fontSize: 28, lineHeight: 1.4, color: "#1F2937", align: "center", opacity: 0.5 },
          ],
        },
        {
          id: "10000000-0000-4000-8000-000000000002", name: "สไลด์ที่สอง", background: "#E5E7EB",
          nodes: [
            { ...base, id: "20000000-0000-4000-8000-000000000005", type: "arrow", x: 5, y: 5, points: [{ x: 0, y: 0 }, { x: 80, y: 40 }], headLength: 12, headWidth: 10, stroke: "#1F2937", strokeWidth: 2, strokeStyle: "solid" },
            { ...base, id: "20000000-0000-4000-8000-000000000006", type: "image", x: 100, y: 20, width: 20, height: 30, assetId: JPEG_ID },
            { ...base, id: "20000000-0000-4000-8000-000000000007", type: "image", x: 200, y: 20, width: 40, height: 10, assetId: WEBP_ID },
            { ...base, id: "20000000-0000-4000-8000-000000000008", type: "image", x: 300, y: 20, width: 30, height: 20, assetId: PNG_ID },
            { ...base, id: "20000000-0000-4000-8000-000000000009", type: "highlighter", x: 0, y: 0, points: [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 5, y: 8 }], stroke: "#FACC15", strokeWidth: 16, strokeStyle: "solid", opacity: 0.25 },
          ],
        },
      ],
      assets: {
        [PNG_ID]: await assetRef(PNG_ID, "image/png", 3, 2),
        [JPEG_ID]: await assetRef(JPEG_ID, "image/jpeg", 2, 3),
        [WEBP_ID]: await assetRef(WEBP_ID, "image/webp", 4, 1),
        // Registered (undo/redo) but not referenced by any node: must never be exported.
        [UNUSED_ID]: await assetRef(UNUSED_ID, "image/png", 3, 2),
      },
    },
  });
});

const resolveBlob = async (asset: AssetReference) => new Blob([BYTES[asset.id] as Uint8Array<ArrayBuffer>], { type: asset.mimeType });
const build = (content: ProjectContent = fixture, extra: Partial<Parameters<typeof buildArchive>[1]> = {}) =>
  buildArchive(content, { resolveBlob, now: () => NOW, ...extra });

async function expectCode(promise: Promise<unknown>, code: ArchiveErrorCode): Promise<ArchiveError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error, `expected ArchiveError ${code}`).toBeInstanceOf(ArchiveError);
  const archiveError = error as ArchiveError;
  expect(archiveError.code, archiveError.detail).toBe(code);
  expect(archiveError.message).toMatch(/[\u0E00-\u0E7F]/); // Thai, user-facing
  return archiveError;
}

const read = (input: Uint8Array | Blob, extra: Partial<Parameters<typeof readArchive>[1]> = {}) => readArchive(input, { decodeImage, ...extra });

// ------------------------------------------------------------------ tamper helpers

type Files = Record<string, Uint8Array>;
const json = (value: unknown) => strToU8(JSON.stringify(value));
const parse = (bytes: Uint8Array) => JSON.parse(strFromU8(bytes));

async function tampered(mutate: (files: Files) => void): Promise<Uint8Array> {
  const files: Files = unzipSync((await build()).bytes);
  mutate(files);
  return zipSync(files);
}
function editJson(files: Files, name: string, edit: (value: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const value = parse(files[name]);
  edit(value);
  files[name] = json(value);
}

/** Minimal ZIP writer that lets tests forge any header field. */
type RawEntry = {
  name: string;
  data: Uint8Array;
  method?: number;
  deflate?: boolean;
  compressed?: Uint8Array;
  crc?: number;
  size?: number;
  flags?: number;
  madeBy?: number;
  externalAttributes?: number;
  localName?: string;
};
function writeZip(entries: RawEntry[], { trailing = new Uint8Array(0) } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? (entry.deflate ? 8 : 0);
    const payload = entry.compressed ?? (method === 8 ? deflateSync(entry.data) : entry.data);
    const crc = entry.crc ?? crc32(entry.data);
    const size = entry.size ?? entry.data.byteLength;
    const flags = entry.flags ?? 0;
    const name = strToU8(entry.name);
    const localName = strToU8(entry.localName ?? entry.name);
    const local = new Uint8Array(30 + localName.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, payload.byteLength, true); lv.setUint32(22, size, true);
    lv.setUint16(26, localName.byteLength, true); local.set(localName, 30);
    const header = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, entry.madeBy ?? 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true); cv.setUint16(10, method, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.byteLength, true); cv.setUint32(24, size, true); cv.setUint16(28, name.byteLength, true);
    cv.setUint32(38, entry.externalAttributes ?? 0, true); cv.setUint32(42, offset, true); header.set(name, 46);
    chunks.push(local, payload);
    central.push(header);
    offset += local.byteLength + payload.byteLength;
  }
  const cdSize = central.reduce((sum, c) => sum + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const parts = [...chunks, ...central, eocd, trailing];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.byteLength, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

let bombPayload: Uint8Array | undefined;
/** Raw DEFLATE of 101 MiB of zeros (~100 KiB compressed), built once. */
const bomb = () => (bombPayload ??= deflateSync(new Uint8Array(101 * 1024 * 1024), { level: 9 }));

/** Valid entries of the fixture archive, as raw entries for the forging writer. */
async function validEntries(): Promise<RawEntry[]> {
  const files = unzipSync((await build()).bytes);
  return Object.entries(files).map(([name, data]) => ({ name, data, deflate: name.endsWith(".json") }));
}

const semantic = (content: ProjectContent) => {
  const normalized = normalizeForPersistence(content);
  const hashOf = (id: string) => normalized.document.assets[id].sha256;
  return {
    title: normalized.title,
    slides: normalized.document.slides.map((slide) => ({
      ...slide,
      id: "slide",
      nodes: slide.nodes.map((node: CanvasNode) => ({ ...node, id: "node", ...(node.type === "image" ? { assetId: hashOf(node.assetId) } : {}) })),
    })),
    assets: Object.values(normalized.document.assets)
      .map(({ id: _id, storagePath: _path, ...rest }) => rest) // eslint-disable-line @typescript-eslint/no-unused-vars
      .sort((a, b) => a.sha256.localeCompare(b.sha256)),
  };
};

// ================================================================== export

describe("buildArchive (ARC-01, ARC-02)", () => {
  it("writes exactly manifest.json, document.json and the referenced assets", async () => {
    const { bytes, filename, manifest } = await build();
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual([
      "manifest.json", "document.json",
      `assets/${PNG_ID}.png`, `assets/${JPEG_ID}.jpg`, `assets/${WEBP_ID}.webp`,
    ]);
    expect(filename).toBe("Git เบื้องต้น_ บทที่ 1.learning-suit");
    expect(manifest).toEqual({
      format: "learning-suit", formatVersion: 1, documentSchemaVersion: 1, title: "Git เบื้องต้น: บทที่ 1",
      exportedAt: "2026-09-24T12:00:00.000Z",
      assets: [
        { id: PNG_ID, path: `assets/${PNG_ID}.png` },
        { id: JPEG_ID, path: `assets/${JPEG_ID}.jpg` },
        { id: WEBP_ID, path: `assets/${WEBP_ID}.webp` },
      ],
    });
    expect(parse(files["manifest.json"])).toEqual(manifest);
    expect(files[`assets/${JPEG_ID}.jpg`]).toEqual(JPEG);

    const document = parse(files["document.json"]);
    expect(Object.keys(document)).toEqual(["schemaVersion", "slides", "assets"]);
    expect(Object.keys(document.assets).sort()).toEqual([PNG_ID, JPEG_ID, WEBP_ID].sort());
    expect(Object.keys(document.assets[PNG_ID]).sort()).toEqual(["byteLength", "height", "id", "mimeType", "sha256", "width"]);
  });

  it("never leaks owner, project, storage paths, revision, tokens or session state", async () => {
    const record = {
      ...fixture, id: PROJECT, ownerId: OWNER, revision: 42, lastMutationId: "m-1",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null,
      accessToken: "secret-token", session: { activeSlideId: "x" }, pendingEdit: { kind: "text" },
    } as unknown as ProjectContent;
    const files = unzipSync((await build(record)).bytes);
    const text = strFromU8(files["manifest.json"]) + strFromU8(files["document.json"]);
    for (const forbidden of ["storagePath", "ownerId", "projectId", "revision", "token", "session", "pendingEdit", "history", "camera", "signedUrl", OWNER, PROJECT, "lastMutationId", "createdAt"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain(UNUSED_ID); // registered-but-unused asset is not exported
  });

  it("is deterministic for the same snapshot and time, and does not mutate the input", async () => {
    const before = structuredClone(fixture);
    const a = await build();
    const b = await build();
    expect(a.bytes).toEqual(b.bytes);
    expect(fixture).toEqual(before);
  });

  it("stores images uncompressed and deflates JSON", async () => {
    const { bytes } = await build();
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const methods: Record<string, number> = {};
    let p = 0;
    while (view.getUint32(p, true) === 0x04034b50) {
      const nameLength = view.getUint16(p + 26, true);
      const name = strFromU8(bytes.subarray(p + 30, p + 30 + nameLength));
      methods[name] = view.getUint16(p + 8, true);
      p += 30 + nameLength + view.getUint16(p + 28, true) + view.getUint32(p + 18, true);
    }
    expect(methods["document.json"]).toBe(8);
    expect(methods[`assets/${PNG_ID}.png`]).toBe(0);
  });

  it("reports progress per asset and at completion", async () => {
    const calls: [number, number][] = [];
    await build(fixture, { onProgress: (done, total) => calls.push([done, total]) });
    expect(calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
  });

  it("fails with ASSET_MISSING naming the asset when bytes cannot be resolved (no output)", async () => {
    const offline = async (asset: AssetReference) => {
      if (asset.id === JPEG_ID) throw new Error("offline and not cached");
      return resolveBlob(asset);
    };
    const error = await expectCode(build(fixture, { resolveBlob: offline }), "ASSET_MISSING");
    expect(error.assetId).toBe(JPEG_ID);
    expect(error.message).toContain(JPEG_ID);
    const missing = await expectCode(build(fixture, { resolveBlob: async (a) => (a.id === WEBP_ID ? null : resolveBlob(a)) }), "ASSET_MISSING");
    expect(missing.assetId).toBe(WEBP_ID);
  });

  it("rejects local bytes that do not match metadata (length, MIME, hash)", async () => {
    const swap = (id: string, bytes: Uint8Array) => async (asset: AssetReference) =>
      asset.id === id ? new Blob([bytes as Uint8Array<ArrayBuffer>]) : resolveBlob(asset);
    expect((await expectCode(build(fixture, { resolveBlob: swap(PNG_ID, JPEG) }), "ASSET_MISMATCH")).assetId).toBe(PNG_ID);
    const flipped = PNG.slice();
    flipped[PNG.byteLength - 1] ^= 0xff;
    expect((await expectCode(build(fixture, { resolveBlob: swap(PNG_ID, flipped) }), "ASSET_MISMATCH")).detail).toMatch(/sha256/);
    const notPng = PNG.slice();
    notPng[0] = 0;
    expect((await expectCode(build(fixture, { resolveBlob: swap(PNG_ID, notPng) }), "ASSET_MISMATCH")).detail).toMatch(/MIME/);
  });

  it("enforces compressed, uncompressed and entry limits without producing output", async () => {
    await expectCode(build(fixture, { limits: { compressedBytes: 200 } }), "TOO_LARGE");
    await expectCode(build(fixture, { limits: { decompressedBytes: 1000 } }), "DECOMPRESSED_TOO_LARGE");
    await expectCode(build(fixture, { limits: { entries: 4 } }), "TOO_MANY_ENTRIES");
  });

  it("rejects invalid documents and honours AbortSignal", async () => {
    const invalid = structuredClone(fixture);
    invalid.document.slides[1].nodes[0].id = invalid.document.slides[0].nodes[0].id;
    await expectCode(build(invalid), "INVALID_DOCUMENT");
    const controller = new AbortController();
    controller.abort();
    await expectCode(build(fixture, { signal: controller.signal }), "ABORTED");
    const midway = new AbortController();
    const slow = async (asset: AssetReference) => { midway.abort(); return resolveBlob(asset); };
    await expectCode(build(fixture, { resolveBlob: slow, signal: midway.signal }), "ABORTED");
  });

  it("sanitizes only filename-unsafe characters", () => {
    expect(archiveFilename("บทเรียน Git")).toBe("บทเรียน Git.learning-suit");
    expect(archiveFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j.learning-suit");
    expect(archiveFilename("สวัสดี\u202Egpj.exe")).toBe("สวัสดี_gpj.exe.learning-suit");
    expect(archiveFilename("CON")).toBe("_CON.learning-suit");
    expect(archiveFilename("...")).toBe("learning-suit.learning-suit");
    expect(archiveFilename("บทที่ 1.")).toBe("บทที่ 1.learning-suit");
  });
});

// ================================================================== round trip

describe("importArchive round trip (ARC-03)", () => {
  it("restores the same document after normalizing IDs, storage paths and exportedAt", async () => {
    const { bytes } = await build();
    const { content, blobs } = await importArchive(new Blob([bytes]), TARGET, { decodeImage });

    expect(parseProjectContent(content)).toEqual(content);
    expect(semantic(content)).toEqual(semantic(fixture));
    // Git state deep-equal and commit IDs kept.
    const git = content.document.slides[0].nodes[2];
    const originalGit = fixture.document.slides[0].nodes[2];
    if (git.type !== "git-simulator" || originalGit.type !== "git-simulator") throw new Error("fixture order");
    expect(git.state).toEqual(originalGit.state);
    expect(Object.keys(git.state.commits)).toEqual(["C1", "C2"]);

    // New identities everywhere, storage paths under the current owner/project.
    const oldIds = new Set([
      ...fixture.document.slides.map((s) => s.id),
      ...fixture.document.slides.flatMap((s) => s.nodes.map((n) => n.id)),
      ...Object.keys(fixture.document.assets),
    ]);
    for (const slide of content.document.slides) {
      expect(oldIds.has(slide.id)).toBe(false);
      for (const node of slide.nodes) expect(oldIds.has(node.id)).toBe(false);
    }
    expect(Object.keys(content.document.assets)).toHaveLength(3);
    for (const asset of Object.values(content.document.assets)) {
      expect(oldIds.has(asset.id)).toBe(false);
      expect(asset.storagePath).toBe(storagePathFor(TARGET.ownerId, TARGET.projectId, asset.id, asset.mimeType));
      const blob = blobs.get(asset.id)!;
      expect(blob.type).toBe(asset.mimeType);
      expect(await sha256Hex(blob)).toBe(asset.sha256);
    }
    expect([...blobs.keys()].sort()).toEqual(Object.keys(content.document.assets).sort());
    // The PNG used twice is still one asset referenced by both image nodes.
    const imageAssets = content.document.slides.flatMap((s) => s.nodes).flatMap((n) => (n.type === "image" ? [n.assetId] : []));
    expect(imageAssets[0]).toBe(imageAssets[3]);
  });

  it("readArchive returns the sanitized manifest/document and validated blobs", async () => {
    const { bytes, manifest } = await build();
    const archive = await read(bytes);
    expect(archive.manifest).toEqual(manifest);
    expect(Object.keys(archive.document.assets[PNG_ID])).not.toContain("storagePath");
    expect([...archive.blobs.keys()]).toEqual([PNG_ID, JPEG_ID, WEBP_ID]);
  });

  it("accepts a project without images", async () => {
    const plain: ProjectContent = { title: "ว่าง", document: { schemaVersion: 1, slides: [{ ...fixture.document.slides[0], nodes: [fixture.document.slides[0].nodes[0]] }], assets: {} } };
    const { bytes } = await build(plain);
    expect(Object.keys(unzipSync(bytes))).toEqual(["manifest.json", "document.json"]);
    const { content, blobs } = await importArchive(bytes, TARGET, { decodeImage });
    expect(semantic(content)).toEqual(semantic(plain));
    expect(blobs.size).toBe(0);
  });

  it("accepts entries written with data descriptors (streaming ZIP writers)", async () => {
    const files = unzipSync((await build()).bytes);
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
    for (const [name, data] of Object.entries(files)) {
      const file = name.endsWith(".json") ? new ZipDeflate(name) : new ZipPassThrough(name);
      zip.add(file);
      file.push(data, true);
    }
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    expect(new DataView(bytes.buffer).getUint16(6, true) & 0x8).toBe(0x8);
    const { content } = await importArchive(bytes, TARGET, { decodeImage });
    expect(semantic(content)).toEqual(semantic(fixture));
  });

  it("reports progress and honours AbortSignal during import", async () => {
    const { bytes } = await build();
    const calls: number[] = [];
    await read(bytes, { onProgress: (done, total) => { calls.push(done); expect(total).toBe(5); } });
    expect(calls).toEqual([1, 2, 3, 4, 5]);
    const controller = new AbortController();
    const aborting: DecodeImage = async (data, mime) => { controller.abort(); return decodeImage(data, mime); };
    await expectCode(read(bytes, { decodeImage: aborting, signal: controller.signal }), "ABORTED");
  });
});

// ================================================================== strict validation

describe("readArchive content validation (ARC-04)", () => {
  it("rejects unknown format and versions", async () => {
    await expectCode(read(await tampered((f) => editJson(f, "manifest.json", (m) => { m.formatVersion = 2; }))), "UNSUPPORTED_VERSION");
    await expectCode(read(await tampered((f) => editJson(f, "manifest.json", (m) => { m.documentSchemaVersion = 2; }))), "UNSUPPORTED_VERSION");
    await expectCode(read(await tampered((f) => editJson(f, "document.json", (d) => { d.schemaVersion = 2; }))), "UNSUPPORTED_VERSION");
    await expectCode(read(await tampered((f) => editJson(f, "manifest.json", (m) => { m.format = "other-app"; }))), "UNSUPPORTED_FORMAT");
  });

  it("rejects corrupt JSON", async () => {
    await expectCode(read(await tampered((f) => { f["document.json"] = strToU8('{"schemaVersion":1,'); })), "BAD_JSON");
    await expectCode(read(await tampered((f) => { f["manifest.json"] = strToU8("not json"); })), "BAD_JSON");
    await expectCode(read(await tampered((f) => { f["manifest.json"] = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]); })), "BAD_JSON");
  });

  it("rejects missing files", async () => {
    await expectCode(read(await tampered((f) => { delete f["document.json"]; })), "MISSING_ENTRY");
    await expectCode(read(await tampered((f) => { delete f["manifest.json"]; })), "MISSING_ENTRY");
    const error = await expectCode(read(await tampered((f) => { delete f[`assets/${WEBP_ID}.webp`]; })), "MISSING_ENTRY");
    expect(error.entry).toBe(`assets/${WEBP_ID}.webp`);
  });

  it("rejects wrong hash, MIME and dimensions", async () => {
    const wrongHash = await tampered((f) => editJson(f, "document.json", (d) => { d.assets[PNG_ID].sha256 = "0".repeat(64); }));
    expect((await expectCode(read(wrongHash), "ASSET_MISMATCH")).detail).toMatch(/sha256/);

    const wrongMime = await tampered((f) => {
      editJson(f, "document.json", (d) => { d.assets[PNG_ID].mimeType = "image/jpeg"; });
      editJson(f, "manifest.json", (m) => { m.assets[0].path = `assets/${PNG_ID}.jpg`; });
      f[`assets/${PNG_ID}.jpg`] = f[`assets/${PNG_ID}.png`];
      delete f[`assets/${PNG_ID}.png`];
    });
    expect((await expectCode(read(wrongMime), "ASSET_MISMATCH")).detail).toMatch(/MIME/);

    const wrongSize = await tampered((f) => editJson(f, "document.json", (d) => { d.assets[JPEG_ID].width = 3; }));
    // Caught from the file header before any decode (a lying manifest can't force a big allocation).
    let decodes = 0;
    const counting: DecodeImage = async (bytes, mime) => { decodes += 1; return decodeImage(bytes, mime); };
    const error = await expectCode(read(wrongSize, { decodeImage: counting }), "ASSET_MISMATCH");
    expect(error.assetId).toBe(JPEG_ID);
    expect(error.detail).toMatch(/header 2x3 != 3x3/);
    expect(decodes).toBe(1); // only the PNG before it was decoded

    const swappedBytes = await tampered((f) => { f[`assets/${PNG_ID}.png`] = JPEG; });
    await expectCode(read(swappedBytes), "ASSET_MISMATCH");

    const undecodable: DecodeImage = async () => { throw new Error("decode error"); };
    await expectCode(read((await build()).bytes, { decodeImage: undecodable }), "ASSET_MISMATCH");
  });

  it("validates the document through the canonical schema (IDs, references, Git graph, strictness)", async () => {
    const cases: ((d: Record<string, any>) => void)[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (d) => { d.slides[1].nodes[0].id = d.slides[0].nodes[0].id; }, // duplicate node ID
      (d) => { d.slides[1].id = d.slides[0].id; }, // duplicate slide ID
      (d) => { d.slides[0].nodes[2].state.remote.mainHead = "C9"; }, // Git ref to unknown commit
      (d) => { d.slides[0].nodes[2].state.commits.C2.parentId = "C7"; }, // broken Git parent
      (d) => { d.slides[0].nodes[0].type = "shape-v2"; }, // unknown node type
      (d) => { d.slides[0].nodes[0].x = 1e12; }, // coordinate limit
      (d) => { d.slides[0].nodes[0].onclick = "alert(1)"; }, // unknown field
      (d) => { d.assets[PNG_ID].storagePath = `${OWNER}/${PROJECT}/${PNG_ID}.png`; }, // storagePath must not be in archive
      (d) => { d.ownerId = OWNER; }, // owner must not be in archive
      (d) => { d.slides = []; }, // at least one slide
      (d) => { d.slides[0].nodes[1].assetId = UNUSED_ID; }, // dangling asset reference
      (d) => { d.assets[UNUSED_ID] = { ...d.assets[PNG_ID], id: UNUSED_ID }; }, // unreferenced asset
      (d) => { d.assets[PNG_ID].width = 8192; d.assets[PNG_ID].height = 4096; }, // > 16,777,216 px
    ];
    for (const edit of cases) {
      await expectCode(read(await tampered((f) => editJson(f, "document.json", edit))), "INVALID_DOCUMENT");
    }
    await expectCode(read(await tampered((f) => editJson(f, "manifest.json", (m) => { m.title = "  "; }))), "INVALID_MANIFEST");
    await expectCode(read(await tampered((f) => editJson(f, "manifest.json", (m) => { m.extra = true; }))), "INVALID_MANIFEST");
  });

  it("requires manifest asset paths to be exactly assets/<id>.<ext-for-mime>", async () => {
    const bytes = await tampered((f) => {
      editJson(f, "manifest.json", (m) => { m.assets[0].path = `assets/${PNG_ID}.webp`; });
      f[`assets/${PNG_ID}.webp`] = f[`assets/${PNG_ID}.png`];
      delete f[`assets/${PNG_ID}.png`];
    });
    await expectCode(read(bytes), "INVALID_MANIFEST");
    const renamed = await tampered((f) => editJson(f, "manifest.json", (m) => { m.assets[0].id = UNUSED_ID; }));
    await expectCode(read(renamed), "INVALID_MANIFEST");
  });

  it("rejects entries not listed in the manifest", async () => {
    const html = await expectCode(read(await tampered((f) => { f["index.html"] = strToU8("<script>alert(1)</script>"); })), "UNEXPECTED_ENTRY");
    expect(html.entry).toBe("index.html");
    await expectCode(read(await tampered((f) => { f[`assets/${UNUSED_ID}.png`] = PNG; })), "UNEXPECTED_ENTRY");
    await expectCode(read(await tampered((f) => { f["assets/readme.txt"] = strToU8("x"); })), "UNEXPECTED_ENTRY");
  });
});

// ================================================================== hostile ZIPs

describe("readArchive ZIP hardening (ARC-05)", () => {
  it("rejects path traversal, absolute paths and backslashes", async () => {
    const valid = await validEntries();
    for (const name of ["../evil.json", "assets/../manifest.json", "./manifest.json", "/etc/passwd", "C:/evil.json", "assets\\evil.png", "assets//x.png", "evil\u0000.json"]) {
      const error = await expectCode(read(writeZip([...valid, { name, data: strToU8("x") }])), "UNSAFE_PATH");
      expect(error.message).not.toContain("\u0000");
    }
  });

  it("rejects duplicate entries (exact and case-folded)", async () => {
    const valid = await validEntries();
    await expectCode(read(writeZip([...valid, { name: "manifest.json", data: valid[0].data }])), "DUPLICATE_ENTRY");
    await expectCode(read(writeZip([...valid, { name: "Document.json", data: valid[1].data }])), "DUPLICATE_ENTRY");
  });

  it("rejects directories, symlinks and encrypted entries", async () => {
    const valid = await validEntries();
    await expectCode(read(writeZip([...valid, { name: "assets/", data: new Uint8Array(0) }])), "UNEXPECTED_ENTRY");
    await expectCode(read(writeZip([...valid, { name: "assets", data: new Uint8Array(0), externalAttributes: 0x10 }])), "UNEXPECTED_ENTRY");
    const symlink = valid.map((e, i) => (i === 2 ? { ...e, madeBy: 0x0314, externalAttributes: (0o120777 << 16) >>> 0 } : e));
    await expectCode(read(writeZip(symlink)), "UNSAFE_PATH");
    const encrypted = valid.map((e, i) => (i === 1 ? { ...e, flags: 0x1 } : e));
    await expectCode(read(writeZip(encrypted)), "ENCRYPTED_ENTRY");
    // Unix regular files are fine.
    const unix = valid.map((e) => ({ ...e, madeBy: 0x0314, externalAttributes: (0o100644 << 16) >>> 0 }));
    await expect(read(writeZip(unix))).resolves.toBeDefined();
  });

  it("allows only stored and deflate compression", async () => {
    const valid = await validEntries();
    for (const method of [12, 14, 93, 99]) {
      const forged = valid.map((e, i) => (i === 1 ? { ...e, method, compressed: e.data } : e));
      await expectCode(read(writeZip(forged)), "UNSUPPORTED_COMPRESSION");
    }
  });

  it("rejects more than 1000 entries before decompressing anything", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ name: `x${i}`, data: new Uint8Array(0) }));
    await expectCode(read(writeZip(many)), "TOO_MANY_ENTRIES");
    const valid = await validEntries();
    await expectCode(read(writeZip(valid), { limits: { entries: 4 } }), "TOO_MANY_ENTRIES");
  });

  it("stops a decompression bomb by actual bytes even when headers claim a tiny size", async () => {
    const valid = await validEntries();
    expect(bomb().byteLength).toBeLessThan(1024 * 1024);
    const forged = valid.map((e) => (e.name === "document.json" ? { ...e, compressed: bomb(), method: 8, size: 2000 } : e));
    const started = performance.now();
    const error = await expectCode(read(writeZip(forged)), "DECOMPRESSED_TOO_LARGE");
    expect(error.detail).toMatch(/actual/);
    expect(performance.now() - started).toBeLessThan(2000);

    // Image entry whose header claims the metadata byteLength: stopped by actual bytes too.
    const assetBomb = valid.map((e, i) => (i === 2 ? { ...e, compressed: bomb(), method: 8 } : e));
    await expectCode(read(writeZip(assetBomb)), "DECOMPRESSED_TOO_LARGE");
  });

  it("counts actual bytes across entries against the archive-wide budget", async () => {
    const valid = await validEntries();
    // Declared sizes (~5.3 KB) fit the test-only 6,000-byte budget, the real stream does not.
    const forged = valid.map((e) => (e.name === "document.json" ? { ...e, compressed: bomb(), method: 8, size: 4000 } : e));
    const error = await expectCode(read(writeZip(forged), { limits: { decompressedBytes: 6000 } }), "DECOMPRESSED_TOO_LARGE");
    expect(error.detail).toMatch(/actual total/);
  });

  it("rejects honest headers whose declared total exceeds the budget before inflating", async () => {
    const valid = await validEntries();
    const honest = valid.map((e) => (e.name === "document.json" ? { ...e, compressed: bomb(), method: 8, size: 101 * 1024 * 1024, crc: 0 } : e));
    expect((await expectCode(read(writeZip(honest)), "DECOMPRESSED_TOO_LARGE")).detail).toMatch(/declared/);
    await expectCode(read(writeZip(valid), { limits: { decompressedBytes: 500 } }), "DECOMPRESSED_TOO_LARGE");
  });

  it("rejects non-ZIP input, oversize input and structural corruption", async () => {
    await expectCode(read(strToU8("hello, not a zip")), "BAD_SIGNATURE");
    await expectCode(read(new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])), "TOO_LARGE");
    const valid = await validEntries();
    const good = writeZip(valid);
    await expectCode(read(good.subarray(0, good.byteLength - 5)), "CORRUPT_ARCHIVE"); // truncated
    await expectCode(read(writeZip(valid, { trailing: strToU8("junk") })), "CORRUPT_ARCHIVE"); // data after EOCD
    const smuggled = valid.map((e, i) => (i === 0 ? { ...e, localName: "evil.jsonx" } : e));
    await expectCode(read(writeZip(smuggled)), "CORRUPT_ARCHIVE"); // local/central name disagreement
    const badCrc = valid.map((e, i) => (i === 1 ? { ...e, crc: 1234 } : e));
    await expectCode(read(writeZip(badCrc)), "CORRUPT_ARCHIVE");
    const garbage = valid.map((e, i) => (i === 1 ? { ...e, compressed: strToU8("definitely not deflate"), method: 8 } : e));
    await expectCode(read(writeZip(garbage)), "CORRUPT_ARCHIVE");
    // Sanity: the forging writer itself produces an importable archive.
    await expect(importArchive(good, TARGET, { decodeImage })).resolves.toBeDefined();
  });
});

// ================================================================== worker protocol + client

describe("archive worker protocol and client (ARC-05 worker integration)", () => {
  type Listener = (event: { data: unknown }) => void;
  let workerListener: Listener | undefined;
  let bitmapsClosed = 0;
  const created: FakeWorker[] = [];

  /** Same-thread stand-in for a module Worker: structured-clones messages (with transfer) both ways. */
  class FakeWorker {
    onmessage: Listener | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    received: unknown[] = [];
    constructor(readonly url: URL, readonly options: WorkerOptions) {
      created.push(this);
    }
    postMessage(message: unknown, transfer: Transferable[] = []) {
      const data = structuredClone(message, { transfer });
      this.received.push(data);
      setTimeout(() => { if (!this.terminated) workerListener?.({ data }); }, 0);
    }
    terminate() {
      this.terminated = true;
    }
  }

  beforeAll(async () => {
    vi.stubGlobal("addEventListener", (type: string, listener: Listener) => { if (type === "message") workerListener = listener; });
    vi.stubGlobal("postMessage", (message: unknown, transfer: Transferable[] = []) => {
      const target = created.at(-1);
      const data = structuredClone(message, { transfer });
      setTimeout(() => { if (target && !target.terminated) target.onmessage?.({ data }); }, 0);
    });
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
      const dims = await decodeImage(new Uint8Array(await blob.arrayBuffer()), blob.type as AssetReference["mimeType"]);
      return { ...dims, close: () => { bitmapsClosed += 1; } };
    });
    vi.stubGlobal("Worker", FakeWorker);
    await import("./archive.worker");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("exports and imports through the worker, transferring bytes and terminating the worker", async () => {
    const progress: [number, number][] = [];
    const exported = await exportArchiveInWorker(fixture, resolveBlob, { onProgress: (d, t) => progress.push([d, t]) });
    const exportWorker = created.at(-1)!;
    expect(exportWorker.url.pathname.endsWith("/archive.worker.ts")).toBe(true);
    expect(exportWorker.options.type).toBe("module");
    expect(exportWorker.terminated).toBe(true);
    expect(exported.blob.type).toBe("application/zip");
    expect(exported.filename).toBe("Git เบื้องต้น_ บทที่ 1.learning-suit");
    expect(Object.keys(unzipSync(new Uint8Array(await exported.blob.arrayBuffer())))).toHaveLength(5);
    expect(progress.at(-1)).toEqual([4, 4]);
    for (let i = 1; i < progress.length; i++) expect(progress[i][0]).toBeGreaterThanOrEqual(progress[i - 1][0]);
    const request = exportWorker.received[0] as { type: string; content: Record<string, unknown>; assets: { id: string }[] };
    expect(request.type).toBe("export");
    expect(Object.keys(request.content)).toEqual(["title", "document"]);
    expect(request.assets.map((a) => a.id)).toEqual([PNG_ID, JPEG_ID, WEBP_ID]);

    bitmapsClosed = 0;
    const imported = await importArchiveInWorker(exported.blob, TARGET);
    expect(created.at(-1)!.terminated).toBe(true);
    expect(semantic(imported.content)).toEqual(semantic(fixture));
    expect(bitmapsClosed).toBe(3); // every decoded bitmap released
    for (const asset of Object.values(imported.content.document.assets)) {
      expect(asset.storagePath.startsWith(`${TARGET.ownerId}/${TARGET.projectId}/`)).toBe(true);
      expect(await sha256Hex(imported.blobs.get(asset.id)!)).toBe(asset.sha256);
    }
  });

  it("rehydrates worker errors as ArchiveError with code and Thai message", async () => {
    const error = await expectCode(importArchiveInWorker(new Blob(["not a zip"]), TARGET), "BAD_SIGNATURE");
    expect(error.name).toBe("ArchiveError");
    expect(created.at(-1)!.terminated).toBe(true);
    const valid = await validEntries();
    await expectCode(importArchiveInWorker(new Blob([writeZip([...valid, { name: "../x", data: new Uint8Array(1) }]) as Uint8Array<ArrayBuffer>]), TARGET), "UNSAFE_PATH");
  });

  it("fails fast on the main thread for missing assets and oversize files", async () => {
    const before = created.length;
    const missing = await expectCode(exportArchiveInWorker(fixture, async (a) => (a.id === JPEG_ID ? null : resolveBlob(a))), "ASSET_MISSING");
    expect(missing.assetId).toBe(JPEG_ID);
    await expectCode(importArchiveInWorker(new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]), TARGET), "TOO_LARGE");
    expect(created.length).toBe(before);
  });

  it("cancels by terminating the worker", async () => {
    const { blob } = await exportArchiveInWorker(fixture, resolveBlob);
    const controller = new AbortController();
    const pending = importArchiveInWorker(blob, TARGET, { signal: controller.signal });
    controller.abort();
    await expectCode(pending, "ABORTED");
    expect(created.at(-1)!.terminated).toBe(true);
    expect((created.at(-1)!.received.at(-1) as { type: string }).type).toBe("cancel");
  });

  it("falls back to the main thread when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    try {
      const before = created.length;
      const exported = await exportArchiveInWorker(fixture, resolveBlob);
      const imported = await importArchiveInWorker(exported.blob, TARGET);
      expect(semantic(imported.content)).toEqual(semantic(fixture));
      expect(created.length).toBe(before);
    } finally {
      vi.stubGlobal("Worker", FakeWorker);
    }
  });
});
