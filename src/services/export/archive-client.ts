/**
 * Main-thread API for `.learning-suit` export/import. Heavy work (ZIP, inflate, hashing,
 * image decode) runs in `archive.worker.ts`; one worker per task, terminated on completion or
 * cancel. Falls back to running `archive.ts` on the main thread only when Workers are
 * unavailable (tests/old runtimes) or cannot be constructed (e.g. CSP).
 *
 * Nothing here writes storage. Import callers commit the result atomically, e.g.
 * `createLocalDraft(ownerId, projectId, result.content, result.blobs)`.
 */
import { referencedAssetIds } from "../../domain/document/assets";
import type { AssetReference, ProjectContent } from "../../domain/document/model";
import {
  ARCHIVE_LIMITS,
  ARCHIVE_MIME_TYPE,
  ArchiveError,
  type ArchiveManifest,
  type ArchiveWorkerRequest,
  type ArchiveWorkerResponse,
  type ImportTarget,
} from "./archive-types";

export type ArchiveTaskOptions = {
  signal?: AbortSignal;
  /** Monotonic progress (done ≤ total). */
  onProgress?: (done: number, total: number) => void;
};

export type ExportedArchive = { blob: Blob; filename: string; manifest: ArchiveManifest };
export type ImportedArchive = {
  content: ProjectContent;
  /** NEW asset ID → validated image bytes. */
  blobs: Map<string, Blob>;
};

let nextRequestId = 1;

function aborted(signal?: AbortSignal): ArchiveError {
  return new ArchiveError("ABORTED", { cause: signal?.reason });
}

function monotonic(onProgress?: ArchiveTaskOptions["onProgress"]): ArchiveTaskOptions["onProgress"] {
  if (!onProgress) return undefined;
  let last = 0;
  return (done, total) => {
    if (done < last) return;
    last = done;
    onProgress(done, total);
  };
}

/**
 * Export `content` as a `.learning-suit` file. `getBlob` resolves each referenced asset's bytes
 * on the main thread (local IndexedDB first, then authenticated download). A missing asset
 * rejects with `ArchiveError` `ASSET_MISSING` (with `assetId`) and nothing is produced.
 */
export async function exportArchiveInWorker(
  content: ProjectContent,
  getBlob: (asset: AssetReference) => Promise<Blob | null>,
  options: ArchiveTaskOptions = {},
): Promise<ExportedArchive> {
  const { signal } = options;
  const onProgress = monotonic(options.onProgress);
  if (signal?.aborted) throw aborted(signal);
  const snapshot: ProjectContent = { title: content.title, document: content.document };

  const ids = [...referencedAssetIds(snapshot.document)].filter((id) => snapshot.document.assets[id]);
  const total = ids.length + 1;
  const assets: { id: string; bytes: ArrayBuffer }[] = [];
  for (const [index, id] of ids.entries()) {
    const asset = snapshot.document.assets[id];
    let blob: Blob | null;
    try {
      blob = await getBlob(asset);
    } catch (cause) {
      if (signal?.aborted) throw aborted(signal);
      throw new ArchiveError("ASSET_MISSING", { assetId: id, detail: String(cause), cause });
    }
    if (signal?.aborted) throw aborted(signal);
    if (!blob) throw new ArchiveError("ASSET_MISSING", { assetId: id });
    assets.push({ id, bytes: await blob.arrayBuffer() });
    onProgress?.(index + 1, total);
  }
  const exportedAt = new Date().toISOString();

  const worker = createWorker();
  if (!worker) {
    const { buildArchive } = await import("./archive");
    const buffers = new Map(assets.map((asset) => [asset.id, asset.bytes]));
    const result = await buildArchive(snapshot, {
      resolveBlob: async (asset) => {
        const bytes = buffers.get(asset.id);
        return bytes ? new Blob([bytes], { type: asset.mimeType }) : null;
      },
      now: () => new Date(exportedAt),
      signal,
      onProgress,
    });
    return { blob: new Blob([result.bytes], { type: ARCHIVE_MIME_TYPE }), filename: result.filename, manifest: result.manifest };
  }

  const response = await runInWorker(
    worker,
    { type: "export", id: nextRequestId++, content: snapshot, assets, exportedAt },
    assets.map((asset) => asset.bytes),
    signal,
    onProgress,
  );
  if (response.type !== "export-result") throw new ArchiveError("WORKER_FAILED", { detail: `unexpected ${response.type}` });
  return { blob: new Blob([response.bytes], { type: ARCHIVE_MIME_TYPE }), filename: response.filename, manifest: response.manifest };
}

/**
 * Validate and read a `.learning-suit` file into a NEW project identity under `target`
 * (new project/slide/node/asset IDs and storage paths). Rejects with `ArchiveError`;
 * never touches the currently open project or any storage.
 */
export async function importArchiveInWorker(file: Blob, target: ImportTarget, options: ArchiveTaskOptions = {}): Promise<ImportedArchive> {
  const { signal } = options;
  const onProgress = monotonic(options.onProgress);
  if (signal?.aborted) throw aborted(signal);
  if (file.size > ARCHIVE_LIMITS.compressedBytes) throw new ArchiveError("TOO_LARGE", { detail: `${file.size} bytes` });

  const worker = createWorker();
  if (!worker) {
    const { decodeImageWithBitmap, importArchive } = await import("./archive");
    return importArchive(file, target, { decodeImage: decodeImageWithBitmap, signal, onProgress });
  }
  const response = await runInWorker(worker, { type: "import", id: nextRequestId++, file, target }, [], signal, onProgress);
  if (response.type !== "import-result") throw new ArchiveError("WORKER_FAILED", { detail: `unexpected ${response.type}` });
  return { content: response.content, blobs: response.blobs };
}

function createWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    // Literal `new Worker(new URL(..., import.meta.url))` form is required for bundler detection.
    return new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module", name: "learning-suit-archive" });
  } catch {
    return null;
  }
}

type WorkerTaskRequest = Exclude<ArchiveWorkerRequest, { type: "cancel" }>;
type WorkerResult = Extract<ArchiveWorkerResponse, { type: "export-result" | "import-result" }>;

function runInWorker(
  worker: Worker,
  request: WorkerTaskRequest,
  transfer: Transferable[],
  signal: AbortSignal | undefined,
  onProgress: ArchiveTaskOptions["onProgress"],
): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate(); // frees all temporary worker buffers
    };
    const fail = (error: ArchiveError) => {
      if (settled) return;
      finish();
      reject(error);
    };
    const onAbort = () => {
      try {
        worker.postMessage({ type: "cancel", id: request.id } satisfies ArchiveWorkerRequest);
      } catch {
        // worker already gone
      }
      fail(aborted(signal));
    };

    worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
      const message = event.data;
      if (settled || message.id !== request.id) return;
      if (message.type === "progress") {
        onProgress?.(message.done, message.total);
      } else if (message.type === "error") {
        fail(ArchiveError.from(message.error));
      } else {
        finish();
        resolve(message);
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new ArchiveError("WORKER_FAILED", { detail: event.message || "worker error" }));
    };
    worker.onmessageerror = () => fail(new ArchiveError("WORKER_FAILED", { detail: "message could not be deserialized" }));

    if (signal?.aborted) {
      fail(aborted(signal));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage(request, transfer);
    } catch (cause) {
      fail(new ArchiveError("WORKER_FAILED", { detail: String(cause), cause }));
    }
  });
}
