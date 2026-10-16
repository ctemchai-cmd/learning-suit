import { describe, expect, it, vi } from "vitest";
import { createIdentityGuard, IDENTITY_CACHE_TTL_MS } from "./identity-guard";

type Listener = (event: string, session: { user: { id: string } } | null) => void;

function fakeClient(sub: () => string | null | Error = () => "owner-1") {
  const listeners: Listener[] = [];
  let gate: Promise<void> | null = null;
  const getClaims = vi.fn(async () => {
    if (gate) await gate;
    const value = sub();
    if (value instanceof Error) throw value;
    return value === null ? { data: null, error: new Error("no session") } : { data: { claims: { sub: value } }, error: null };
  });
  const client = {
    auth: {
      getClaims,
      onAuthStateChange: (listener: Listener) => { listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  return {
    client: client as never, getClaims, emit: (event: string, id: string | null) => listeners.forEach((l) => l(event, id ? { user: { id } } : null)),
    hold: () => { let open!: () => void; gate = new Promise<void>((r) => { open = r; }); return () => { gate = null; open(); }; },
  };
}

describe("identity guard", () => {
  it("reads reuse a recent positive check: ten image downloads cost one getClaims", async () => {
    const f = fakeClient();
    const guard = createIdentityGuard(f.client, "owner-1");
    const results = await Promise.all(Array.from({ length: 10 }, () => guard.cached()));
    expect(results.every(Boolean)).toBe(true);
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(1);
  });

  it("the cached answer expires after the TTL and is checked again", async () => {
    const f = fakeClient();
    let now = 1_000;
    const guard = createIdentityGuard(f.client, "owner-1", { now: () => now });
    await guard.cached();
    now += IDENTITY_CACHE_TTL_MS - 1;
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(1);
    now += 2;
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(2);
  });

  it("writes never use the cached answer", async () => {
    const f = fakeClient();
    const guard = createIdentityGuard(f.client, "owner-1");
    await guard.cached();
    await guard.fresh();
    await guard.fresh();
    expect(f.getClaims).toHaveBeenCalledTimes(3);
  });

  it("sign-out, or another account signing in, invalidates the cache at once", async () => {
    let sub: string | null = "owner-1";
    const f = fakeClient(() => sub);
    const guard = createIdentityGuard(f.client, "owner-1");
    expect(await guard.cached()).toBe(true);
    sub = null;
    f.emit("SIGNED_OUT", null);
    expect(await guard.cached()).toBe(false);
    sub = "owner-2";
    expect(await guard.cached()).toBe(false);

    sub = "owner-1";
    expect(await guard.cached()).toBe(true);
    sub = "owner-2";
    f.emit("SIGNED_IN", "owner-2");
    expect(await guard.cached()).toBe(false);
    expect(f.getClaims).toHaveBeenCalledTimes(5);
  });

  it("events for the same account (token refresh) keep the cache", async () => {
    const f = fakeClient();
    const guard = createIdentityGuard(f.client, "owner-1");
    await guard.cached();
    f.emit("TOKEN_REFRESHED", "owner-1");
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(1);
  });

  it("a negative or failed check is never remembered", async () => {
    let sub: string | null | Error = new Error("network");
    const f = fakeClient(() => sub);
    const guard = createIdentityGuard(f.client, "owner-1");
    expect(await guard.cached()).toBe(false);
    sub = "owner-2";
    expect(await guard.cached()).toBe(false);
    sub = "owner-1";
    expect(await guard.cached()).toBe(true);
    expect(f.getClaims).toHaveBeenCalledTimes(3);
  });

  it("an answer that was in flight when the account changed is not remembered", async () => {
    const f = fakeClient();
    const guard = createIdentityGuard(f.client, "owner-1");
    const release = f.hold();
    const pending = guard.cached();
    f.emit("SIGNED_IN", "owner-2");
    release();
    expect(await pending).toBe(true);
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(2);
  });

  it("cross-tab hints (storage / focus / visibilitychange) drop the cached answer before onAuthStateChange arrives", async () => {
    for (const type of ["storage", "focus", "visibilitychange"]) {
      const f = fakeClient();
      const signals = new EventTarget();
      const guard = createIdentityGuard(f.client, "owner-1", { signals });
      await guard.cached();
      await guard.cached();
      expect(f.getClaims).toHaveBeenCalledTimes(1);
      signals.dispatchEvent(new Event(type));
      await guard.cached();
      expect(f.getClaims).toHaveBeenCalledTimes(2);
    }
  });

  it("an answer in flight when a cross-tab hint arrives is not remembered", async () => {
    const f = fakeClient();
    const signals = new EventTarget();
    const guard = createIdentityGuard(f.client, "owner-1", { signals });
    const release = f.hold();
    const pending = guard.cached();
    signals.dispatchEvent(new Event("storage"));
    release();
    await pending;
    await guard.cached();
    expect(f.getClaims).toHaveBeenCalledTimes(2);
  });

  it("guards for different owners on one client do not share answers", async () => {
    const f = fakeClient(() => "owner-1");
    const a = createIdentityGuard(f.client, "owner-1");
    const b = createIdentityGuard(f.client, "owner-2");
    expect(await a.cached()).toBe(true);
    expect(await b.cached()).toBe(false);
  });
});
