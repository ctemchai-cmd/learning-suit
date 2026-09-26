import { describe, expect, it } from "vitest";
import { fakeClient, VALID_DOCUMENT } from "./supabase-fakes.test-helpers";
import {
  acknowledgeOnly,
  classifyPostgrestFailure,
  classifyThrown,
  CloudRepositoryError,
  mapLifecycleRow,
  mapRecordRow,
  mapSummaryRow,
  parseReservationJson,
  parseSaveResultJson,
  PROJECT_SUMMARY_COLUMNS,
  SupabaseProjectRepository,
} from "./supabase-repository";

const PROJECT_ID = "a1111111-0000-4000-8000-000000000001";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MUTATION_ID = "e0000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-09-25T01:02:03.123456+00:00";

const recordRow = {
  id: PROJECT_ID,
  owner_id: OWNER_ID,
  title: "Git เบื้องต้น",
  document: VALID_DOCUMENT,
  revision: 3,
  last_mutation_id: MUTATION_ID,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  deleted_at: null,
};

describe("classifyPostgrestFailure", () => {
  it.each([
    [{ status: 0, code: "", message: "TypeError: Failed to fetch" }, "network", true],
    [{ status: 0, code: "", message: "AbortError: This operation was aborted" }, "network", true],
    [{ status: 503, code: "PGRST001", message: "Database client error" }, "network", true],
    [{ status: 504, code: "PGRST003", message: "Timed out acquiring connection" }, "network", true],
    [{ status: 408, code: "", message: "Request Timeout" }, "network", true],
    [{ status: 429, code: "", message: "Too Many Requests" }, "network", true],
    [{ status: 409, code: "40001", message: "could not serialize access" }, "network", true],
    [{ status: 500, code: "40P01", message: "deadlock detected" }, "network", true],
    [{ status: 500, code: "57014", message: "canceling statement due to statement timeout" }, "network", true],
    [{ status: 401, code: "PGRST301", message: "JWT expired" }, "auth", false],
    [{ status: 401, code: "PGRST303", message: "JWT claims validation failed" }, "auth", false],
    [{ status: 401, code: "42501", message: "permission denied for function save_project" }, "auth", false],
    [{ status: 403, code: "42501", message: "permission denied for table projects" }, "auth", false],
    [{ status: 413, code: "", message: "Payload Too Large" }, "quota", false],
    [{ status: 400, code: "54000", message: "total size of jsonb object elements exceeds the maximum" }, "quota", false],
    [{ status: 400, code: "22P02", message: "invalid input syntax for type uuid" }, "validation", false],
    [{ status: 409, code: "23505", message: "duplicate key value violates unique constraint" }, "validation", false],
    [{ status: 400, code: "23514", message: "new row violates check constraint" }, "validation", false],
    [{ status: 400, code: "P0001", message: "validation" }, "validation", false],
    [{ status: 400, code: "PGRST102", message: "Empty or invalid json" }, "validation", false],
    [{ status: 404, code: "PGRST202", message: "Could not find the function" }, "unknown", false],
    [{ status: 418, code: "XX999", message: "teapot" }, "unknown", false],
  ])("%j -> %s (retryable %s)", (failure, code, retryable) => {
    expect(classifyPostgrestFailure(failure)).toEqual({ code, retryable });
  });
});

describe("classifyThrown", () => {
  it("treats fetch TypeErrors and aborts as retryable network failures", () => {
    expect(classifyThrown(new TypeError("Failed to fetch"))).toEqual({ code: "network", retryable: true });
    expect(classifyThrown(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }))).toEqual({ code: "network", retryable: true });
    expect(classifyThrown(Object.assign(new Error("aborted"), { name: "AbortError" }))).toEqual({ code: "network", retryable: true });
  });
  it("recognises JWT failures and falls back to unknown", () => {
    expect(classifyThrown(new Error("JWT expired"))).toEqual({ code: "auth", retryable: false });
    expect(classifyThrown("boom")).toEqual({ code: "unknown", retryable: false });
  });
});

