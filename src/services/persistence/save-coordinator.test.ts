import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { referencedAssetIds } from "../../domain/document/assets";
import type { AssetReference, ProjectContent } from "../../domain/document/model";
import type { SaveJob } from "../../domain/document/session";
import { backoffDelayMs } from "./backoff";
import type {
  AssetOpResult, CloudProjectLifecycle, ReservationResult, ReserveRequest, SaveRequest, SaveResult,
} from "./repository";
import {
  cloudStatusLabel, createSaveCoordinator, type CloudStatus, type CoordinatorClock, type SaveCoordinatorDeps,
  type SaveJobStore,
} from "./save-coordinator";

const OWNER = "owner-1";
const PROJECT = "project-1";
const KEY = `${OWNER}/${PROJECT}`;

// ─── fakes ──────────────────────────────────────────────────────────────────

type Interceptor = (real: () => Promise<unknown>) => Promise<unknown>;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Row {
  revision: number;
  isReady: boolean;
  deletedAt: string | null;
  lastMutationId: string | null;
  content: ProjectContent;
  createdAt: string;
  updatedAt: string;
}

const nowIso = () => new Date(Date.now()).toISOString();

/** In-memory server with the RPC semantics of plan05 §5 and per-call failure injection. */
class FakeCloud {
  rows = new Map<string, Row>();
  assetStates = new Map<string, "pending" | "ready">();
  assetPaths = new Map<string, string>();
  objects = new Map<string, string>(); // storagePath → sha256
  saveRequests: SaveRequest[] = [];
  saveTimes: number[] = [];
  activeSaves = 0;
  maxActiveSaves = 0;
  private once = new Map<string, Interceptor[]>();
  private persistent = new Map<string, Interceptor>();

  constructor(private events: string[]) {}

  /** Intercept the next call of `method`. The interceptor may call `real()` to run the server logic. */
  on(method: string, interceptor: Interceptor): void {
    const queue = this.once.get(method) ?? [];
    queue.push(interceptor);
    this.once.set(method, queue);
  }
  always(method: string, interceptor: Interceptor | null): void {
    if (interceptor) this.persistent.set(method, interceptor);
    else this.persistent.delete(method);
  }

  private run<R>(method: string, label: string, real: () => Promise<R>): Promise<R> {
    this.events.push(label);
    const interceptor = this.once.get(method)?.shift() ?? this.persistent.get(method);
    return (interceptor ? interceptor(real) : real()) as Promise<R>;
  }

  seedReady(projectId: string, revision: number, content: ProjectContent, lastMutationId: string | null = "seed"): void {
    this.rows.set(projectId, {
      revision, isReady: true, deletedAt: null, lastMutationId, content, createdAt: nowIso(), updatedAt: nowIso(),
    });
  }
  seedReservation(projectId: string, content: ProjectContent): void {
    this.rows.set(projectId, {
      revision: 0, isReady: false, deletedAt: null, lastMutationId: null, content, createdAt: nowIso(), updatedAt: nowIso(),
    });
  }
  otherDeviceSave(projectId: string): void {
    const row = this.rows.get(projectId)!;
    row.revision += 1;
    row.lastMutationId = "other-device";
    row.updatedAt = nowIso();
  }

  repository = {
    reserve: (request: ReserveRequest) => this.run("reserve", "reserve", async (): Promise<ReservationResult> => {
      const row = this.rows.get(request.projectId);
      if (row?.deletedAt) return { status: "unavailable" };
      if (row) {
        return {
          status: "existing",
          record: { id: request.projectId, ownerId: OWNER, ...row, title: row.content.title, document: row.content.document },
        };
      }
      this.seedReservation(request.projectId, {
        title: request.title,
        document: { schemaVersion: 1, slides: [{ id: request.initialSlideId, name: "สไลด์ 1", background: "#FFFFFF", nodes: [] }], assets: {} },
      });
      return { status: "reserved", revision: 0 };
    }),
    save: (request: SaveRequest) => {
      this.saveRequests.push(request);
      this.saveTimes.push(Date.now());
      this.activeSaves += 1;
      this.maxActiveSaves = Math.max(this.maxActiveSaves, this.activeSaves);
      return this.run("save", `save:${request.mutationId}:${request.expectedRevision}`, async () => this.commitSave(request))
        .finally(() => {
          this.activeSaves -= 1;
        });
    },
    inspectLifecycle: (id: string) => this.run("inspectLifecycle", "inspectLifecycle", async (): Promise<CloudProjectLifecycle | null> => {
      const row = this.rows.get(id);
      return row ? { revision: row.revision, isReady: row.isReady, deletedAt: row.deletedAt, lastMutationId: row.lastMutationId } : null;
    }),
  };

