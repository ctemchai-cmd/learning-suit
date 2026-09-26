"use client";

import { useSyncExternalStore } from "react";

// PWA client side: the install prompt (Chromium only; Safari installs from its Share menu) and the
// messages that let the service worker keep what this page loaded (public/sw.js).

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

// Registered when this module loads (before React hydrates), so an early prompt is not missed.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Whether the browser offers to install the app right now (false when already installed or unsupported). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, () => deferred !== null, () => false);
}

/** Shows the browser's install dialog; true when the teacher accepted. */
export async function installApp(): Promise<boolean> {
  const prompt = deferred;
  if (!prompt) return false;
  deferred = null;
  notify();
  await prompt.prompt();
  return (await prompt.userChoice).outcome === "accepted";
}

/**
 * Registers the service worker in production builds (in development any old one is removed so hot reload
 * is never served from a cache).
 */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
    return;
  }
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** Asks the service worker to keep this page and the app files it loaded, so it also opens offline. */
export async function warmOfflineCache(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !navigator.onLine) return;
  const registration = await navigator.serviceWorker.ready;
  const urls = performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.startsWith(`${location.origin}/_next/static/`));
  registration.active?.postMessage({ type: "warm", urls, page: location.href });
}
