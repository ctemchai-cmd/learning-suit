"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

export type ImageEntry =
  | { status: "loading" }
  | { status: "ready"; image: HTMLImageElement }
  | { status: "missing" }
  | { status: "error"; message: string };

export type BlobResolver = (assetId: string) => Promise<Blob | null>;

/**
 * Decodes asset blobs into HTMLImageElements for Konva. Object URLs are revoked when the cache
 * is disposed. Binary bytes never enter the document.
 */
export class ImageCache {
  private entries = new Map<string, ImageEntry>();
  private urls = new Map<string, string>();
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private resolve: BlobResolver) {}

  get(assetId: string): ImageEntry {
    const existing = this.entries.get(assetId);
    if (existing) return existing;
    const loading: ImageEntry = { status: "loading" };
    this.entries.set(assetId, loading);
    void this.load(assetId);
    return loading;
  }

  /** Resolves when the asset is decoded (or fails); used by export to wait for every image. */
  async ensure(assetId: string): Promise<ImageEntry> {
    // A transient failure (offline download, decode hiccup) must not poison later exports.
    const previous = this.entries.get(assetId);
    if (previous && (previous.status === "missing" || previous.status === "error")) this.entries.delete(assetId);
    const current = this.get(assetId);
    if (current.status !== "loading") return current;
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        const entry = this.entries.get(assetId);
        if (entry && entry.status !== "loading") { unsubscribe(); resolve(entry); }
      });
    });
  }

  /** Seeds a freshly ingested image so it renders without a round trip to IndexedDB. */
  seed(assetId: string, blob: Blob): void {
    this.entries.delete(assetId);
    void this.load(assetId, blob);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private refs = 0;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reference counting tolerates React StrictMode's mount → cleanup → mount replay. */
  retain(): void {
    this.refs++;
    if (this.disposeTimer) { clearTimeout(this.disposeTimer); this.disposeTimer = null; }
  }
  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0 && !this.disposeTimer) this.disposeTimer = setTimeout(() => { this.disposeTimer = null; if (this.refs === 0) this.dispose(); }, 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.entries.clear();
    this.listeners.clear();
  }

  private emit() { for (const listener of [...this.listeners]) listener(); }

  private async load(assetId: string, provided?: Blob) {
    let entry: ImageEntry;
    try {
      const blob = provided ?? await this.resolve(assetId);
      if (!blob) entry = { status: "missing" };
      else {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        if (this.disposed) { URL.revokeObjectURL(url); return; }
        const previous = this.urls.get(assetId);
        if (previous) URL.revokeObjectURL(previous);
        this.urls.set(assetId, url);
        entry = { status: "ready", image };
      }
    } catch (error) {
      entry = { status: "error", message: error instanceof Error ? error.message : "โหลดรูปไม่สำเร็จ" };
    }
    if (this.disposed) return;
    this.entries.set(assetId, entry);
    this.emit();
  }
}

export const ImageCacheContext = createContext<ImageCache | null>(null);

export function useAssetImage(assetId: string): ImageEntry {
  const cache = useContext(ImageCacheContext);
  return useSyncExternalStore(
    (listener) => cache?.subscribe(listener) ?? (() => undefined),
    () => cache?.get(assetId) ?? MISSING,
    () => LOADING,
  );
}
const MISSING: ImageEntry = { status: "missing" };
const LOADING: ImageEntry = { status: "loading" };
