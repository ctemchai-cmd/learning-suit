"use client";

import type { AssetReference } from "@/domain/document/model";
import { storagePathFor } from "@/domain/document/assets";
import { checkImageBytes, checkImageDimensions, readImageDimensions, sniffImageMime } from "@/domain/document/image-rules";
import { sha256Hex } from "@/lib/sha256";

export class ImageIngestError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "ImageIngestError"; }
}

/**
 * Validates MIME (magic bytes) + size + decode + pixel limits BEFORE anything touches the document
 * (plan03 §7 Image, IMG-02). Returns immutable bytes and metadata for a new asset UUID.
 */
export async function ingestImage(file: Blob, target: { ownerId: string; projectId: string }): Promise<{ asset: AssetReference; blob: Blob }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mimeType = sniffImageMime(bytes);
  const byteProblem = checkImageBytes(bytes.byteLength, file.type, mimeType);
  if (byteProblem || !mimeType) throw new ImageIngestError(byteProblem?.code ?? "UNSUPPORTED_TYPE", byteProblem?.message ?? "ไฟล์รูปไม่รองรับ");
  // Reject declared oversize canvases before the browser allocates them during decode.
  const declared = readImageDimensions(bytes, mimeType);
  const declaredProblem = declared ? checkImageDimensions(declared.width, declared.height) : null;
  if (declaredProblem) throw new ImageIngestError(declaredProblem.code, declaredProblem.message);
  const blob = new Blob([buffer], { type: mimeType });
  let width: number, height: number;
  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width; height = bitmap.height;
    bitmap.close();
  } catch {
    throw new ImageIngestError("DECODE_FAILED", "เปิดไฟล์รูปนี้ไม่ได้ ไฟล์อาจเสียหาย");
  }
  const dimensionProblem = checkImageDimensions(width, height);
  if (dimensionProblem) throw new ImageIngestError(dimensionProblem.code, dimensionProblem.message);
  const id = crypto.randomUUID();
  const asset: AssetReference = {
    id, mimeType, width, height, byteLength: bytes.byteLength, sha256: await sha256Hex(buffer),
    storagePath: storagePathFor(target.ownerId, target.projectId, id, mimeType),
  };
  return { asset, blob };
}