  private commitSave(request: SaveRequest): SaveResult {
    const row = this.rows.get(request.projectId);
    if (!row || row.deletedAt) return { status: "unavailable" };
    if (row.lastMutationId === request.mutationId) {
      return { status: "saved", revision: row.revision, mutationId: request.mutationId, updatedAt: row.updatedAt };
    }
    if (row.revision !== request.expectedRevision) return { status: "conflict", currentRevision: row.revision };
    for (const id of referencedAssetIds(request.content.document)) {
      if (this.assetStates.get(id) !== "ready") return { status: "error", code: "validation", retryable: false };
    }
    Object.assign(row, {
      revision: row.revision + 1, lastMutationId: request.mutationId, isReady: true, content: request.content, updatedAt: nowIso(),
    });
    return { status: "saved", revision: row.revision, mutationId: request.mutationId, updatedAt: row.updatedAt };
  }

  assets = {
    listStates: (projectId: string) => this.run("listStates", "listStates", async () => {
      void projectId;
      return Object.fromEntries(this.assetStates);
    }),
    register: (projectId: string, asset: AssetReference) => this.run("register", `register:${asset.id}`, async (): Promise<AssetOpResult> => {
      void projectId;
      if (!this.assetStates.has(asset.id)) this.assetStates.set(asset.id, "pending");
      this.assetPaths.set(asset.id, asset.storagePath);
      return { status: "ok" };
    }),
    upload: (asset: AssetReference, bytes: Blob) => this.run("upload", `upload:${asset.id}`, async (): Promise<AssetOpResult> => {
      void bytes;
      const existing = this.objects.get(asset.storagePath);
      if (existing && existing !== asset.sha256) return { status: "error", code: "mismatch", retryable: false };
      this.objects.set(asset.storagePath, asset.sha256);
      return { status: "ok" };
    }),
    markReady: (projectId: string, assetId: string) => this.run("markReady", `markReady:${assetId}`, async (): Promise<AssetOpResult> => {
      void projectId;
      const path = this.assetPaths.get(assetId);
      if (!path || !this.objects.has(path)) return { status: "error", code: "validation", retryable: false };
      this.assetStates.set(assetId, "ready");
      return { status: "ok" };
    }),
  };
}

class FakeJobStore implements SaveJobStore {
  jobs = new Map<string, SaveJob>();
  draft: { acknowledgedSequence: number; baseRevision: number | null } = { acknowledgedSequence: 0, baseRevision: null };
  failPut = 0;
  failAck = 0;
  constructor(private events: string[]) {}
  async getSaveJob(ownerId: string, projectId: string) {
    return this.jobs.get(`${ownerId}/${projectId}`) ?? null;
  }
  async putSaveJob(job: SaveJob) {
    this.events.push(`putSaveJob:${job.mutationId}`);
    if (this.failPut > 0) {
      this.failPut -= 1;
      throw new Error("QuotaExceededError");
    }
    this.jobs.set(`${job.ownerId}/${job.projectId}`, structuredClone(job));
  }
  async acknowledge(ownerId: string, projectId: string, ack: { sequence: number; revision: number; mutationId: string }) {
    this.events.push(`acknowledge:${ack.mutationId}`);
    if (this.failAck > 0) {
      this.failAck -= 1;
      throw new Error("IDB write failed");
    }
    this.draft = { acknowledgedSequence: Math.max(this.draft.acknowledgedSequence, ack.sequence), baseRevision: ack.revision };
    const key = `${ownerId}/${projectId}`;
    if (this.jobs.get(key)?.mutationId === ack.mutationId) this.jobs.delete(key);
  }
  async deleteSaveJob(ownerId: string, projectId: string) {
    this.jobs.delete(`${ownerId}/${projectId}`);
  }
}

const clock: CoordinatorClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function assetRef(id: string, sha = "a".repeat(64)): AssetReference {
  return { id, mimeType: "image/png", width: 10, height: 10, byteLength: 4, sha256: sha, storagePath: `${OWNER}/${PROJECT}/${id}.png` };
}

function makeContent(title: string, imageIds: string[] = [], registryOnly: string[] = []): ProjectContent {
  return {
    title,
    document: {
      schemaVersion: 1,
      slides: [{
        id: "slide-1", name: "สไลด์ 1", background: "#FFFFFF",
        nodes: imageIds.map((assetId, index) => ({
          id: `image-${index}`, type: "image" as const, assetId, x: 0, y: 0, rotation: 0, opacity: 1, locked: false, width: 10, height: 10,
        })),
      }],
      assets: Object.fromEntries([...imageIds, ...registryOnly].map((id) => [id, assetRef(id)])),
    },
  };
}

interface SetupOptions {
  initial?: Partial<SaveCoordinatorDeps["initial"]>;
  deletionGuard?: () => Promise<boolean>;
  seedCloud?: boolean;
}

