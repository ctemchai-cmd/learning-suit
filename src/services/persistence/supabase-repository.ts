import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectRecord, ProjectSummary } from "../../domain/document/model";
import { parseProjectContent } from "../../domain/document/schema";
import type {
  CloudProjectLifecycle,
  DeleteRequest,
  ProjectRepository,
  ReservationResult,
  ReserveRequest,
  SaveErrorCode,
  SaveRequest,
  SaveResult,
} from "./repository";

// Supabase adapter for ProjectRepository (plan02 §5, plan05 §5). The snake_case <-> camelCase mapping
// lives here only. RPC result shapes are documented in supabase/migrations/20260925010000_init.sql.

export const PROJECT_SUMMARY_COLUMNS = "id, owner_id, title, revision, created_at, updated_at";
export const PROJECT_RECORD_COLUMNS =
  "id, owner_id, title, document, revision, last_mutation_id, created_at, updated_at, deleted_at";
export const PROJECT_LIFECYCLE_COLUMNS = "revision, is_ready, deleted_at, last_mutation_id";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CloudErrorClassification {
  code: SaveErrorCode;
  retryable: boolean;
}

/** Thrown by reads (list/load/inspectLifecycle/purge) so callers can tell failures from "no row". */
export class CloudRepositoryError extends Error {
  readonly code: SaveErrorCode;
  readonly retryable: boolean;
  /** Machine-readable detail, e.g. "not_found", "schema_unsupported", "malformed_row". */
  readonly reason: string | undefined;

