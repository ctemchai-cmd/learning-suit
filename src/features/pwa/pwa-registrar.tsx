"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { registerServiceWorker, warmOfflineCache } from "./pwa";

/** Mounted once in the root layout: registers the service worker and warms its cache on every page change. */
export default function PwaRegistrar() {
  const pathname = usePathname();
  useEffect(() => { void registerServiceWorker().catch(() => undefined); }, []);
  // Client-side navigations never load the page itself, so the worker is told about each one.
  useEffect(() => { void warmOfflineCache().catch(() => undefined); }, [pathname]);
  return null;
}