function setup(options: SetupOptions = {}) {
  const events: string[] = [];
  const cloud = new FakeCloud(events);
  const jobs = new FakeJobStore(events);
  const blobs = new Map<string, Blob>();
  const net = { online: true };
  let nextId = 0;
  const initial = { baseRevision: 1, localSequence: 0, acknowledgedSequence: 0, content: makeContent("v0"), ...options.initial };
  if (initial.baseRevision !== null && options.seedCloud !== false) cloud.seedReady(PROJECT, initial.baseRevision, initial.content);
  jobs.draft = { acknowledgedSequence: initial.acknowledgedSequence, baseRevision: initial.baseRevision };
  const coordinator = createSaveCoordinator({
    ownerId: OWNER, projectId: PROJECT,
    repository: cloud.repository, assets: cloud.assets,
    localAssets: { getBlob: async (id) => blobs.get(id) ?? null },
    jobs, clock,
    newMutationId: () => `m${++nextId}`,
    isOnline: () => net.online,
    deletionGuard: options.deletionGuard,
    initial,
  });
  const statuses: CloudStatus[] = [];
  coordinator.subscribe((status) => statuses.push(status));
  return { events, cloud, jobs, blobs, net, coordinator, statuses };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
}
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}
const networkDown = () => Promise.reject(new TypeError("fetch failed"));
const commitThenLoseResponse: Interceptor = async (real) => {
  await real();
  throw new TypeError("response lost");
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T09:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── tests ──────────────────────────────────────────────────────────────────

describe("backoff", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(backoffDelayMs(0)).toBe(1000);
  });
});

describe("save coordinator: debounce and status", () => {
  it("starts in the right status and has no side effects before it is used", async () => {
    const clean = setup({ initial: { localSequence: 2, acknowledgedSequence: 2, lastSavedAt: "2026-09-24T00:00:00.000Z" } });
    expect(clean.coordinator.getStatus()).toEqual({ kind: "saved", at: "2026-09-24T00:00:00.000Z" });
    const dirty = setup({ initial: { localSequence: 3, acknowledgedSequence: 2 } });
    expect(dirty.coordinator.getStatus()).toEqual({ kind: "pending" });
    await advance(10_000);
    expect(dirty.events).toEqual([]);
    dirty.coordinator.start();
    await flush();
    expect(dirty.events).toEqual(["putSaveJob:m1", "save:m1:1", "acknowledge:m1"]);
    expect(dirty.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("debounces 1500 ms from the last local write and restarts on each write", async () => {
    const h = setup();
    h.coordinator.localWriteAcknowledged(1, makeContent("a"));
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    await advance(1000);
    h.coordinator.localWriteAcknowledged(2, makeContent("b"));
    await advance(1499);
    expect(h.cloud.saveRequests).toHaveLength(0);
    await advance(1);
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.cloud.saveRequests[0]).toMatchObject({ projectId: PROJECT, expectedRevision: 1, mutationId: "m1", content: { title: "b" } });
    expect(h.coordinator.getStatus()).toEqual({ kind: "saved", at: "2026-09-25T09:00:02.500Z" });
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 2, baseRevision: 2 });
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.statuses.map((s) => s.kind)).toEqual(["pending", "saved"]);
    expect(cloudStatusLabel(h.coordinator.getStatus())).toBe("บันทึกบน Cloud แล้ว");
  });

  it("persists the immutable job before any network call and ignores stale sequences", async () => {
    const h = setup();
    h.coordinator.localWriteAcknowledged(2, makeContent("two"));
    h.coordinator.localWriteAcknowledged(1, makeContent("stale"));
    await advance(1500);
    expect(h.events).toEqual(["putSaveJob:m1", "save:m1:1", "acknowledge:m1"]);
    expect(h.cloud.saveRequests[0].content.title).toBe("two");
  });

  it("keeps getStatus() referentially stable while the status does not change", async () => {
    const h = setup();
    h.coordinator.localWriteAcknowledged(1, makeContent("a"));
    const first = h.coordinator.getStatus();
    h.coordinator.localWriteAcknowledged(2, makeContent("b"));
    expect(h.coordinator.getStatus()).toBe(first);
    expect(h.statuses).toHaveLength(1);
  });

  it("publishes only referenced assets (normalized snapshot)", async () => {
    const content = makeContent("n", [], ["unused"]);
    const h = setup();
    h.coordinator.localWriteAcknowledged(1, content);
    await advance(1500);
    expect(h.cloud.saveRequests[0].content.document.assets).toEqual({});
    expect(h.events).not.toContain("listStates");
  });
});

