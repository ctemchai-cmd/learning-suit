import type { AssetReference, ProjectContent, ProjectRecord, ProjectSummary } from "@/domain/document/model";

// Contracts from docs/plan/02-architecture-and-data-contracts.md §5.
// UI code never talks to Supabase directly; adapters implement these interfaces.

export interface SaveRequest {
  projectId: string;
  expectedRevision: number;
  mutationId: string;
  content: ProjectContent;
}
export type SaveErrorCode = "auth" | "network" | "quota" | "validation" | "unknown";
export type SaveResult =
  | { status: "saved"; revision: number; mutationId: string; updatedAt: string }
  | { status: "conflict"; currentRevision: number }
  /** Missing, deleted and not-owned are deliberately indistinguishable. */
  | { status: "unavailable" }
  | { status: "error"; code: SaveErrorCode; retryable: boolean };

export interface ReserveRequest {
  projectId: string;
  title: string;
  initialSlideId: string;
}
export type ReservationResult =
  | { status: "reserved"; revision: 0 }
  | { status: "existing"; record: ProjectRecord }
  | { status: "unavailable" }
  | { status: "error"; code: string; retryable: boolean };

export interface DeleteRequest {
  projectId: string;
  expectedRevision: number;
  mutationId: string;
}

export interface CloudProjectLifecycle {
  revision: number;
  isReady: boolean;
  deletedAt: string | null;
  lastMutationId: string | null;
}

export interface ProjectRepository {
  /** Ready, not-deleted metadata only; never fetches JSONB. */
  list(): Promise<ProjectSummary[]>;
  /** Ready, not-deleted document or null. Network failures throw. */
  load(id: string): Promise<ProjectRecord | null>;
  /** Metadata-only lifecycle read (includes reservations/tombstones). null = no visible row; failures throw. */
  inspectLifecycle(id: string): Promise<CloudProjectLifecycle | null>;
  reserve(request: ReserveRequest): Promise<ReservationResult>;
  save(request: SaveRequest): Promise<SaveResult>;
  markDeleted(request: DeleteRequest): Promise<SaveResult>;
  /** Hard delete after tombstone + storage cleanup (asset rows cascade). */
  purge(id: string): Promise<void>;
}

export type AssetOpResult =
  | { status: "ok" }
  | { status: "error"; code: "auth" | "network" | "validation" | "mismatch" | "unknown"; retryable: boolean };

/** Private attachment storage + project_assets metadata (plan05 §5 steps 3–5, §7). */
export interface CloudAssetStore {
  /** upload_state of registered assets for a project the caller owns. */
  listStates(projectId: string): Promise<Record<string, "pending" | "ready">>;
  /** Insert pending metadata; if a row exists every metadata field must match. */
  register(projectId: string, asset: AssetReference): Promise<AssetOpResult>;
  /** upsert=false upload; if the object already exists, download and compare sha256. */
  upload(asset: AssetReference, bytes: Blob): Promise<AssetOpResult>;
  markReady(projectId: string, assetId: string): Promise<AssetOpResult>;
  download(asset: AssetReference): Promise<Blob>;
  /** Delete every object under `<owner>/<project>/` in batches, re-listing the first page until empty. */
  removeProjectObjects(ownerId: string, projectId: string): Promise<void>;
}

export interface AssetResolver {
  /** Local-first, then authenticated download. */
  resolve(assetId: string): Promise<Blob>;
}