describe("parseSaveResultJson", () => {
  it("maps every documented RPC shape", () => {
    expect(parseSaveResultJson({ status: "saved", revision: 4, mutationId: MUTATION_ID, updatedAt: TIMESTAMP }))
      .toEqual({ status: "saved", revision: 4, mutationId: MUTATION_ID, updatedAt: TIMESTAMP });
    expect(parseSaveResultJson({ status: "conflict", currentRevision: 7 })).toEqual({ status: "conflict", currentRevision: 7 });
    expect(parseSaveResultJson({ status: "unavailable" })).toEqual({ status: "unavailable" });
    expect(parseSaveResultJson({ status: "error", code: "validation", retryable: false, reason: "asset_not_ready" }))
      .toEqual({ status: "error", code: "validation", retryable: false });
    expect(parseSaveResultJson({ status: "error", code: "quota", retryable: false, reason: "document_too_large" }))
      .toEqual({ status: "error", code: "quota", retryable: false });
  });
  it("never trusts malformed payloads", () => {
    const malformed = { status: "error", code: "unknown", retryable: false };
    expect(parseSaveResultJson(null)).toEqual(malformed);
    expect(parseSaveResultJson([])).toEqual(malformed);
    expect(parseSaveResultJson({ status: "saved", revision: "4", mutationId: MUTATION_ID, updatedAt: TIMESTAMP })).toEqual(malformed);
    expect(parseSaveResultJson({ status: "saved", revision: -1, mutationId: MUTATION_ID, updatedAt: TIMESTAMP })).toEqual(malformed);
    expect(parseSaveResultJson({ status: "conflict" })).toEqual(malformed);
    expect(parseSaveResultJson({ status: "error", code: "teapot" })).toEqual(malformed);
    expect(parseSaveResultJson({ status: "maybe" })).toEqual(malformed);
  });
  it("only acknowledges the mutation that was sent", () => {
    const saved = { status: "saved" as const, revision: 2, mutationId: MUTATION_ID, updatedAt: TIMESTAMP };
    expect(acknowledgeOnly(saved, MUTATION_ID.toUpperCase())).toEqual(saved);
    expect(acknowledgeOnly(saved, "e0000000-0000-4000-8000-000000000002")).toEqual({ status: "error", code: "unknown", retryable: false });
  });
});

describe("parseReservationJson", () => {
  it("maps reserved/unavailable/error", () => {
    expect(parseReservationJson({ status: "reserved", revision: 0 })).toEqual({ status: "reserved", revision: 0 });
    expect(parseReservationJson({ status: "unavailable" })).toEqual({ status: "unavailable" });
    expect(parseReservationJson({ status: "error", code: "validation", retryable: false, reason: "invalid_title" }))
      .toEqual({ status: "error", code: "validation", retryable: false });
    expect(parseReservationJson({ status: "reserved", revision: 1 })).toEqual({ status: "error", code: "unknown", retryable: false });
  });
  it("maps an existing camelCase record and validates its document", () => {
    const record = {
      id: PROJECT_ID, ownerId: OWNER_ID, title: "Lesson", document: VALID_DOCUMENT, revision: 0,
      lastMutationId: null, isReady: false, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, deletedAt: null,
    };
    expect(parseReservationJson({ status: "existing", record })).toEqual({
      status: "existing",
      record: {
        id: PROJECT_ID, ownerId: OWNER_ID, title: "Lesson", document: VALID_DOCUMENT, revision: 0,
        lastMutationId: null, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, deletedAt: null,
      },
    });
    const unsupported = { ...record, document: { ...VALID_DOCUMENT, schemaVersion: 2 } };
    expect(parseReservationJson({ status: "existing", record: unsupported })).toEqual({ status: "error", code: "validation", retryable: false });
  });
});

