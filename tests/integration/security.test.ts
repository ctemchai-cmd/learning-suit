import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseAssetStore } from "../../src/services/persistence/supabase-assets";
import { SupabaseProjectRepository } from "../../src/services/persistence/supabase-repository";
import {
  anonClient,
  assetFor,
  blobSha256,
  BUCKET,
  contentWith,
  createFixtureUser,
  destroyFixtureUser,
  type FixtureUser,
  hasIntegrationEnv,
  PNG_BLACK,
  PNG_RED,
  pngBlob,
} from "./support";

// SEC-01..05 against a real local Supabase stack, calling REST/RPC/Storage directly as users A, B and
// anonymous (UI-independent). Never uses the service role for assertions.

describe.skipIf(!hasIntegrationEnv)("security (local Supabase)", () => {
  let a: FixtureUser;
  let b: FixtureUser;
  let anon: SupabaseClient;

  beforeAll(async () => {
    a = await createFixtureUser("sec-a");
    b = await createFixtureUser("sec-b");
    anon = anonClient();
  });

  afterAll(async () => {
    await destroyFixtureUser(a);
    await destroyFixtureUser(b);
  });

  const emptyDocument = () => contentWith(crypto.randomUUID()).document;

  describe("SEC-01: owner CRUD, B and anon isolated", () => {
    const projectId = crypto.randomUUID();

    it("A creates, reads and updates the own project through REST", async () => {
      const inserted = await a.client.from("projects").insert({ id: projectId, owner_id: a.id, title: "A lesson", document: emptyDocument() });
      expect(inserted.error).toBeNull();

      const read = await a.client.from("projects").select("id, title, revision").eq("id", projectId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id: projectId, title: "A lesson", revision: 0 }]);

      const updated = await a.client.from("projects")
        .update({ title: "A renamed", revision: 1, last_mutation_id: crypto.randomUUID() })
        .eq("id", projectId).select("id");
      expect(updated.error).toBeNull();
      expect(updated.data).toHaveLength(1);
    });

    it("B cannot read, update or delete A's project", async () => {
      const read = await b.client.from("projects").select("id").eq("id", projectId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);

      const updated = await b.client.from("projects").update({ title: "B was here", revision: 2 }).eq("id", projectId).select("id");
      expect(updated.data ?? []).toEqual([]);

      const deleted = await b.client.from("projects").delete().eq("id", projectId).select("id");
      expect(deleted.data ?? []).toEqual([]);

      const check = await a.client.from("projects").select("title, revision").eq("id", projectId).single();
      expect(check.data).toEqual({ title: "A renamed", revision: 1 });
    });

    it("anonymous requests cannot read or write application rows", async () => {
      const read = await anon.from("projects").select("id");
      expect(read.error).not.toBeNull();
      expect([401, 403]).toContain(read.status);

      const inserted = await anon.from("projects").insert({ id: crypto.randomUUID(), owner_id: a.id, title: "anon", document: emptyDocument() });
      expect(inserted.error).not.toBeNull();

      const assets = await anon.from("project_assets").select("id");
      expect(assets.error).not.toBeNull();
    });

    it("A can hard-delete only after tombstoning", async () => {
      const live = await a.client.from("projects").delete().eq("id", projectId).select("id");
      expect(live.data ?? []).toEqual([]);
      const tombstoned = await a.client.from("projects")
        .update({ deleted_at: new Date().toISOString(), revision: 2, last_mutation_id: crypto.randomUUID() })
        .eq("id", projectId).select("id");
      expect(tombstoned.data).toHaveLength(1);
      const deleted = await a.client.from("projects").delete().eq("id", projectId).select("id");
      expect(deleted.data).toHaveLength(1);
    });
  });

  describe("SEC-02: forged owners and moved assets are rejected", () => {
    it("rejects INSERT with another owner's id and UPDATE of owner_id", async () => {
      const forged = await a.client.from("projects").insert({ id: crypto.randomUUID(), owner_id: b.id, title: "forged", document: emptyDocument() });
      expect(forged.error?.code).toBe("42501");

      const projectId = crypto.randomUUID();
      expect((await new SupabaseProjectRepository(a.client).reserve({ projectId, title: "own", initialSlideId: crypto.randomUUID() })).status).toBe("reserved");
      const moved = await a.client.from("projects").update({ owner_id: b.id }).eq("id", projectId);
      expect(moved.error?.code).toBe("42501");
    });

    it("rejects moving an asset to another project or path, and non-canonical paths", async () => {
      const repository = new SupabaseProjectRepository(a.client);
      const assets = new SupabaseAssetStore(a.client, a.id);
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      await repository.reserve({ projectId: first, title: "first", initialSlideId: crypto.randomUUID() });
      await repository.reserve({ projectId: second, title: "second", initialSlideId: crypto.randomUUID() });
      const asset = await assetFor(a.id, first, PNG_RED);
      expect(await assets.register(first, asset)).toEqual({ status: "ok" });

      const moveProject = await a.client.from("project_assets").update({ project_id: second }).eq("id", asset.id);
      expect(moveProject.error?.code).toBe("42501");
      const movePath = await a.client.from("project_assets")
        .update({ storage_path: `${a.id}/${second}/${asset.id}.png` }).eq("id", asset.id);
      expect(movePath.error?.code).toBe("42501");

      const foreignPrefix = await a.client.from("project_assets").insert({
        id: crypto.randomUUID(), project_id: first, storage_path: `${b.id}/${first}/x.png`, mime_type: "image/png",
        width: 1, height: 1, byte_length: PNG_RED.byteLength, sha256: asset.sha256,
      });
      expect(foreignPrefix.error).not.toBeNull();
    });
  });

  describe("SEC-03: private bucket", () => {
    let path: string;

    beforeAll(async () => {
      const repository = new SupabaseProjectRepository(a.client);
      const assets = new SupabaseAssetStore(a.client, a.id);
      const projectId = crypto.randomUUID();
      await repository.reserve({ projectId, title: "storage", initialSlideId: crypto.randomUUID() });
      const asset = await assetFor(a.id, projectId, PNG_RED);
      expect(await assets.register(projectId, asset)).toEqual({ status: "ok" });
      expect(await assets.upload(asset, pngBlob(PNG_RED))).toEqual({ status: "ok" });
      path = asset.storagePath;
    });

    it("A downloads the own object", async () => {
      const { data, error } = await a.client.storage.from(BUCKET).download(path);
      expect(error).toBeNull();
      expect(await blobSha256(data as Blob)).toBe(await blobSha256(pngBlob(PNG_RED)));
    });

    it("B and anon cannot download, sign, list or delete it", async () => {
      for (const client of [b.client, anon]) {
        expect((await client.storage.from(BUCKET).download(path)).error).not.toBeNull();
        expect((await client.storage.from(BUCKET).createSignedUrl(path, 60)).error).not.toBeNull();
        const listed = await client.storage.from(BUCKET).list(path.split("/").slice(0, 2).join("/"));
        expect(listed.data ?? []).toEqual([]);
        await client.storage.from(BUCKET).remove([path]);
      }
      expect((await a.client.storage.from(BUCKET).download(path)).error).toBeNull();
    });

    it("the public URL does not serve the private object", async () => {
      const { data } = anon.storage.from(BUCKET).getPublicUrl(path);
      const response = await fetch(data.publicUrl);
      expect(response.ok).toBe(false);
    });

    it("B cannot upload into A's path and nobody can overwrite (no upsert)", async () => {
      const intrusion = await b.client.storage.from(BUCKET).upload(path, pngBlob(PNG_BLACK), { upsert: false, contentType: "image/png" });
      expect(intrusion.error).not.toBeNull();
      const overwrite = await a.client.storage.from(BUCKET).upload(path, pngBlob(PNG_BLACK), { upsert: true, contentType: "image/png" });
      expect(overwrite.error).not.toBeNull();
      const { data } = await a.client.storage.from(BUCKET).download(path);
      expect(await blobSha256(data as Blob)).toBe(await blobSha256(pngBlob(PNG_RED)));
    });
  });

  describe("SEC-04: RPC ownership and no existence leak", () => {
    it("B gets identical `unavailable` results for A's project and a nonexistent id", async () => {
      const projectId = crypto.randomUUID();
      const slideId = crypto.randomUUID();
      const repository = new SupabaseProjectRepository(a.client);
      await repository.reserve({ projectId, title: "private", initialSlideId: slideId });
      expect((await repository.save({ projectId, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(slideId) })).status).toBe("saved");

      const args = (id: string) => ({
        p_project_id: id, p_expected_revision: 1, p_mutation_id: crypto.randomUUID(),
        p_title: "B", p_document: contentWith(slideId).document,
      });
      const onA = await b.client.rpc("save_project", args(projectId));
      const onMissing = await b.client.rpc("save_project", args(crypto.randomUUID()));
      expect(onA.data).toEqual({ status: "unavailable" });
      expect(onMissing.data).toEqual(onA.data);

      const del = await b.client.rpc("mark_project_deleted", { p_project_id: projectId, p_expected_revision: 1, p_mutation_id: crypto.randomUUID() });
      expect(del.data).toEqual({ status: "unavailable" });
      const reserve = await b.client.rpc("reserve_project", { p_id: projectId, p_title: "B", p_initial_slide_id: slideId });
      expect(reserve.data).toEqual({ status: "unavailable" });

      const lifecycle = await new SupabaseProjectRepository(a.client).inspectLifecycle(projectId);
      expect(lifecycle).toMatchObject({ revision: 1, isReady: true, deletedAt: null });
    });

    it("anonymous callers cannot execute the RPCs", async () => {
      const result = await anon.rpc("save_project", {
        p_project_id: crypto.randomUUID(), p_expected_revision: 0, p_mutation_id: crypto.randomUUID(),
        p_title: "anon", p_document: emptyDocument(),
      });
      expect(result.error).not.toBeNull();
      expect([401, 403]).toContain(result.status);
    });
  });

  describe("SEC-05: asset references and deleted projects", () => {
    it("rejects cross-project references, fake-ready assets and saves into deleted projects", async () => {
      const repository = new SupabaseProjectRepository(a.client);
      const assets = new SupabaseAssetStore(a.client, a.id);
      const [p1, p2, s1, s2] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await repository.reserve({ projectId: p1, title: "one", initialSlideId: s1 });
      await repository.reserve({ projectId: p2, title: "two", initialSlideId: s2 });

      const real = await assetFor(a.id, p1, PNG_RED);
      expect(await assets.register(p1, real)).toEqual({ status: "ok" });
      expect(await assets.upload(real, pngBlob(PNG_RED))).toEqual({ status: "ok" });
      expect(await assets.markReady(p1, real.id)).toEqual({ status: "ok" });
      expect((await repository.save({ projectId: p1, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(s1, [real]) })).status)
        .toBe("saved");

      // p2 referencing p1's asset (original path, then re-pathed into p2).
      expect(await repository.save({ projectId: p2, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(s2, [real]) }))
        .toEqual({ status: "error", code: "validation", retryable: false });
      const repathed = { ...real, storagePath: `${a.id}/${p2}/${real.id}.png` };
      expect(await repository.save({ projectId: p2, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(s2, [repathed]) }))
        .toEqual({ status: "error", code: "validation", retryable: false });

      // Metadata marked ready without uploading bytes.
      const fake = await assetFor(a.id, p2, PNG_BLACK);
      expect(await assets.register(p2, fake)).toEqual({ status: "ok" });
      expect(await assets.markReady(p2, fake.id)).toEqual({ status: "ok" });
      expect(await repository.save({ projectId: p2, expectedRevision: 0, mutationId: crypto.randomUUID(), content: contentWith(s2, [fake]) }))
        .toEqual({ status: "error", code: "validation", retryable: false });
      expect(await repository.inspectLifecycle(p2)).toMatchObject({ revision: 0, isReady: false });

      // Deleted project.
      expect((await repository.markDeleted({ projectId: p1, expectedRevision: 1, mutationId: crypto.randomUUID() })).status).toBe("saved");
      expect(await repository.save({ projectId: p1, expectedRevision: 2, mutationId: crypto.randomUUID(), content: contentWith(s1, [real]) }))
        .toEqual({ status: "unavailable" });
    });
  });
});
