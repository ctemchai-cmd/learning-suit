"use client";

// Images from the system clipboard (⌘V / right-click → วาง): screenshots, "Copy image" from a browser, image files
// copied in Finder/Explorer. Some sources only put a link to the picture on the clipboard (an <img> in HTML or an
// image URL as text): it is downloaded when the site allows it. Formats the board does not store (TIFF from macOS
// Preview, GIF, BMP, HEIC, AVIF, SVG…) are converted to PNG when the browser can decode them.

const STORED = new Set(["image/png", "image/jpeg", "image/webp"]);
/** Text written to the system clipboard by the in-app ⌘C, so a later ⌘V knows the objects are the newest copy. */
export const OBJECTS_MARKER_PREFIX = "[Learning Suit] ";

export type ClipboardImages = {
  images: Blob[];
  /** Only a link to a picture was found and it could not be downloaded. */
  linkOnly: boolean;
  /** The clipboard holds the in-app objects marker (the user copied board objects last). */
  objects: boolean;
};

const IMAGE_URL = /^(https?:\/\/\S+\.(?:png|jpe?g|webp|gif|bmp|avif|svg)(?:\?\S*)?|data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]+)$/i;

/** Image sources named in copied HTML (first few <img src>). */
export function imageSourcesInHtml(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("img[src]")].map((img) => img.getAttribute("src") ?? "").filter((src) => /^(https?:|data:image\/)/i.test(src)).slice(0, 10);
}

/** A text that is just one image address (or data URL). */
export function imageUrlInText(text: string): string | null {
  const trimmed = text.trim();
  return IMAGE_URL.test(trimmed) ? trimmed : null;
}

async function download(src: string): Promise<Blob | null> {
  try {
    const response = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith("image/") || src.startsWith("data:image/") ? blob : null;
  } catch {
    return null; // blocked by the site (CORS) or offline
  }
}

/** PNG/JPEG/WebP as they are; anything else the browser can decode becomes PNG; otherwise unchanged (ingest explains). */
export async function toStoredImage(blob: Blob): Promise<Blob> {
  if (STORED.has(blob.type)) return blob;
  try {
    let source: CanvasImageSource & { width: number; height: number };
    if (blob.type === "image/svg+xml") {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        source = img;
      } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    } else source = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, source.width);
    canvas.height = Math.max(1, source.height);
    canvas.getContext("2d")!.drawImage(source, 0, 0);
    if ("close" in source && typeof source.close === "function") source.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return png ?? blob;
  } catch {
    return blob;
  }
}

async function fromLinks(sources: string[]): Promise<{ images: Blob[]; linkOnly: boolean }> {
  if (!sources.length) return { images: [], linkOnly: false };
  const images = (await Promise.all(sources.map(download))).filter((blob): blob is Blob => Boolean(blob));
  return { images, linkOnly: !images.length };
}

/** Images in a paste event's clipboard data. */
export async function imagesFromPaste(data: DataTransfer | null): Promise<ClipboardImages> {
  if (!data) return { images: [], linkOnly: false, objects: false };
  const text = data.getData("text/plain");
  if (text.startsWith(OBJECTS_MARKER_PREFIX)) return { images: [], linkOnly: false, objects: true };
  // Files first (screenshots, "Copy image", files from Finder); some browsers only expose them as items.
  let files = [...data.files].filter((file) => file.type.startsWith("image/"));
  if (!files.length) files = [...data.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
  if (files.length) return { images: await Promise.all(files.map(toStoredImage)), linkOnly: false, objects: false };
  const html = data.getData("text/html");
  const sources = html ? imageSourcesInHtml(html) : [];
  const url = imageUrlInText(text);
  const linked = await fromLinks(sources.length ? sources : url ? [url] : []);
  return { images: await Promise.all(linked.images.map(toStoredImage)), linkOnly: linked.linkOnly, objects: false };
}

/** Images on the system clipboard read on demand (right-click → วาง). Null when the browser does not allow it. */
export async function readClipboardImages(): Promise<ClipboardImages | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return null;
  let items: ClipboardItems;
  try { items = await navigator.clipboard.read(); } catch { return null; }
  const images: Blob[] = [];
  let html = "", text = "";
  for (const item of items) {
    const type = item.types.find((entry) => entry.startsWith("image/"));
    if (type) { images.push(await item.getType(type)); continue; }
    if (item.types.includes("text/html")) html += await (await item.getType("text/html")).text();
    if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text();
  }
  if (text.startsWith(OBJECTS_MARKER_PREFIX)) return { images: [], linkOnly: false, objects: true };
  if (images.length) return { images: await Promise.all(images.map(toStoredImage)), linkOnly: false, objects: false };
  const sources = html ? imageSourcesInHtml(html) : [];
  const url = imageUrlInText(text);
  const linked = await fromLinks(sources.length ? sources : url ? [url] : []);
  return { images: await Promise.all(linked.images.map(toStoredImage)), linkOnly: linked.linkOnly, objects: false };
}

/** Marks the system clipboard after an in-app copy (best effort; never throws). */
export function markObjectsCopied(count: number) {
  try { void navigator.clipboard?.writeText?.(`${OBJECTS_MARKER_PREFIX}${count} วัตถุ`).catch(() => undefined); } catch { /* not allowed here */ }
}

export const LINK_ONLY_NOTICE = "วางรูปไม่ได้: สิ่งที่คัดลอกมาเป็นลิงก์ของรูปและเว็บนั้นไม่อนุญาตให้ดึงรูป ลองคลิกขวาที่รูป → “คัดลอกรูปภาพ” หรือแคปหน้าจอแล้ววางอีกครั้ง";
