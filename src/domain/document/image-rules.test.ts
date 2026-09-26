import { describe, expect, it } from "vitest";
import { checkImageBytes, checkImageDimensions, initialImageSize, readImageDimensions, sniffImageMime } from "./image-rules";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const gif = new TextEncoder().encode("GIF89a......");
const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");

describe("image ingest rules (IMG-02)", () => {
  it("sniffs PNG, JPEG and WebP from magic bytes and rejects other formats", () => {
    expect(sniffImageMime(png)).toBe("image/png");
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    expect(sniffImageMime(webp)).toBe("image/webp");
    expect(sniffImageMime(gif)).toBeNull();
    expect(sniffImageMime(svg)).toBeNull();
    expect(checkImageBytes(100, "image/svg+xml", null)?.code).toBe("UNSUPPORTED_TYPE");
  });
  it("does not trust a renamed file extension or declared MIME", () => {
    expect(checkImageBytes(100, "image/png", sniffImageMime(gif))?.code).toBe("UNSUPPORTED_TYPE");
    expect(checkImageBytes(100, "application/octet-stream", sniffImageMime(png))).toBeNull();
  });
  it("rejects oversize files and pixel counts before insert", () => {
    expect(checkImageBytes(10 * 1024 * 1024, "image/png", "image/png")).toBeNull();
    expect(checkImageBytes(10 * 1024 * 1024 + 1, "image/png", "image/png")?.code).toBe("TOO_LARGE");
    expect(checkImageDimensions(8192, 2048)).toBeNull();
    expect(checkImageDimensions(8193, 10)?.code).toBe("TOO_MANY_PIXELS");
    expect(checkImageDimensions(4097, 4096)?.code).toBe("TOO_MANY_PIXELS");
    expect(checkImageDimensions(0, 10)?.code).toBe("DECODE_FAILED");
  });
  it("fits 60% of the viewport, keeps aspect and never enlarges past natural size (IMG-01)", () => {
    expect(initialImageSize({ width: 400, height: 200 }, { width: 2000, height: 1000 })).toEqual({ width: 400, height: 200 });
    const fitted = initialImageSize({ width: 4000, height: 2000 }, { width: 1000, height: 800 });
    expect(fitted.width).toBeCloseTo(600);
    expect(fitted.height).toBeCloseTo(300);
    expect(fitted.width / fitted.height).toBeCloseTo(2);
  });
});

describe("header dimensions before decode (decompression-bomb guard)", () => {
  it("reads PNG IHDR, JPEG SOF0 and WebP VP8X/VP8L sizes", () => {
    const pngHeader = new Uint8Array(24);
    pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(pngHeader.buffer).setUint32(16, 30000);
    new DataView(pngHeader.buffer).setUint32(20, 30000);
    expect(readImageDimensions(pngHeader, "image/png")).toEqual({ width: 30000, height: 30000 });
    expect(checkImageDimensions(30000, 30000)?.code).toBe("TOO_MANY_PIXELS");

    const jpegHeader = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03]);
    expect(readImageDimensions(jpegHeader, "image/jpeg")).toEqual({ width: 600, height: 300 });

    const vp8x = new Uint8Array(30);
    vp8x.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    vp8x.set([(640 - 1) & 0xff, ((640 - 1) >> 8) & 0xff, 0, (480 - 1) & 0xff, ((480 - 1) >> 8) & 0xff, 0], 24);
    expect(readImageDimensions(vp8x, "image/webp")).toEqual({ width: 640, height: 480 });
  });
  it("returns null for truncated headers", () => {
    expect(readImageDimensions(Uint8Array.from([0x89, 0x50]), "image/png")).toBeNull();
    expect(readImageDimensions(Uint8Array.from([0xff, 0xd8]), "image/jpeg")).toBeNull();
  });
});
