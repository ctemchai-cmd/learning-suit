import { describe, expect, it } from "vitest";
import type { ProjectContent, ProjectRecord, TextNode } from "../../domain/document/model";
import type { DeletionJob, LocalDraft, PendingEdit, SaveJob } from "../../domain/document/session";
import { decideOnOpen, isDraftDirty, type CloudLoadResult, type OpenInput } from "./reconcile";

const OWNER = "owner-1";
const PROJECT = "project-1";

const content = (title: string): ProjectContent => ({
  title,
  document: { schemaVersion: 1, slides: [{ id: "slide-1", name: "สไลด์ 1", background: "#FFFFFF", nodes: [] }], assets: {} },
});

const text: TextNode = {
  id: "text-1", type: "text", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, text: "สวัสดี", width: 200,
  fontFamily: "Noto Sans Thai", fontSize: 24, lineHeight: 1.4, color: "#111827", align: "left",
};
const pendingEdit: PendingEdit = { kind: "text", slideId: "slide-1", nodeId: "text-1", before: text, draft: { ...text, text: "สวัสดีครับ" } };

function draft(overrides: Partial<LocalDraft> = {}): LocalDraft {
  return {
    localVersion: 1, ownerId: OWNER, projectId: PROJECT, content: content("local"), baseRevision: 5,
    localSequence: 10, acknowledgedSequence: 10, pendingEdit: null,
    // Deliberately newer than the cloud: timestamps must never influence the decision.
    savedAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function record(revision: number, updatedAt = "2000-01-01T00:00:00.000Z"): ProjectRecord {
  return {
    ...content("cloud"), id: PROJECT, ownerId: OWNER, revision, lastMutationId: "m", createdAt: updatedAt, updatedAt, deletedAt: null,
  };
}

const job: SaveJob = {
  ownerId: OWNER, projectId: PROJECT, mutationId: "job-1", expectedRevision: 5, localSequence: 9, content: content("job"), createdAt: "2026-09-25T00:00:00.000Z",
};

const deletion: DeletionJob = {
  ownerId: OWNER, projectId: PROJECT, mutationId: "del-1", expectedRevision: 5, phase: "tombstoned", title: "local", createdAt: "2026-09-25T00:00:00.000Z",
};

function input(overrides: Partial<OpenInput> = {}): OpenInput {
  return { ownerId: OWNER, projectId: PROJECT, localDraft: draft(), persistedJob: null, deletionJob: null, cloud: { status: "ok", record: record(5) }, ...overrides };
}

describe("isDraftDirty", () => {
  it("is dirty for unacknowledged sequences or a pending edit", () => {
    expect(isDraftDirty(draft())).toBe(false);
    expect(isDraftDirty(draft({ localSequence: 11 }))).toBe(true);
    expect(isDraftDirty(draft({ pendingEdit }))).toBe(true);
  });
});

describe("decideOnOpen (PST-11)", () => {
  it("resumes a pending deletion before anything else", () => {
    expect(decideOnOpen(input({ deletionJob: deletion, persistedJob: job }))).toEqual({ kind: "resume-deletion", deletionJob: deletion });
  });

  it("rule 2: resolves a durable save job before loading cloud over local", () => {
    const local = draft({ localSequence: 11, acknowledgedSequence: 8 });
    for (const cloud of [{ status: "not-loaded" }, { status: "ok", record: record(9) }, { status: "error" }] as CloudLoadResult[]) {
      expect(decideOnOpen(input({ persistedJob: job, localDraft: local, cloud }))).toEqual({ kind: "resume-job-first", job, local });
    }
    expect(decideOnOpen(input({ persistedJob: job, localDraft: null }))).toEqual({ kind: "resume-job-first", job, local: null });
  });

  it("rule 3: never-published drafts stay local and go through reserve/resume regardless of the cloud", () => {
    const local = draft({ baseRevision: null, localSequence: 0, acknowledgedSequence: 0 });
    for (const cloud of [{ status: "not-loaded" }, { status: "missing" }, { status: "error" }, { status: "ok", record: record(0) }] as CloudLoadResult[]) {
      expect(decideOnOpen(input({ localDraft: local, cloud }))).toEqual({ kind: "use-local-unpublished", local });
    }
  });

  it("asks for the cloud row only when the decision needs it", () => {
    expect(decideOnOpen(input({ cloud: { status: "not-loaded" } }))).toEqual({ kind: "load-cloud" });
    expect(decideOnOpen(input({ localDraft: null, cloud: { status: "not-loaded" } }))).toEqual({ kind: "load-cloud" });
  });

  it("rule 4: a clean draft uses the latest cloud document", () => {
    const cloudRecord = record(7);
    expect(decideOnOpen(input({ cloud: { status: "ok", record: cloudRecord } }))).toEqual({ kind: "use-cloud", record: cloudRecord });
    // Even when the local draft's timestamp is newer.
    expect(decideOnOpen(input({ localDraft: draft({ savedAt: "2099-01-01T00:00:00.000Z" }), cloud: { status: "ok", record: record(5) } })).kind).toBe("use-cloud");
  });

  it("rule 5: dirty and on the same revision → keep local and sync (after the pending edit flushes)", () => {
    const dirty = draft({ localSequence: 12 });
    const cloudRecord = record(5);
    expect(decideOnOpen(input({ localDraft: dirty, cloud: { status: "ok", record: cloudRecord } }))).toEqual({
      kind: "use-local-then-sync", local: dirty, record: cloudRecord, waitForPendingEdit: false,
    });
    const editing = draft({ pendingEdit });
    expect(decideOnOpen(input({ localDraft: editing, cloud: { status: "ok", record: cloudRecord } }))).toEqual({
      kind: "use-local-then-sync", local: editing, record: cloudRecord, waitForPendingEdit: true,
    });
  });

  it("rule 6: dirty with a different cloud revision is a conflict, never a timestamp guess", () => {
    const dirty = draft({ localSequence: 12, savedAt: "2099-01-01T00:00:00.000Z" });
    const newer = record(6, "1999-01-01T00:00:00.000Z");
    expect(decideOnOpen(input({ localDraft: dirty, cloud: { status: "ok", record: newer } }))).toEqual({
      kind: "conflict", local: dirty, record: newer, currentRevision: 6,
    });
    const editing = draft({ pendingEdit });
    expect(decideOnOpen(input({ localDraft: editing, cloud: { status: "ok", record: record(4) } }))).toMatchObject({
      kind: "conflict", local: { pendingEdit },
    });
  });

  it("rule 7: cloud failure uses local offline, or asks to retry when there is no local draft", () => {
    const local = draft({ localSequence: 12 });
    expect(decideOnOpen(input({ localDraft: local, cloud: { status: "error" } }))).toEqual({ kind: "offline-local", local });
    expect(decideOnOpen(input({ localDraft: draft(), cloud: { status: "error" } })).kind).toBe("offline-local");
    expect(decideOnOpen(input({ localDraft: null, cloud: { status: "error" } }))).toEqual({ kind: "retry-needed" });
  });

  it("rule 8: unsupported cloud schema keeps local and pauses cloud writes", () => {
    const local = draft({ localSequence: 12 });
    expect(decideOnOpen(input({ localDraft: local, cloud: { status: "unsupported-schema", schemaVersion: 2 } }))).toEqual({
      kind: "schema-paused", local, schemaVersion: 2,
    });
    expect(decideOnOpen(input({ localDraft: null, cloud: { status: "unsupported-schema", schemaVersion: 2 } }))).toEqual({
      kind: "schema-paused", local: null, schemaVersion: 2,
    });
  });

  it("a published project missing from the cloud is unavailable (offer a copy, never recreate the id)", () => {
    const local = draft({ localSequence: 12 });
    expect(decideOnOpen(input({ localDraft: local, cloud: { status: "missing" } }))).toEqual({ kind: "unavailable", local });
    expect(decideOnOpen(input({ localDraft: null, cloud: { status: "missing" } }))).toEqual({ kind: "unavailable", local: null });
  });

  it("no local draft uses the cloud document", () => {
    const cloudRecord = record(3);
    expect(decideOnOpen(input({ localDraft: null, cloud: { status: "ok", record: cloudRecord } }))).toEqual({ kind: "use-cloud", record: cloudRecord });
  });

  it("ignores drafts, jobs and deletions that belong to another owner or project (PST-08)", () => {
    const foreignDraft = draft({ ownerId: "owner-2", localSequence: 99 });
    const foreignJob = { ...job, ownerId: "owner-2" };
    const foreignDeletion = { ...deletion, projectId: "project-2" };
    const cloudRecord = record(5);
    expect(decideOnOpen(input({
      localDraft: foreignDraft, persistedJob: foreignJob, deletionJob: foreignDeletion, cloud: { status: "ok", record: cloudRecord },
    }))).toEqual({ kind: "use-cloud", record: cloudRecord });
  });
});
