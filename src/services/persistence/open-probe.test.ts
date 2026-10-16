import { describe, expect, it, vi } from "vitest";
import type { ProjectContent, ProjectRecord } from "../../domain/document/model";
import type { LocalDraft, SaveJob } from "../../domain/document/session";
import type { CloudProjectLifecycle, ProjectRepository } from "./repository";
import { decideOnOpen, type CloudLoadResult } from "./reconcile";
import { LIFECYCLE_PROBE_TIMEOUT_MS, probeCloudForOpen } from "./open-probe";
import { CloudRepositoryError } from "./supabase-repository";

const OWNER = "owner-1";
const PROJECT = "project-1";
const content: ProjectContent = { title: "t", document: { schemaVersion: 1, slides: [{ id: "s", name: "n", background: "#FFFFFF", nodes: [] }], assets: {} } };
const draft = (overrides: Partial<LocalDraft> = {}): LocalDraft => ({
  localVersion: 1, ownerId: OWNER, projectId: PROJECT, content, baseRevision: 5, localSequence: 3, acknowledgedSequence: 3, pendingEdit: null, savedAt: "2030-01-01T00:00:00.000Z", ...overrides,
});
const record = (revision: number): ProjectRecord => ({ ...content, id: PROJECT, ownerId: OWNER, revision, lastMutationId: "m", createdAt: "x", updatedAt: "x", deletedAt: null });
const lifecycle = (overrides: Partial<CloudProjectLifecycle> = {}): CloudProjectLifecycle => ({ revision: 5, isReady: true, deletedAt: null, lastMutationId: "m", ...overrides });
const job: SaveJob = { ownerId: OWNER, projectId: PROJECT, mutationId: "j", expectedRevision: 5, localSequence: 4, content, createdAt: "x" };

function repo(opts: { lifecycle?: CloudProjectLifecycle | null | Error; load?: ProjectRecord | null | Error }) {
  const inspectLifecycle = vi.fn<ProjectRepository["inspectLifecycle"]>(async () => {
    if (opts.lifecycle instanceof Error) throw opts.lifecycle;
    return opts.lifecycle === undefined ? lifecycle() : opts.lifecycle;
  });
  const load = vi.fn<ProjectRepository["load"]>(async () => {
    if (opts.load instanceof Error) throw opts.load;
    return opts.load === undefined ? record(5) : opts.load;
  });
  return { inspectLifecycle, load } satisfies Pick<ProjectRepository, "inspectLifecycle" | "load">;
}

/** Same loop the cloud project service runs: decide → fetch what is asked → decide again. */
async function resolve(r: ReturnType<typeof repo>, local: LocalDraft | null, persistedJob: SaveJob | null = null) {
  let cloud: CloudLoadResult = { status: "not-loaded" };
  let decision = decideOnOpen({ ownerId: OWNER, projectId: PROJECT, localDraft: local, persistedJob, cloud });
  for (let i = 0; i < 4 && decision.kind === "load-cloud"; i++) {
    cloud = await probeCloudForOpen(r, { projectId: PROJECT, localDraft: local, persistedJob, forceFull: cloud.status === "unchanged" });
    decision = decideOnOpen({ ownerId: OWNER, projectId: PROJECT, localDraft: local, persistedJob, cloud });
  }
  return decision;
}

describe("probeCloudForOpen", () => {
  it("clean draft + same revision: one small lifecycle read, no document download, opens the local draft", async () => {
    const r = repo({});
    const local = draft();
    expect(await resolve(r, local)).toEqual({ kind: "use-local-clean", local });
    expect(r.load).not.toHaveBeenCalled();
    expect(r.inspectLifecycle).toHaveBeenCalledTimes(1);
    expect(r.inspectLifecycle).toHaveBeenCalledWith(PROJECT, { timeoutMs: LIFECYCLE_PROBE_TIMEOUT_MS });
    expect(LIFECYCLE_PROBE_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it("revision moved on: downloads the document and uses the cloud version, as before", async () => {
    const r = repo({ lifecycle: lifecycle({ revision: 7 }), load: record(7) });
    expect(await resolve(r, draft())).toEqual({ kind: "use-cloud", record: record(7) });
    expect(r.load).toHaveBeenCalledTimes(1);
  });

  it("dirty draft: skips the metadata shortcut and decides on the full document (no behaviour change)", async () => {
    for (const dirty of [draft({ localSequence: 4 }), draft({ pendingEdit: { kind: "text", slideId: "s", nodeId: "n" } as never })]) {
      const same = repo({ load: record(5) });
      expect((await resolve(same, dirty)).kind).toBe("use-local-then-sync");
      expect(same.inspectLifecycle).not.toHaveBeenCalled();
      expect(same.load).toHaveBeenCalledTimes(1);
      const moved = repo({ load: record(8) });
      expect((await resolve(moved, dirty)).kind).toBe("conflict");
      expect(moved.inspectLifecycle).not.toHaveBeenCalled();
    }
  });

  it("a pending save job or a missing base revision never takes the shortcut", async () => {
    const a = repo({});
    expect(await probeCloudForOpen(a, { projectId: PROJECT, localDraft: draft(), persistedJob: job })).toEqual({ status: "ok", record: record(5) });
    expect(a.inspectLifecycle).not.toHaveBeenCalled();
    expect(a.load).toHaveBeenCalledTimes(1);
    const b = repo({});
    await probeCloudForOpen(b, { projectId: PROJECT, localDraft: draft({ baseRevision: null }), persistedJob: null });
    expect(b.inspectLifecycle).not.toHaveBeenCalled();
    expect(b.load).toHaveBeenCalledTimes(1);
    const c = repo({});
    await probeCloudForOpen(c, { projectId: PROJECT, localDraft: null, persistedJob: null });
    expect(c.inspectLifecycle).not.toHaveBeenCalled();
    expect(c.load).toHaveBeenCalledTimes(1);
  });

  it("forceFull skips the metadata check and downloads the document", async () => {
    const r = repo({});
    expect(await probeCloudForOpen(r, { projectId: PROJECT, localDraft: draft(), persistedJob: null, forceFull: true })).toEqual({ status: "ok", record: record(5) });
    expect(r.inspectLifecycle).not.toHaveBeenCalled();
    expect(r.load).toHaveBeenCalledTimes(1);
  });

  it("deleted, not-ready or invisible rows are unavailable without downloading anything", async () => {
    for (const lc of [lifecycle({ deletedAt: "2026-01-01" }), lifecycle({ isReady: false }), null]) {
      const r = repo({ lifecycle: lc });
      const local = draft();
      expect(await resolve(r, local)).toEqual({ kind: "unavailable", local });
      expect(r.load).not.toHaveBeenCalled();
    }
  });

  it("offline / timeout: opens the local copy as offline-local after the small request only (no second 30 s wait)", async () => {
    const r = repo({ lifecycle: new CloudRepositoryError("down", { code: "network", retryable: true }) });
    const local = draft();
    expect(await resolve(r, local)).toEqual({ kind: "offline-local", local });
    expect(r.load).not.toHaveBeenCalled();
  });

  it("full load failures keep their meaning: schema newer than the app pauses, other errors are offline", async () => {
    const schema = new CloudRepositoryError("x", { code: "validation", retryable: false }, { reason: "schema_unsupported" });
    const local = draft({ localSequence: 9 });
    expect((await resolve(repo({ load: schema }), local)).kind).toBe("schema-paused");
    expect((await resolve(repo({ load: new Error("boom") }), local)).kind).toBe("offline-local");
  });
});
