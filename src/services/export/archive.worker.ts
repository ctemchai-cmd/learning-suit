/**
 * Web Worker entry for `.learning-suit` export/import (plan 05 §9: "ZIP ใน Web Worker",
 * "streaming decompression ใน worker"). Created by `archive-client.ts`, one worker per task.
 *
 * Protocol (see ArchiveWorkerRequest/Response in archive-types.ts):
 *   main → worker: export | import | cancel, each with a numeric request `id`
 *   worker → main: progress | export-result (archive bytes transferred) | import-result | error
 */
import { ArchiveError, buildArchive, decodeImageWithBitmap, importArchive } from "./archive";
import type { ArchiveWorkerRequest, ArchiveWorkerResponse, SerializedArchiveError } from "./archive-types";

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<ArchiveWorkerRequest>) => void): void;
  postMessage(message: ArchiveWorkerResponse, transfer?: Transferable[]): void;
};

const scope = globalThis as unknown as WorkerScope;
const running = new Map<number, AbortController>();

function post(message: ArchiveWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function serializeError(error: unknown): SerializedArchiveError {
  if (error instanceof ArchiveError) return error.toJSON();
  return new ArchiveError("WORKER_FAILED", { detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }).toJSON();
}

async function run(request: Exclude<ArchiveWorkerRequest, { type: "cancel" }>, signal: AbortSignal): Promise<void> {
  const onProgress = (done: number, total: number) => post({ type: "progress", id: request.id, done, total });
  if (request.type === "export") {
    const buffers = new Map(request.assets.map((asset) => [asset.id, asset.bytes]));
    const result = await buildArchive(request.content, {
      resolveBlob: async (asset) => {
        const bytes = buffers.get(asset.id);
        return bytes ? new Blob([bytes], { type: asset.mimeType }) : null;
      },
      now: () => new Date(request.exportedAt),
      signal,
      onProgress,
    });
    buffers.clear();
    post({ type: "export-result", id: request.id, bytes: result.bytes, filename: result.filename, manifest: result.manifest }, [result.bytes.buffer]);
    return;
  }
  const result = await importArchive(request.file, request.target, { decodeImage: decodeImageWithBitmap, signal, onProgress });
  post({ type: "import-result", id: request.id, content: result.content, blobs: result.blobs });
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    running.get(request.id)?.abort();
    return;
  }
  const controller = new AbortController();
  running.set(request.id, controller);
  run(request, controller.signal)
    .catch((error: unknown) => post({ type: "error", id: request.id, error: serializeError(error) }))
    .finally(() => running.delete(request.id));
});
