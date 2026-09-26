import { LIMITS } from "./limits";
import type { AssetReference } from "./model";

export type ImageMime = AssetReference["mimeType"];

/** Detects PNG / JPEG / WebP from magic bytes; never trusts the file extension. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export type ImageRejection =
  | { code: "UNSUPPORTED_TYPE"; message: string }
  | { code: "TOO_LARGE"; message: string }
  | { code: "TOO_MANY_PIXELS"; message: string }
  | { code: "DECODE_FAILED"; message: string };

export function checkImageBytes(byteLength: number, declaredType: string, sniffed: ImageMime | null): ImageRejection | null {
  if (!sniffed) {
    return { code: "UNSUPPORTED_TYPE", message: `ไฟล์นี้ไม่ใช่ PNG, JPEG หรือ WebP${declaredType ? ` (${declaredType})` : ""}` };
  }
  if (byteLength > LIMITS.imageBytes) return { code: "TOO_LARGE", message: "รูปใหญ่เกิน 10 MiB กรุณาย่อรูปก่อนแทรก" };
  if (byteLength < 1) return { code: "DECODE_FAILED", message: "ไฟล์รูปว่างเปล่า" };
  return null;
}

export function checkImageDimensions(width: number, height: number): ImageRejection | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return { code: "DECODE_FAILED", message: "อ่านขนาดรูปไม่ได้" };
  if (width > LIMITS.imageEdge || height > LIMITS.imageEdge) return { code: "TOO_MANY_PIXELS", message: "รูปกว้างหรือสูงเกิน 8192 px กรุณาย่อรูปก่อนแทรก" };
  if (width * height > LIMITS.imagePixels) return { code: "TOO_MANY_PIXELS", message: "รูปมีจำนวนพิกเซลเกิน 16.7 ล้าน กรุณาย่อรูปก่อนแทรก" };
  return null;
}

/**
 * Initial world size: fit within 60% of the visible viewport (in world units) while never
 * enlarging past natural pixels; aspect ratio is preserved.
 */
export function initialImageSize(natural: { width: number; height: number }, viewportWorld: { width: number; height: number }) {
  const scale = Math.min(1, (viewportWorld.width * 0.6) / natural.width, (viewportWorld.height * 0.6) / natural.height);
  return { width: Math.max(1, natural.width * scale), height: Math.max(1, natural.height * scale) };
}

/**
 * Reads pixel dimensions from the file header WITHOUT decoding, so a small file that declares a
 * gigantic canvas is rejected before the browser allocates it. Returns null when the header is
 * unreadable (decode then decides).
 */
export function readImageDimensions(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => offset + 4 <= bytes.length ? view.getUint32(offset) : null;
  if (mime === "image/png") {
    // IHDR is the first chunk: length(4) "IHDR"(4) width(4) height(4) at offset 16.
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
    return { width: u32(16)!, height: u32(20)! };
  }
  if (mime === "image/webp") {
    if (bytes.length < 30) return null;
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const b = (i: number) => bytes[21 + i];
      return { width: 1 + (b(0) | ((b(1) & 0x3f) << 8)), height: 1 + ((b(1) >> 6) | (b(2) << 2) | ((b(3) & 0x0f) << 10)) };
    }
    if (chunk === "VP8 ") return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    return null;
  }
  // JPEG: walk markers until a Start Of Frame (SOF0–SOF15 except DHT/JPG/DAC).
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = view.getUint16(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}