describe("row mapping", () => {
  it("maps snake_case rows to camelCase contracts", () => {
    expect(mapSummaryRow(recordRow)).toEqual({
      id: PROJECT_ID, ownerId: OWNER_ID, title: "Git เบื้องต้น", revision: 3, createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    });
    expect(mapRecordRow(recordRow)).toEqual({
      id: PROJECT_ID, ownerId: OWNER_ID, title: "Git เบื้องต้น", document: VALID_DOCUMENT, revision: 3,
      lastMutationId: MUTATION_ID, createdAt: TIMESTAMP, updatedAt: TIMESTAMP, deletedAt: null,
    });
    expect(mapLifecycleRow({ revision: 5, is_ready: false, deleted_at: TIMESTAMP, last_mutation_id: null }))
      .toEqual({ revision: 5, isReady: false, deletedAt: TIMESTAMP, lastMutationId: null });
  });
  it("rejects malformed rows and unsupported documents with typed errors", () => {
    expect(() => mapSummaryRow({ ...recordRow, revision: "3" })).toThrow(CloudRepositoryError);
    expect(() => mapLifecycleRow({ revision: 1, is_ready: "yes", deleted_at: null, last_mutation_id: null })).toThrow(CloudRepositoryError);
    try {
      mapRecordRow({ ...recordRow, document: { ...VALID_DOCUMENT, slides: [] } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRepositoryError);
      expect(error).toMatchObject({ code: "validation", retryable: false, reason: "schema_unsupported" });
    }
  });
});

describe("SupabaseProjectRepository", () => {
  it("list() reads only metadata of ready, live projects ordered by updated_at desc", async () => {
    const { client, calls } = fakeClient({ from: [{ data: [recordRow], error: null, status: 200 }] });
    const summaries = await new SupabaseProjectRepository(client).list();
    expect(summaries).toEqual([mapSummaryRow(recordRow)]);
    expect(calls[0]).toEqual({ method: "from", args: ["projects"] });
    const select = calls.find((call) => call.method === "select");
    expect(select?.args[0]).toBe(PROJECT_SUMMARY_COLUMNS);
    expect(String(select?.args[0])).not.toContain("document");
    expect(calls).toContainEqual({ method: "eq", args: ["is_ready", true] });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls).toContainEqual({ method: "order", args: ["updated_at", { ascending: false }] });
  });

  it("load() filters ready/not-deleted, maps the record and returns null for no row", async () => {
    const { client, calls } = fakeClient({
      from: [{ data: recordRow, error: null, status: 200 }, { data: null, error: null, status: 200 }],
    });
    const repository = new SupabaseProjectRepository(client);
    expect(await repository.load(PROJECT_ID)).toEqual(mapRecordRow(recordRow));
    expect(calls).toContainEqual({ method: "eq", args: ["id", PROJECT_ID] });
    expect(calls).toContainEqual({ method: "eq", args: ["is_ready", true] });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
    expect(calls).toContainEqual({ method: "maybeSingle", args: [] });
    expect(await repository.load(PROJECT_ID)).toBeNull();
  });

  it("reads throw classified errors instead of returning null", async () => {
    const { client } = fakeClient({
      from: [
        { data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 },
        { data: null, error: { code: "PGRST303", message: "JWT expired" }, status: 401 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    await expect(repository.inspectLifecycle(PROJECT_ID)).rejects.toMatchObject({ name: "CloudRepositoryError", code: "network", retryable: true });
    await expect(repository.list()).rejects.toMatchObject({ code: "auth", retryable: false });
  });

  it("inspectLifecycle() returns metadata for reservations/tombstones and null for no visible row", async () => {
    const { client, calls } = fakeClient({
      from: [
        { data: { revision: 0, is_ready: false, deleted_at: null, last_mutation_id: null }, error: null, status: 200 },
        { data: null, error: null, status: 200 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    expect(await repository.inspectLifecycle(PROJECT_ID)).toEqual({ revision: 0, isReady: false, deletedAt: null, lastMutationId: null });
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "is_ready")).toBe(false);
    expect(await repository.inspectLifecycle(PROJECT_ID)).toBeNull();
  });

  it("save() calls save_project with the full request and maps the result", async () => {
    const saved = { status: "saved", revision: 4, mutationId: MUTATION_ID, updatedAt: TIMESTAMP };
    const { client, calls } = fakeClient({ rpc: [{ data: saved, error: null, status: 200 }] });
    const result = await new SupabaseProjectRepository(client).save({
      projectId: PROJECT_ID, expectedRevision: 3, mutationId: MUTATION_ID,
      content: { title: "Lesson", document: structuredClone(VALID_DOCUMENT) as never },
    });
    expect(result).toEqual(saved);
    expect(calls[0]).toEqual({
      method: "rpc",
      args: ["save_project", {
        p_project_id: PROJECT_ID, p_expected_revision: 3, p_mutation_id: MUTATION_ID,
        p_title: "Lesson", p_document: VALID_DOCUMENT,
      }],
    });
    expect(calls.some((call) => call.method === "abortSignal")).toBe(true);
  });

  it("save() classifies transport failures and never acknowledges another mutation", async () => {
    const { client } = fakeClient({
      rpc: [
        { data: null, error: { code: "", message: "TypeError: fetch failed" }, status: 0 },
        { data: null, error: { code: "PGRST301", message: "JWT expired" }, status: 401 },
        { data: { status: "saved", revision: 9, mutationId: "e0000000-0000-4000-8000-000000000099", updatedAt: TIMESTAMP }, error: null, status: 200 },
        { data: { status: "conflict", currentRevision: 5 }, error: null, status: 200 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    const request = {
      projectId: PROJECT_ID, expectedRevision: 3, mutationId: MUTATION_ID,
      content: { title: "Lesson", document: structuredClone(VALID_DOCUMENT) as never },
    };
    expect(await repository.save(request)).toEqual({ status: "error", code: "network", retryable: true });
    expect(await repository.save(request)).toEqual({ status: "error", code: "auth", retryable: false });
    expect(await repository.save(request)).toEqual({ status: "error", code: "unknown", retryable: false });
    expect(await repository.save(request)).toEqual({ status: "conflict", currentRevision: 5 });
  });

  it("save() maps a thrown fetch error to a retryable network error", async () => {
    const client = { rpc: () => { throw new TypeError("Failed to fetch"); } };
    const repository = new SupabaseProjectRepository(client as never);
    expect(await repository.save({
      projectId: PROJECT_ID, expectedRevision: 0, mutationId: MUTATION_ID,
      content: { title: "Lesson", document: structuredClone(VALID_DOCUMENT) as never },
    })).toEqual({ status: "error", code: "network", retryable: true });
  });

  it("markDeleted() and reserve() call their RPCs with snake_case arguments", async () => {
    const { client, calls } = fakeClient({
      rpc: [
        { data: { status: "saved", revision: 6, mutationId: MUTATION_ID, updatedAt: TIMESTAMP }, error: null, status: 200 },
        { data: { status: "unavailable" }, error: null, status: 200 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    expect(await repository.markDeleted({ projectId: PROJECT_ID, expectedRevision: 5, mutationId: MUTATION_ID }))
      .toEqual({ status: "saved", revision: 6, mutationId: MUTATION_ID, updatedAt: TIMESTAMP });
    expect(await repository.reserve({ projectId: PROJECT_ID, title: "Lesson", initialSlideId: "10000000-0000-4000-8000-000000000001" }))
      .toEqual({ status: "unavailable" });
    const rpcCalls = calls.filter((call) => call.method === "rpc").map((call) => call.args);
    expect(rpcCalls).toEqual([
      ["mark_project_deleted", { p_project_id: PROJECT_ID, p_expected_revision: 5, p_mutation_id: MUTATION_ID }],
      ["reserve_project", { p_id: PROJECT_ID, p_title: "Lesson", p_initial_slide_id: "10000000-0000-4000-8000-000000000001" }],
    ]);
  });

  it("purge() only targets tombstoned rows and surfaces failures", async () => {
    const { client, calls } = fakeClient({
      from: [
        { data: [{ id: PROJECT_ID }], error: null, status: 200 },
        { data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    await repository.purge(PROJECT_ID);
    expect(calls).toContainEqual({ method: "delete", args: [] });
    expect(calls).toContainEqual({ method: "not", args: ["deleted_at", "is", null] });
    await expect(repository.purge(PROJECT_ID)).rejects.toMatchObject({ code: "network", retryable: true });
  });

  it("purge() is idempotent for an already purged row but refuses a live one", async () => {
    const { client } = fakeClient({
      from: [
        { data: [], error: null, status: 200 }, { data: null, error: null, status: 200 },
        { data: [], error: null, status: 200 },
        { data: { revision: 2, is_ready: true, deleted_at: null, last_mutation_id: null }, error: null, status: 200 },
      ],
    });
    const repository = new SupabaseProjectRepository(client);
    await expect(repository.purge(PROJECT_ID)).resolves.toBeUndefined();
    await expect(repository.purge(PROJECT_ID)).rejects.toMatchObject({ reason: "not_tombstoned", code: "validation" });
  });
});