describe("save coordinator: one job at a time (PST-06)", () => {
  it("ack of save 1 does not mark content 2 saved and content 2 follows with the new revision", async () => {
    const h = setup();
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.cloud.saveRequests).toHaveLength(1);

    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    const persisted = h.jobs.jobs.get(KEY)!;
    expect(persisted).toMatchObject({ mutationId: "m1", localSequence: 1, expectedRevision: 1, content: { title: "c1" } });
    expect(h.coordinator.getSyncState().activeJob?.content.title).toBe("c1");

    gate.resolve();
    await flush();
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 1, baseRevision: 2 });
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    expect(h.statuses.some((s) => s.kind === "saved")).toBe(false);
    expect(h.coordinator.getLatestLocal()).toMatchObject({ sequence: 2, content: { title: "c2" } });

    // Debounce is measured from write 2 (t = 1500) → due at 3000.
    await advance(1499);
    expect(h.cloud.saveRequests).toHaveLength(1);
    await advance(1);
    expect(h.cloud.saveRequests[1]).toMatchObject({ mutationId: "m2", expectedRevision: 2, content: { title: "c2" } });
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 2, baseRevision: 3 });
  });

  it("goes immediately after the ack when the debounce already elapsed", async () => {
    const h = setup();
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    await advance(5000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    gate.resolve();
    await flush();
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1", "m2"]);
  });

  it("never runs two repository.save calls concurrently", async () => {
    const h = setup();
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    for (let sequence = 2; sequence <= 6; sequence += 1) {
      h.coordinator.localWriteAcknowledged(sequence, makeContent(`c${sequence}`));
      void h.coordinator.saveNow();
      h.coordinator.retry();
      h.coordinator.setOnline(true);
      await advance(2000);
    }
    expect(h.cloud.saveRequests).toHaveLength(1);
    gate.resolve();
    await advance(5000);
    expect(h.cloud.maxActiveSaves).toBe(1);
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.expectedRevision, r.content.title])).toEqual([
      ["m1", 1, "c1"], ["m2", 2, "c6"],
    ]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });
});

describe("save coordinator: retries and idempotency (PST-07)", () => {
  it("retries the same mutationId after a lost response; server replays without a second revision", async () => {
    const h = setup();
    h.cloud.on("save", commitThenLoseResponse);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.cloud.rows.get(PROJECT)!.revision).toBe(2);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "network", retryable: true });
    expect(h.jobs.jobs.get(KEY)?.mutationId).toBe("m1");
    expect(h.jobs.draft.baseRevision).toBe(1);

    await advance(999);
    expect(h.cloud.saveRequests).toHaveLength(1);
    await advance(1);
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.expectedRevision])).toEqual([["m1", 1], ["m1", 1]]);
    expect(h.cloud.rows.get(PROJECT)!.revision).toBe(2);
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 1, baseRevision: 2 });
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("turns the retry into a conflict when another device saved meanwhile (PST-07/09) and stops the queue", async () => {
    const h = setup();
    h.cloud.on("save", commitThenLoseResponse);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    h.cloud.otherDeviceSave(PROJECT);
    await advance(1000);
    expect(h.coordinator.getStatus()).toEqual({ kind: "conflict", currentRevision: 3 });
    expect(cloudStatusLabel(h.coordinator.getStatus())).toBe("มีงานจากอีกเครื่อง");

    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    h.coordinator.retry();
    await expect(h.coordinator.saveNow()).resolves.toEqual({ kind: "conflict", currentRevision: 3 });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(2);
    expect(h.cloud.rows.get(PROJECT)!.lastMutationId).toBe("other-device");
    expect(h.jobs.jobs.get(KEY)?.mutationId).toBe("m1");
    expect(h.coordinator.getLatestLocal()).toMatchObject({ sequence: 2, content: { title: "c2" } });
  });

  it("stops on a direct conflict without overwriting", async () => {
    const h = setup();
    h.cloud.otherDeviceSave(PROJECT);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toEqual({ kind: "conflict", currentRevision: 2 });
    await advance(60_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
  });

  it("backs off 1, 2, 4, 8, 16, 30, 30 s with the same job and resets after success", async () => {
    const h = setup();
    h.cloud.always("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const count = h.cloud.saveRequests.length;
      await advance(delay - 1);
      expect(h.cloud.saveRequests).toHaveLength(count);
      await advance(1);
      expect(h.cloud.saveRequests).toHaveLength(count + 1);
    }
    const times = h.cloud.saveTimes;
    expect(times.slice(1).map((t, i) => t - times[i])).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(new Set(h.cloud.saveRequests.map((r) => r.mutationId))).toEqual(new Set(["m1"]));

    h.cloud.always("save", null);
    await advance(30_000);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });

    h.cloud.always("save", networkDown);
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    await advance(1500);
    const failedAt = Date.now();
    await advance(1000);
    expect(h.cloud.saveTimes.at(-1)! - failedAt).toBe(1000);
    expect(h.cloud.saveRequests.at(-1)!.mutationId).toBe("m2");
  });

  it("manual retry is immediate, reuses the job and resets the backoff", async () => {
    const h = setup();
    h.cloud.always("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    await advance(1000);
    await advance(2000);
    expect(h.cloud.saveRequests).toHaveLength(3);
    h.coordinator.retry();
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(4);
    await advance(1000);
    expect(h.cloud.saveRequests).toHaveLength(5);
    expect(new Set(h.cloud.saveRequests.map((r) => r.mutationId))).toEqual(new Set(["m1"]));
  });

  it("retries retryable unknown errors but not non-retryable ones", async () => {
    const h = setup();
    h.cloud.on("save", async () => ({ status: "error", code: "unknown", retryable: true }));
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "unknown", retryable: true });
    await advance(1000);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1", "m1"]);
  });

  it("does not send when the job cannot be persisted locally, then retries", async () => {
    const h = setup();
    h.jobs.failPut = 1;
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.cloud.saveRequests).toHaveLength(0);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "unknown", retryable: true });
    await advance(1000);
    expect(h.events).toEqual(["putSaveJob:m1", "putSaveJob:m1", "save:m1:1", "acknowledge:m1"]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("replays the same job when the local acknowledgement fails", async () => {
    const h = setup();
    h.jobs.failAck = 1;
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error" });
    expect(h.coordinator.getSyncState().baseRevision).toBe(1);
    await advance(1000);
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1", "m1"]);
    expect(h.cloud.rows.get(PROJECT)!.revision).toBe(2);
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 1, baseRevision: 2 });
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });
});