  constructor(message: string, classification: CloudErrorClassification, options: { reason?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "CloudRepositoryError";
    this.code = classification.code;
    this.retryable = classification.retryable;
    this.reason = options.reason;
  }
}

/** Minimal view of a PostgREST failure: HTTP status plus the PostgrestError fields. */
export interface PostgrestFailure {
  status?: number;
  code?: string;
  message?: string;
  details?: string;
  name?: string;
}

const NETWORK_MESSAGE = /failed to fetch|fetch failed|networkerror|network request failed|load failed|aborterror|timeouterror|timed? ?out|econn|enotfound|socket/i;
const AUTH_MESSAGE = /jwt|token.*expired|expired.*token|invalid.*signature/i;

/**
 * Error taxonomy used by the save coordinator:
 *  - network (retryable): no HTTP response (status 0 / fetch TypeError / abort), 408, 429, 5xx,
 *    serialization/deadlock/lock-timeout/cancel and connection-class SQLSTATEs.
 *  - auth: 401, 403, PGRST301-303 (JWT), 42501 (insufficient privilege, e.g. anonymous session).
 *  - quota: 413, SQLSTATE class 54 (program limit exceeded).
 *  - validation: SQLSTATE classes 22/23, P0001, PGRST1xx request errors.
 *  - unknown: anything else.
 */
export function classifyPostgrestFailure(failure: PostgrestFailure): CloudErrorClassification {
  const status = failure.status ?? 0;
  const code = failure.code ?? "";
  const message = `${failure.name ?? ""} ${failure.message ?? ""}`;

  if (status === 0 && (code === "" || NETWORK_MESSAGE.test(message))) return { code: "network", retryable: true };
  if (/^PGRST30[0-3]$/.test(code) || status === 401 || AUTH_MESSAGE.test(failure.message ?? "")) {
    return { code: "auth", retryable: false };
  }
  if (code === "42501" || status === 403) return { code: "auth", retryable: false };
  if (status === 413 || code.startsWith("54")) return { code: "quota", retryable: false };
  if (["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03"].includes(code) || code.startsWith("08") || code.startsWith("53")) {
    return { code: "network", retryable: true };
  }
  if (status === 408 || status === 429 || status >= 500) return { code: "network", retryable: true };
  if (code.startsWith("22") || code.startsWith("23") || code === "P0001" || /^PGRST1\d\d$/.test(code)) {
    return { code: "validation", retryable: false };
  }
  return { code: "unknown", retryable: false };
}

/** Classifies an exception thrown by supabase-js/fetch (rare: most failures are returned, not thrown). */
export function classifyThrown(error: unknown): CloudErrorClassification {
  if (error instanceof Error) {
    if (error instanceof TypeError || error.name === "AbortError" || error.name === "TimeoutError" || NETWORK_MESSAGE.test(error.message)) {
      return { code: "network", retryable: true };
    }
    if (AUTH_MESSAGE.test(error.message)) return { code: "auth", retryable: false };
  }
  return { code: "unknown", retryable: false };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

const SAVE_ERROR_CODES: readonly SaveErrorCode[] = ["auth", "network", "quota", "validation", "unknown"];
const MALFORMED: SaveResult = { status: "error", code: "unknown", retryable: false };

/** Maps the save_project / mark_project_deleted jsonb result onto SaveResult (defensively). */
export function parseSaveResultJson(value: unknown): SaveResult {
  if (!isObject(value)) return MALFORMED;
  switch (value.status) {
    case "saved":
      if (isRevision(value.revision) && typeof value.mutationId === "string" && typeof value.updatedAt === "string") {
        return { status: "saved", revision: value.revision, mutationId: value.mutationId, updatedAt: value.updatedAt };
      }
      return MALFORMED;
    case "conflict":
      return isRevision(value.currentRevision) ? { status: "conflict", currentRevision: value.currentRevision } : MALFORMED;
    case "unavailable":
      return { status: "unavailable" };
    case "error": {
      const code = SAVE_ERROR_CODES.find((candidate) => candidate === value.code) ?? "unknown";
      return { status: "error", code, retryable: value.retryable === true };
    }
    default:
      return MALFORMED;
  }
}

/** Maps a camelCase record (reserve_project `existing.record`) onto ProjectRecord; validates content. */
export function mapRecordJson(value: unknown): ProjectRecord {
  if (!isObject(value)) throw new CloudRepositoryError("Malformed project record", { code: "unknown", retryable: false }, { reason: "malformed_row" });
  return mapRecordRow({
    id: value.id,
    owner_id: value.ownerId,
    title: value.title,
    document: value.document,
    revision: value.revision,
    last_mutation_id: value.lastMutationId,
    created_at: value.createdAt,
    updated_at: value.updatedAt,
    deleted_at: value.deletedAt,
  });
}

/** Maps the reserve_project jsonb result onto ReservationResult. */
export function parseReservationJson(value: unknown): ReservationResult {
  const malformed: ReservationResult = { status: "error", code: "unknown", retryable: false };
  if (!isObject(value)) return malformed;
  switch (value.status) {
    case "reserved":
      return value.revision === 0 ? { status: "reserved", revision: 0 } : malformed;
    case "existing":
      try {
        return { status: "existing", record: mapRecordJson(value.record) };
      } catch (error) {
        if (error instanceof CloudRepositoryError) return { status: "error", code: error.code, retryable: error.retryable };
        throw error;
      }
    case "unavailable":
      return { status: "unavailable" };
    case "error":
      return {
        status: "error",
        code: typeof value.code === "string" ? value.code : "unknown",
        retryable: value.retryable === true,
      };
    default:
      return malformed;
  }
}

function rowError(field: string): CloudRepositoryError {
  return new CloudRepositoryError(`Malformed projects row: ${field}`, { code: "unknown", retryable: false }, { reason: "malformed_row" });
}

function requireString(row: JsonObject, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw rowError(field);
  return value;
}

function requireRevision(row: JsonObject, field: string): number {
  const value = row[field];
  if (!isRevision(value)) throw rowError(field);
  return value;
}

function nullableString(row: JsonObject, field: string): string | null {
  const value = optionalString(row[field]);
  if (value === undefined) throw rowError(field);
  return value;
}

export function mapSummaryRow(value: unknown): ProjectSummary {
  if (!isObject(value)) throw rowError("row");
  return {
    id: requireString(value, "id"),
    ownerId: requireString(value, "owner_id"),
    title: requireString(value, "title"),
    revision: requireRevision(value, "revision"),
    createdAt: requireString(value, "created_at"),
    updatedAt: requireString(value, "updated_at"),
  };
}

/** Maps a snake_case projects row (with document) onto ProjectRecord; the content must pass the v1 schema. */
export function mapRecordRow(value: unknown): ProjectRecord {
  if (!isObject(value)) throw rowError("row");
  const base = {
    id: requireString(value, "id"),
    ownerId: requireString(value, "owner_id"),
    revision: requireRevision(value, "revision"),
    lastMutationId: nullableString(value, "last_mutation_id"),
    createdAt: requireString(value, "created_at"),
    updatedAt: requireString(value, "updated_at"),
    deletedAt: nullableString(value, "deleted_at"),
  };
  let content;
  try {
    content = parseProjectContent({ title: value.title, document: value.document });
  } catch (cause) {
    // Unknown schema/node types: keep local drafts and pause cloud writes (plan05 §6 rule 8).
    throw new CloudRepositoryError("Cloud document does not match the supported schema", { code: "validation", retryable: false }, { reason: "schema_unsupported", cause });
  }
  return { ...base, title: content.title, document: content.document };
}

export function mapLifecycleRow(value: unknown): CloudProjectLifecycle {
  if (!isObject(value)) throw rowError("row");
  if (typeof value.is_ready !== "boolean") throw rowError("is_ready");
  return {
    revision: requireRevision(value, "revision"),
    isReady: value.is_ready,
    deletedAt: nullableString(value, "deleted_at"),
    lastMutationId: nullableString(value, "last_mutation_id"),
  };
}

interface QueryResponse {
  data: unknown;
  error: { code?: string; message?: string; details?: string; name?: string } | null;
  status?: number;
}

export interface SupabaseRepositoryOptions {
  /** Abort each request after this many ms (a lost response then surfaces as a retryable network error). */
  timeoutMs?: number;
}

export class SupabaseProjectRepository implements ProjectRepository {
  private readonly timeoutMs: number;

  constructor(private readonly client: SupabaseClient, options: SupabaseRepositoryOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async list(): Promise<ProjectSummary[]> {
    const response = await this.read("list projects", () =>
      this.client
        .from("projects")
        .select(PROJECT_SUMMARY_COLUMNS)
        .eq("is_ready", true)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .abortSignal(this.signal()),
    );
    if (!Array.isArray(response.data)) throw rowError("list");
    return response.data.map(mapSummaryRow);
  }

  async load(id: string): Promise<ProjectRecord | null> {
    const response = await this.read("load project", () =>
      this.client
        .from("projects")
        .select(PROJECT_RECORD_COLUMNS)
        .eq("id", id)
        .eq("is_ready", true)
        .is("deleted_at", null)
        .abortSignal(this.signal())
        .maybeSingle(),
    );
    return response.data === null ? null : mapRecordRow(response.data);
  }

  async inspectLifecycle(id: string): Promise<CloudProjectLifecycle | null> {
    const response = await this.read("inspect project lifecycle", () =>
      this.client.from("projects").select(PROJECT_LIFECYCLE_COLUMNS).eq("id", id).abortSignal(this.signal()).maybeSingle(),
    );
    return response.data === null ? null : mapLifecycleRow(response.data);
  }

  async reserve(request: ReserveRequest): Promise<ReservationResult> {
    const outcome = await this.callRpc("reserve_project", {
      p_id: request.projectId,
      p_title: request.title,
      p_initial_slide_id: request.initialSlideId,
    });
    if ("failure" in outcome) return { status: "error", ...outcome.failure };
    return parseReservationJson(outcome.data);
  }

  async save(request: SaveRequest): Promise<SaveResult> {
    const outcome = await this.callRpc("save_project", {
      p_project_id: request.projectId,
      p_expected_revision: request.expectedRevision,
      p_mutation_id: request.mutationId,
      p_title: request.content.title,
      p_document: request.content.document,
    });
    if ("failure" in outcome) return { status: "error", ...outcome.failure };
    return acknowledgeOnly(parseSaveResultJson(outcome.data), request.mutationId);
  }

  async markDeleted(request: DeleteRequest): Promise<SaveResult> {
    const outcome = await this.callRpc("mark_project_deleted", {
      p_project_id: request.projectId,
      p_expected_revision: request.expectedRevision,
      p_mutation_id: request.mutationId,
    });
    if ("failure" in outcome) return { status: "error", ...outcome.failure };
    return acknowledgeOnly(parseSaveResultJson(outcome.data), request.mutationId);
  }

  async purge(id: string): Promise<void> {
    // RLS only permits deleting tombstoned rows; the filter makes the intent explicit. Assets cascade.
    const response = await this.read("purge project", () =>
      this.client.from("projects").delete().eq("id", id).not("deleted_at", "is", null).select("id").abortSignal(this.signal()),
    );
    if (Array.isArray(response.data) && response.data.length > 0) return;
    // Nothing deleted: fine if the row is already gone (retry), an error if it still exists (not tombstoned).
    if (await this.inspectLifecycle(id)) {
      throw new CloudRepositoryError("Project is not tombstoned; refusing to report it purged", { code: "validation", retryable: false }, { reason: "not_tombstoned" });
    }
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs);
  }

  private async read(label: string, run: () => PromiseLike<QueryResponse>): Promise<QueryResponse> {
    let response: QueryResponse;
    try {
      response = await run();
    } catch (cause) {
      throw new CloudRepositoryError(`${label} failed`, classifyThrown(cause), { cause });
    }
    if (response.error) {
      throw new CloudRepositoryError(
        `${label} failed: ${response.error.message ?? "unknown error"}`,
        classifyPostgrestFailure({ ...response.error, status: response.status }),
        { cause: response.error },
      );
    }
    return response;
  }

  private async callRpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown } | { failure: CloudErrorClassification }> {
    try {
      const response: QueryResponse = await this.client.rpc(fn, args).abortSignal(this.signal());
      if (response.error) return { failure: classifyPostgrestFailure({ ...response.error, status: response.status }) };
      return { data: response.data };
    } catch (cause) {
      return { failure: classifyThrown(cause) };
    }
  }
}

/** A `saved` acknowledgement is only valid for the mutation that was sent. */
export function acknowledgeOnly(result: SaveResult, mutationId: string): SaveResult {
  if (result.status === "saved" && result.mutationId.toLowerCase() !== mutationId.toLowerCase()) return MALFORMED;
  return result;
}
