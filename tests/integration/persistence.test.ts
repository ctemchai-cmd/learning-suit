import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseAssetStore } from "../../src/services/persistence/supabase-assets";
import { SupabaseProjectRepository } from "../../src/services/persistence/supabase-repository";
import {
  assetFor,
  blobSha256,
  BUCKET,
  contentWith,
  createFixtureUser,
  destroyFixtureUser,
  type FixtureUser,
  hasIntegrationEnv,
  loseResponseOnce,
  PNG_BLACK,
  PNG_RED,
  pngBlob,
  signIn,
} from "./support";

// PST-04/05/07/09/12 through the real adapters against a local Supabase stack. "Another device" is a
// second, independent session of the same account.

describe.skipIf(!hasIntegrationEnv)("persistence flows (local Supabase)", () => {
  let a: FixtureUser;

  beforeAll(async () => {
    a = await createFixtureUser("pst-a");
  });

  afterAll(async () => {
    await destroyFixtureUser(a);
  });

  it("PST-04: reserve -> metadata -> upload -> ready -> save; other devices never see the blank reservation", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const assets = new SupabaseAssetStore(a.client, a.id);
    const otherDevice = new SupabaseProjectRepository(await signIn(a));
    const [projectId, slideId] = [crypto.randomUUID(), crypto.randomUUID()];

    expect(await repository.reserve({ projectId, title: "With image", initialSlideId: slideId })).toEqual({ status: "reserved", revision: 0 });
    expect((await otherDevice.list()).map((summary) => summary.id)).not.toContain(projectId);
    expect(await otherDevice.load(projectId)).toBeNull();
    expect(await otherDevice.inspectLifecycle(projectId)).toEqual({ revision: 0, isReady: false, deletedAt: null, lastMutationId: null });

    const asset = await assetFor(a.id, projectId, PNG_RED);
    expect(await assets.register(projectId, asset)).toEqual({ status: "ok" });
    expect(await assets.upload(asset, pngBlob(PNG_RED))).toEqual({ status: "ok" });
    expect(await assets.markReady(projectId, asset.id)).toEqual({ status: "ok" });
    expect(await assets.listStates(projectId)).toEqual({ [asset.id]: "ready" });

    const content = contentWith(slideId, [asset], "With image");
    const mutationId = crypto.randomUUID();
    const saved = await repository.save({ projectId, expectedRevision: 0, mutationId, content });
    expect(saved).toMatchObject({ status: "saved", revision: 1, mutationId });

    const summaries = await otherDevice.list();
    expect(summaries.find((summary) => summary.id === projectId)).toMatchObject({ ownerId: a.id, title: "With image", revision: 1 });
    const loaded = await otherDevice.load(projectId);
    expect(loaded?.document).toEqual(content.document);
    expect(loaded?.lastMutationId).toBe(mutationId);
    const bytes = await new SupabaseAssetStore(await signIn(a), a.id).download(asset);
    expect(await blobSha256(bytes)).toBe(asset.sha256);

    // Re-reserving after a timed-out create resumes instead of overwriting.
    const again = await repository.reserve({ projectId, title: "ignored", initialSlideId: crypto.randomUUID() });
    expect(again).toMatchObject({ status: "existing", record: { id: projectId, revision: 1, title: "With image" } });
  });

  it("PST-05: every asset step survives a lost acknowledgement and never publishes a missing image", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const assets = new SupabaseAssetStore(a.client, a.id);
    const [projectId, slideId] = [crypto.randomUUID(), crypto.randomUUID()];
    await repository.reserve({ projectId, title: "Flaky network", initialSlideId: slideId });
    const asset = await assetFor(a.id, projectId, PNG_RED);

    // register: insert committed, response lost -> retry sees the identical row.
    const lostInsert = loseResponseOnce((url, method) => method === "POST" && url.includes("/rest/v1/project_assets"));
    expect(await new SupabaseAssetStore(await signIn(a, lostInsert.fetch), a.id).register(projectId, asset))
      .toEqual({ status: "error", code: "network", retryable: true });
    expect(lostInsert.fired()).toBe(true);
    expect(await assets.register(projectId, asset)).toEqual({ status: "ok" });

    // upload: object stored, response lost -> retry hits "already exists", verifies sha256.
    const lostUpload = loseResponseOnce((url, method) => method === "POST" && url.includes(`/storage/v1/object/${BUCKET}/`));
    expect(await new SupabaseAssetStore(await signIn(a, lostUpload.fetch), a.id).upload(asset, pngBlob(PNG_RED)))
      .toEqual({ status: "error", code: "network", retryable: true });
    expect(lostUpload.fired()).toBe(true);
    expect(await assets.upload(asset, pngBlob(PNG_RED))).toEqual({ status: "ok" });

    // Saving before the metadata is ready is refused: no document may reference a pending image.
    const content = contentWith(slideId, [asset], "Flaky network");
    expect(await repository.save({ projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content }))
      .toEqual({ status: "error", code: "validation", retryable: false });

    // markReady: update committed, response lost -> retry is idempotent.
    const lostReady = loseResponseOnce((url, method) => method === "PATCH" && url.includes("/rest/v1/project_assets"));
    expect(await new SupabaseAssetStore(await signIn(a, lostReady.fetch), a.id).markReady(projectId, asset.id))
      .toEqual({ status: "error", code: "network", retryable: true });
    expect(await assets.markReady(projectId, asset.id)).toEqual({ status: "ok" });

    expect(await repository.save({ projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content }))
      .toMatchObject({ status: "saved", revision: 1 });
  });

  it("PST-05: a different file already stored under an asset path is a mismatch, not success", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const assets = new SupabaseAssetStore(a.client, a.id);
    const projectId = crypto.randomUUID();
    await repository.reserve({ projectId, title: "Mismatch", initialSlideId: crypto.randomUUID() });
    const asset = await assetFor(a.id, projectId, PNG_RED);
    expect(await assets.register(projectId, asset)).toEqual({ status: "ok" });
    // Bypass the adapter's local hash check to plant other bytes at the path.
    const planted = await a.client.storage.from(BUCKET).upload(asset.storagePath, pngBlob(PNG_BLACK), { upsert: false, contentType: "image/png" });
    expect(planted.error).toBeNull();
    expect(await assets.upload(asset, pngBlob(PNG_RED))).toEqual({ status: "error", code: "mismatch", retryable: false });
  });

  it("PST-07: a committed save whose response was lost is replayed, not re-applied; a stale retry conflicts", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const [projectId, slideId] = [crypto.randomUUID(), crypto.randomUUID()];
    await repository.reserve({ projectId, title: "Retry", initialSlideId: slideId });
    const request = { projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Retry v1") };

    const lost = loseResponseOnce((url, method) => method === "POST" && url.includes("/rest/v1/rpc/save_project"));
    expect(await new SupabaseProjectRepository(await signIn(a, lost.fetch)).save(request))
      .toEqual({ status: "error", code: "network", retryable: true });
    expect(lost.fired()).toBe(true);
    expect(await repository.inspectLifecycle(projectId)).toMatchObject({ revision: 1, lastMutationId: request.mutationId });

    expect(await repository.save(request)).toMatchObject({ status: "saved", revision: 1, mutationId: request.mutationId });
    expect(await repository.inspectLifecycle(projectId)).toMatchObject({ revision: 1 });

    const otherDevice = new SupabaseProjectRepository(await signIn(a));
    expect(await otherDevice.save({ projectId, expectedRevision: 1, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Other device") }))
      .toMatchObject({ status: "saved", revision: 2 });
    expect(await repository.save(request)).toEqual({ status: "conflict", currentRevision: 2 });
    expect((await repository.load(projectId))?.title).toBe("Other device");
  });

  it("PST-09: two devices saving on the same revision in parallel: one saved, one conflict", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const [projectId, slideId] = [crypto.randomUUID(), crypto.randomUUID()];
    await repository.reserve({ projectId, title: "Race", initialSlideId: slideId });
    expect((await repository.save({ projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Race") })).status)
      .toBe("saved");

    const [device1, device2] = [new SupabaseProjectRepository(await signIn(a)), new SupabaseProjectRepository(await signIn(a))];
    const results = await Promise.all([
      device1.save({ projectId, expectedRevision: 1, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Device 1") }),
      device2.save({ projectId, expectedRevision: 1, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Device 2") }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
    expect(results.find((result) => result.status === "conflict")).toEqual({ status: "conflict", currentRevision: 2 });
    const winner = results.findIndex((result) => result.status === "saved");
    const loaded = await repository.load(projectId);
    expect(loaded?.revision).toBe(2);
    expect(loaded?.title).toBe(winner === 0 ? "Device 1" : "Device 2");
  });

  it("PST-12: tombstone (idempotent), rejected saves, storage cleanup, purge", async () => {
    const repository = new SupabaseProjectRepository(a.client);
    const assets = new SupabaseAssetStore(a.client, a.id);
    const [projectId, slideId] = [crypto.randomUUID(), crypto.randomUUID()];
    await repository.reserve({ projectId, title: "Doomed", initialSlideId: slideId });
    const asset = await assetFor(a.id, projectId, PNG_RED);
    await assets.register(projectId, asset);
    await assets.upload(asset, pngBlob(PNG_RED));
    await assets.markReady(projectId, asset.id);
    expect((await repository.save({ projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(slideId, [asset], "Doomed") })).status)
      .toBe("saved");

    const deleteRequest = { projectId, expectedRevision: 1, mutationId: crypto.randomUUID() };
    expect(await repository.markDeleted({ ...deleteRequest, expectedRevision: 0 })).toEqual({ status: "conflict", currentRevision: 1 });
    expect(await repository.markDeleted(deleteRequest)).toMatchObject({ status: "saved", revision: 2 });
    expect(await repository.markDeleted(deleteRequest)).toMatchObject({ status: "saved", revision: 2 });

    // A concurrent/late save cannot revive the project.
    expect(await repository.save({ projectId, expectedRevision: 2, mutationId: crypto.randomUUID(), content: contentWith(slideId, [], "Revived") }))
      .toEqual({ status: "unavailable" });
    expect((await repository.list()).map((summary) => summary.id)).not.toContain(projectId);
    expect(await repository.load(projectId)).toBeNull();
    expect(await repository.inspectLifecycle(projectId)).toMatchObject({ revision: 2, deletedAt: expect.any(String) });

    await assets.removeProjectObjects(a.id, projectId);
    await expect(assets.download(asset)).rejects.toMatchObject({ reason: "not_found" });
    await repository.purge(projectId);
    expect(await repository.inspectLifecycle(projectId)).toBeNull();
  });
});