describe("save coordinator: offline, auth and terminal results", () => {
  it("pauses while offline and resumes immediately with the same job", async () => {
    const h = setup();
    h.cloud.on("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    h.net.online = false;
    await advance(1500);
    // Debounce elapsed while offline: nothing is sent.
    expect(h.cloud.saveRequests).toHaveLength(0);
    expect(h.coordinator.getStatus()).toEqual({ kind: "offline" });
    expect(cloudStatusLabel(h.coordinator.getStatus())).toBe("เก็บในเครื่องแล้ว · รอเชื่อมต่อ");

    h.net.online = true;
    h.coordinator.setOnline(true);
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(1);
    // The request failed and the device reports offline → "offline", no retries while offline.
    h.net.online = false;
    h.coordinator.setOnline(false);
    expect(h.coordinator.getStatus()).toEqual({ kind: "offline" });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);

    h.net.online = true;
    h.coordinator.setOnline(true);
    await flush();
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1", "m1"]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("maps a network failure to offline when the device is offline", async () => {
    const h = setup();
    h.cloud.on("save", async () => {
      h.net.online = false;
      throw new TypeError("fetch failed");
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toEqual({ kind: "offline" });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    h.net.online = true;
    h.coordinator.setOnline(true);
    await flush();
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("pauses on auth failure and resumes the same job for the same owner (PST-08)", async () => {
    const h = setup();
    h.cloud.on("save", async () => ({ status: "error", code: "auth", retryable: false }));
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toEqual({ kind: "auth" });
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    h.coordinator.retry();
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.coordinator.getStatus()).toEqual({ kind: "auth" });

    h.coordinator.authRestored(OWNER);
    await flush();
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.content.title])).toEqual([["m1", "c1"], ["m1", "c1"], ["m2", "c2"]]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("stops permanently when a different owner signs in and keeps the old owner's job", async () => {
    const h = setup();
    h.cloud.on("save", async () => ({ status: "error", code: "auth", retryable: false }));
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    h.coordinator.authRestored("owner-2");
    expect(h.coordinator.getStatus()).toEqual({ kind: "stopped" });
    h.coordinator.authRestored(OWNER);
    h.coordinator.retry();
    h.coordinator.setOnline(true);
    await expect(h.coordinator.saveNow()).resolves.toEqual({ kind: "stopped" });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.jobs.jobs.get(KEY)).toMatchObject({ ownerId: OWNER, mutationId: "m1" });
  });

  it.each(["validation", "quota"] as const)("stops auto retry of a %s-rejected payload; a newer write tries again", async (code) => {
    const h = setup();
    h.cloud.on("save", async () => ({ status: "error", code, retryable: false }));
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code, retryable: false });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);

    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    await advance(1500);
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.expectedRevision, r.content.title])).toEqual([
      ["m1", 1, "c1"], ["m2", 1, "c2"],
    ]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("stops the queue when the project is unavailable", async () => {
    const h = setup();
    h.cloud.rows.get(PROJECT)!.deletedAt = nowIso();
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.coordinator.getStatus()).toEqual({ kind: "unavailable" });
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    await advance(60_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
  });

  it("never saves while a deletion is pending", async () => {
    const h = setup({ deletionGuard: async () => true });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    expect(h.events).toEqual([]);
    expect(h.coordinator.getStatus()).toEqual({ kind: "stopped" });
  });
});

