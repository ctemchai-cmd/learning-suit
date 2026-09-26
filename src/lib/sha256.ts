/**
 * Lowercase hex SHA-256 of bytes via Web Crypto (`crypto.subtle`).
 * Works in browsers, Web Workers and Node 20+ (global `crypto`).
 */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await toDigestInput(data));
  return toHex(new Uint8Array(digest));
}

async function toDigestInput(data: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer | Uint8Array<ArrayBuffer>> {
  if (data instanceof Uint8Array) {
    // SubtleCrypto rejects views over SharedArrayBuffer; copy only in that case.
    return data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) return data;
  return data.arrayBuffer();
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX[byte];
  return out;
}
