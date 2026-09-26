"use client";

import { useEffect, useState } from "react";
import { importLegacyPrototypeDrafts } from "@/services/persistence/local-db";
import { createLocalProjectService, type ProjectService } from "@/services/projects/local-project-service";

import { supabaseConfigured } from "@/lib/supabase/config";

/** Public Supabase config is inlined at build time; a secret key in NEXT_PUBLIC_* is refused. */
export const cloudConfigured = supabaseConfigured;
/**
 * The local development adapter (fixture identity + IndexedDB only) exists only in `next dev`
 * without Supabase config. Production never falls back to a fixture owner (M4.2 guard).
 */
export const localDevMode = !cloudConfigured && process.env.NODE_ENV === "development";
export const LOCAL_FIXTURE_OWNER_ID = "00000000-0000-4000-8000-00000000de01";

export type Runtime =
  | { status: "loading" }
  | {
    status: "ready"; service: ProjectService; email: string | null; signOut: (() => Promise<void>) | null;
    /**
     * Cloud only: `listener(null)` when this browser signs out, `listener(id)` when another account signs in
     * (also from another tab). Returns unsubscribe.
     */
    onAccountChange?: (listener: (ownerId: string | null) => void) => () => void;
  }
  | { status: "signed-out" }
  | { status: "disabled"; message: string }
  | { status: "error"; message: string };

let localRuntime: Promise<Runtime> | null = null;
async function resolveLocalRuntime(): Promise<Runtime> {
  await importLegacyPrototypeDrafts(LOCAL_FIXTURE_OWNER_ID).catch(() => 0);
  return { status: "ready", service: createLocalProjectService(LOCAL_FIXTURE_OWNER_ID), email: null, signOut: null };
}

export async function resolveRuntime(): Promise<Runtime> {
  if (cloudConfigured) {
    const { resolveCloudRuntime } = await import("./cloud-runtime");
    return resolveCloudRuntime();
  }
  if (localDevMode) {
    localRuntime ??= resolveLocalRuntime();
    return localRuntime;
  }
  return { status: "disabled", message: "ยังไม่ได้ตั้งค่า Supabase สำหรับ environment นี้ จึงยังไม่เปิดให้เก็บบทเรียน (ดูขั้นตอน M4/M7 ใน docs)" };
}

/** Resolves once per mount; the editor keeps the first identity so an expired session never unmounts it. */
export function useRuntime(): Runtime {
  const [runtime, setRuntime] = useState<Runtime>({ status: "loading" });
  useEffect(() => {
    let active = true;
    resolveRuntime()
      .then((value) => { if (active) setRuntime(value); })
      .catch((error: unknown) => { if (active) setRuntime({ status: "error", message: error instanceof Error ? error.message : "เริ่มระบบไม่สำเร็จ" }); });
    return () => { active = false; };
  }, []);
  return runtime;
}