describe("save coordinator: first publish (PST-04/05)", () => {
  const imageContent = () => makeContent("new lesson", ["a1"]);

  it("reserve → register → upload → markReady → save(0); baseRevision stays null until the ack", async () => {
    const h = setup({ initial: { baseRevision: null, content: imageContent() } });
    h.blobs.set("a1", new Blob(["png!"]));
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.start();
    await flush();
    expect(h.events).toEqual(["putSaveJob:m1", "reserve", "listStates", "register:a1", "upload:a1", "markReady:a1", "save:m1:0"]);
    expect(h.jobs.jobs.get(KEY)).toMatchObject({ expectedRevision: 0, localSequence: 0 });
    expect(h.coordinator.getSyncState().baseRevision).toBeNull();
    expect(h.jobs.draft.baseRevision).toBeNull();
    expect(h.cloud.rows.get(PROJECT)).toMatchObject({ revision: 0, isReady: false });

    gate.resolve();
    await flush();
    expect(h.events.at(-1)).toBe("acknowledge:m1");
    expect(h.cloud.rows.get(PROJECT)).toMatchObject({ revision: 1, isReady: true, content: { title: "new lesson" } });
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 0, baseRevision: 1 });
    expect(h.coordinator.getSyncState().baseRevision).toBe(1);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("an unpublished project is never reported saved and waits while offline", async () => {
    const h = setup({ initial: { baseRevision: null } });
    h.net.online = false;
    h.coordinator.start();
    await advance(10_000);
    expect(h.events).toEqual([]);
    expect(h.coordinator.getStatus()).toEqual({ kind: "offline" });
    h.net.online = true;
    h.coordinator.setOnline(true);
    await flush();
    expect(h.events).toEqual(["putSaveJob:m1", "reserve", "save:m1:0", "acknowledge:m1"]);
  });

  it("resumes an own reservation that was created by an earlier attempt", async () => {
    const h = setup({ initial: { baseRevision: null } });
    h.cloud.seedReservation(PROJECT, makeContent("reserved"));
    h.coordinator.start();
    await flush();
    expect(h.events).toEqual(["putSaveJob:m1", "reserve", "inspectLifecycle", "save:m1:0", "acknowledge:m1"]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("acknowledges a first publish that committed before a reload (same mutationId, no second save)", async () => {
    const h = setup({ initial: { baseRevision: null, localSequence: 1, acknowledgedSequence: 0 } });
    h.cloud.seedReady(PROJECT, 1, makeContent("published"), "job-from-last-session");
    const job: SaveJob = {
      ownerId: OWNER, projectId: PROJECT, mutationId: "job-from-last-session", expectedRevision: 0,
      localSequence: 1, content: makeContent("published"), createdAt: nowIso(),
    };
    h.jobs.jobs.set(KEY, job);
    h.coordinator.resumePersistedJob(job);
    await flush();
    expect(h.events).toEqual(["reserve", "inspectLifecycle", "acknowledge:job-from-last-session"]);
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 1, baseRevision: 1 });
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("reports a conflict when the id is already published by someone else's mutation", async () => {
    const h = setup({ initial: { baseRevision: null } });
    h.cloud.seedReady(PROJECT, 4, makeContent("elsewhere"), "other");
    h.coordinator.start();
    await flush();
    expect(h.coordinator.getStatus()).toEqual({ kind: "conflict", currentRevision: 4 });
    expect(h.cloud.saveRequests).toHaveLength(0);
  });

  it("treats a tombstoned id as unavailable", async () => {
    const h = setup({ initial: { baseRevision: null } });
    h.cloud.seedReady(PROJECT, 2, makeContent("gone"));
    h.cloud.rows.get(PROJECT)!.deletedAt = nowIso();
    h.coordinator.start();
    await flush();
    expect(h.coordinator.getStatus()).toEqual({ kind: "unavailable" });
    expect(h.cloud.saveRequests).toHaveLength(0);
  });

  it("first publish survives a lost save response without a second revision", async () => {
    const h = setup({ initial: { baseRevision: null } });
    h.cloud.on("save", commitThenLoseResponse);
    h.coordinator.start();
    await flush();
    await advance(1000);
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.expectedRevision])).toEqual([["m1", 0], ["m1", 0]]);
    expect(h.cloud.rows.get(PROJECT)!.revision).toBe(1);
    expect(h.jobs.draft.baseRevision).toBe(1);
  });

  it.each<[string, string, Interceptor]>([
    ["listStates throws", "listStates", networkDown],
    ["register network error", "register", async () => ({ status: "error", code: "network", retryable: true })],
    ["upload response lost after the object was stored", "upload", commitThenLoseResponse],
    ["upload network error", "upload", async () => ({ status: "error", code: "network", retryable: true })],
    ["markReady ack lost", "markReady", commitThenLoseResponse],
  ])("%s: never saves with a missing image, then retries successfully", async (_label, method, interceptor) => {
    const h = setup({ initial: { baseRevision: null, content: imageContent() } });
    h.blobs.set("a1", new Blob(["png!"]));
    h.cloud.on(method, interceptor);
    h.coordinator.start();
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(0);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "asset", retryable: true });
    await advance(1000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.cloud.assetStates.get("a1")).toBe("ready");
    expect(h.cloud.saveRequests[0]).toMatchObject({ mutationId: "m1", expectedRevision: 0 });
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("stops on a sha256 mismatch until the user retries", async () => {
    const h = setup({ initial: { baseRevision: null, content: imageContent() } });
    h.blobs.set("a1", new Blob(["png!"]));
    h.cloud.objects.set(assetRef("a1").storagePath, "b".repeat(64));
    h.coordinator.start();
    await flush();
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "asset", retryable: false });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(0);
    expect(h.events.filter((e) => e === "upload:a1")).toHaveLength(1);
    h.cloud.objects.delete(assetRef("a1").storagePath);
    h.coordinator.retry();
    await flush();
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1"]);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("reports a missing local blob without registering or saving", async () => {
    const h = setup();
    h.coordinator.localWriteAcknowledged(1, imageContent());
    await advance(1500);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "error", code: "asset", retryable: false });
    expect(h.events).toEqual(["putSaveJob:m1", "listStates"]);
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(0);
    // Removing the broken image (newer write) creates a new job that can save.
    h.coordinator.localWriteAcknowledged(2, makeContent("fixed"));
    await advance(1500);
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.expectedRevision])).toEqual([["m2", 1]]);
  });

  it("pauses for auth during an upload", async () => {
    const h = setup({ initial: { baseRevision: null, content: imageContent() } });
    h.blobs.set("a1", new Blob(["png!"]));
    h.cloud.on("upload", async () => ({ status: "error", code: "auth", retryable: false }));
    h.coordinator.start();
    await flush();
    expect(h.coordinator.getStatus()).toEqual({ kind: "auth" });
    h.coordinator.authRestored(OWNER);
    await flush();
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });
});

