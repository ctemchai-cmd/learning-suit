"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { registerServiceWorker, warmOfflineCache } from "./pwa";

/** Mounted once in the root layout: registers the service worker and warms its cache on every page change. */
export default function PwaRegistrar() {
  const pathname = usePathname();
  useEffect(() => { void registerServiceWorker().catch(() => undefined); }, []);
  // Client-side navigations never load the page itself, so the worker is told about each one.
  // Deferred: on a first visit the worker refetches the page (server + sign-in check), which must not compete
  // with the lesson that is opening right now.
  useEffect(() => {
    let idle: number | null = null;
    const warm = () => void warmOfflineCache().catch(() => undefined);
    const timer = window.setTimeout(() => {
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(warm, { timeout: 5000 });
      else warm();
    }, 3000);
    return () => { window.clearTimeout(timer); if (idle !== null && typeof cancelIdleCallback === "function") cancelIdleCallback(idle); };
  }, [pathname]);
  return null;
}
