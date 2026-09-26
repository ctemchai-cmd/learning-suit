"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetReference, ProjectContent } from "@/domain/document/model";
import { useRuntime } from "@/services/runtime";
import { exportArchiveInWorker } from "@/services/export/archive-client";
import { ArchiveError } from "@/services/export/archive-types";
import { getLocalAsset } from "@/services/persistence/local-db";
import type { ArchiveExporter } from "./export-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { LoginFields } from "@/features/auth/login-form";
import { useEditorStore } from "./store";

// Canvas, IndexedDB and export are browser-only: load the editor without SSR.
const Editor = dynamic(() => import("./editor"), { ssr: false, loading: () => <div className="p-8">กำลังเปิดกระดาน…</div> });

export default function EditorBoundary({ projectId }: { projectId: string }) {
  const runtime = useRuntime();
  const router = useRouter();
  // Latch the first identity: an expired session later must not unmount the editor (plan01).
  const [ready, setReady] = useState<Extract<typeof runtime, { status: "ready" }> | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (runtime.status === "ready" && !ready) setReady(runtime);
    if (runtime.status === "signed-out" && !ready) router.replace(`/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
  }, [runtime, ready, router, projectId]);

  // Another account signed in from another tab: stop syncing this owner's work (it stays in this browser
  // for the original account) and leave, like a sign-in with the wrong account in the dialog below.
  useEffect(() => ready?.onAccountChange?.((ownerId) => {
    if (ownerId === null || ownerId === ready.service.ownerId) return; // signed out: the dialog asks on the next save
    useEditorStore.getState().cloudAuthRestored(ownerId);
    router.replace("/projects");
  }), [ready, router]);

  const service = ready?.service;
  const exportArchive = useMemo<ArchiveExporter>(() => async (content: ProjectContent, options) => {
    if (!service) throw new Error("ยังไม่พร้อม");
    const getBlob = async (asset: AssetReference) =>
      await getLocalAsset(service.ownerId, projectId, asset.id).catch(() => null) ?? await service.resolveRemoteAsset?.(projectId, asset) ?? null;
    try {
      const result = await exportArchiveInWorker(content, getBlob, options);
      return { blob: result.blob, filename: result.filename };
    } catch (error) {
      throw error instanceof ArchiveError ? new Error(error.message) : error;
    }
  }, [service, projectId]);
  const resolveRemoteAsset = useMemo(() => service?.resolveRemoteAsset ? (asset: AssetReference) => service.resolveRemoteAsset!(projectId, asset) : undefined, [service, projectId]);
  const cloudUi = useMemo(() => service?.cloudUi?.(projectId, router), [service, projectId, router]);
  // Expired session: sign in inside a dialog so the editor (and its memory) is never unmounted (PST-08).
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  useEffect(() => {
    const open = () => { setLoginError(null); setLoginOpen(true); };
    window.addEventListener("learning-suit:login-required", open);
    return () => window.removeEventListener("learning-suit:login-required", open);
  }, []);

  if (runtime.status === "disabled" || runtime.status === "error") {
    return <main className="flex h-dvh items-center justify-center p-6"><div className="card max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">ยังเปิดกระดานไม่ได้</h1><p className="muted mt-2" role="alert">{runtime.message}</p>
      <Link href="/projects" className="app-button mt-5">กลับไปหน้าโปรเจกต์</Link></div></main>;
  }
  if (!ready || !service) return <div className="p-8">กำลังเปิดกระดาน…</div>;
  return <>
    <Editor ownerId={service.ownerId} projectId={projectId} opener={service.opener} resolveRemoteAsset={resolveRemoteAsset} exportArchive={exportArchive} cloudUi={cloudUi} />
    <Dialog.Root open={loginOpen} onOpenChange={setLoginOpen}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content">
        <Dialog.Title className="text-xl font-semibold">เข้าสู่ระบบอีกครั้งเพื่อบันทึกต่อ</Dialog.Title>
        <Dialog.Description className="muted mt-2 text-sm">งานยังอยู่ในเครื่องและหน้านี้จะไม่ถูกปิด ต้องเป็นบัญชีเดิมเท่านั้นจึงบันทึกต่อได้</Dialog.Description>
        <div className="mt-4"><LoginFields submitLabel="เข้าสู่ระบบและบันทึกต่อ" onSignedIn={(ownerId) => {
          if (ownerId === service.ownerId) {
            useEditorStore.getState().cloudAuthRestored(ownerId);
            setLoginOpen(false);
          } else {
            // Another account must never receive this owner's drafts or queue.
            useEditorStore.getState().cloudAuthRestored(ownerId);
            setLoginError("บัญชีนี้ไม่ใช่เจ้าของงาน งานของบัญชีเดิมยังเก็บในเครื่อง กลับไปเข้าสู่ระบบบัญชีเดิมเพื่อบันทึกต่อ");
            router.replace("/projects");
          }
        }} /></div>
        {loginError && <p role="alert" className="mt-3 text-sm text-red-700">{loginError}</p>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>;
}