describe("save coordinator: blockers, saveNow, stop, resume", () => {
  it.each(["pendingEdit", "gesture"] as const)("waits while %s is active and never shows saved meanwhile (PST-03)", async (reason) => {
    const h = setup();
    h.coordinator.setBlocked(reason, true);
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(10_000);
    expect(h.cloud.saveRequests).toHaveLength(0);
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    h.coordinator.setBlocked(reason, false);
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("needs every blocker released", async () => {
    const h = setup();
    h.coordinator.setBlocked("pendingEdit", true);
    h.coordinator.setBlocked("gesture", true);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(2000);
    h.coordinator.setBlocked("gesture", false);
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(0);
    h.coordinator.setBlocked("pendingEdit", false);
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(1);
  });

  it("saveNow skips the debounce and resolves saved", async () => {
    const h = setup();
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    const result = h.coordinator.saveNow();
    await flush();
    expect(h.cloud.saveTimes).toEqual([Date.now()]);
    await expect(result).resolves.toMatchObject({ kind: "saved" });
  });

  it("saveNow during an older in-flight job waits for it, then sends the latest immediately", async () => {
    const h = setup();
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    const first = h.coordinator.saveNow();
    await flush();
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    let secondResult: CloudStatus | null = null;
    void h.coordinator.saveNow().then((status) => {
      secondResult = status;
    });
    await flush();
    expect(h.cloud.saveRequests).toHaveLength(1);
    gate.resolve();
    await flush();
    await expect(first).resolves.toBeDefined();
    expect(h.cloud.saveRequests.map((r) => [r.mutationId, r.content.title])).toEqual([["m1", "c1"], ["m2", "c2"]]);
    expect(secondResult).toMatchObject({ kind: "saved" });
  });

  it("saveNow resolves with the failure status instead of hanging", async () => {
    const h = setup();
    h.cloud.on("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await expect(h.coordinator.saveNow()).resolves.toMatchObject({ kind: "error", code: "network", retryable: true });
    h.net.online = false;
    h.coordinator.setOnline(false);
    await expect(h.coordinator.saveNow()).resolves.toEqual({ kind: "offline" });
  });

  it("saveNow skips a pending backoff wait and waits for blockers", async () => {
    const h = setup();
    h.cloud.on("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    const retried = h.coordinator.saveNow();
    await expect(retried).resolves.toMatchObject({ kind: "saved" });
    expect(h.cloud.saveRequests.map((r) => r.mutationId)).toEqual(["m1", "m1"]);

    h.coordinator.setBlocked("pendingEdit", true);
    h.coordinator.localWriteAcknowledged(2, makeContent("c2"));
    let settled = false;
    const blocked = h.coordinator.saveNow().then((status) => {
      settled = true;
      return status;
    });
    await advance(5000);
    expect(settled).toBe(false);
    h.coordinator.setBlocked("pendingEdit", false);
    await expect(blocked).resolves.toMatchObject({ kind: "saved" });
  });

  it("saveNow with nothing to save resolves immediately", async () => {
    const h = setup();
    await expect(h.coordinator.saveNow()).resolves.toMatchObject({ kind: "saved" });
    expect(h.events).toEqual([]);
  });

  it("stop() cancels retries but keeps the persisted job", async () => {
    const h = setup();
    h.cloud.always("save", networkDown);
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    h.coordinator.stop();
    expect(h.coordinator.getStatus()).toEqual({ kind: "stopped" });
    await advance(120_000);
    expect(h.cloud.saveRequests).toHaveLength(1);
    expect(h.jobs.jobs.get(KEY)?.mutationId).toBe("m1");
  });

  it("stop() during a first publish makes no further network calls", async () => {
    const h = setup({ initial: { baseRevision: null } });
    const gate = deferred();
    h.cloud.on("reserve", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.start();
    await flush();
    const idle = h.coordinator.whenIdle();
    h.coordinator.stop();
    gate.resolve();
    await idle;
    await advance(60_000);
    expect(h.events).toEqual(["putSaveJob:m1", "reserve"]);
    expect(h.jobs.jobs.get(KEY)?.expectedRevision).toBe(0);
  });

  it("still acknowledges an in-flight save that succeeds after stop()", async () => {
    const h = setup();
    const gate = deferred();
    h.cloud.on("save", async (real) => {
      await gate.promise;
      return real();
    });
    h.coordinator.localWriteAcknowledged(1, makeContent("c1"));
    await advance(1500);
    h.coordinator.stop();
    gate.resolve();
    await h.coordinator.whenIdle();
    await flush();
    expect(h.jobs.jobs.size).toBe(0);
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 1, baseRevision: 2 });
    expect(h.coordinator.getStatus()).toEqual({ kind: "stopped" });
  });

  it("resumePersistedJob replays the exact job first, ignoring debounce and blockers, then syncs newer work", async () => {
    const h = setup({ initial: { baseRevision: 1, localSequence: 4, acknowledgedSequence: 2, content: makeContent("c4") } });
    // The job committed on the server before the crash; its response never arrived.
    h.cloud.seedReady(PROJECT, 2, makeContent("c3"), "persisted-1");
    const job: SaveJob = {
      ownerId: OWNER, projectId: PROJECT, mutationId: "persisted-1", expectedRevision: 1,
      localSequence: 3, content: makeContent("c3"), createdAt: nowIso(),
    };
    h.jobs.jobs.set(KEY, job);
    h.coordinator.setBlocked("gesture", true);
    h.coordinator.resumePersistedJob(job);
    await flush();
    expect(h.events).toEqual(["save:persisted-1:1", "acknowledge:persisted-1"]);
    expect(h.cloud.rows.get(PROJECT)!.revision).toBe(2);
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 3, baseRevision: 2 });
    expect(h.coordinator.getStatus()).toEqual({ kind: "pending" });
    h.coordinator.setBlocked("gesture", false);
    await flush();
    expect(h.cloud.saveRequests.at(-1)).toMatchObject({ mutationId: "m1", expectedRevision: 2, content: { title: "c4" } });
    expect(h.jobs.draft).toEqual({ acknowledgedSequence: 4, baseRevision: 3 });
    expect(h.coordinator.getStatus()).toMatchObject({ kind: "saved" });
  });

  it("rejects a persisted job of another owner/project and a second concurrent job", () => {
    const h = setup();
    const job: SaveJob = {
      ownerId: "owner-2", projectId: PROJECT, mutationId: "x", expectedRevision: 1, localSequence: 1,
      content: makeContent("x"), createdAt: nowIso(),
    };
    expect(() => h.coordinator.resumePersistedJob(job)).toThrow();
    h.coordinator.resumePersistedJob({ ...job, ownerId: OWNER });
    expect(() => h.coordinator.resumePersistedJob({ ...job, ownerId: OWNER })).not.toThrow();
    expect(() => h.coordinator.resumePersistedJob({ ...job, ownerId: OWNER, mutationId: "y" })).toThrow();
  });
});
