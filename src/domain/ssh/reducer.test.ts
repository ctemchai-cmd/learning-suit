import { describe, expect, it } from "vitest";
import { createInitialSshState } from "./initial";
import type { SshAction, SshState, SshView } from "./model";
import { applySshAction } from "./reducer";
import { normalizeSshView } from "./model";

function play(state: SshState, view: SshView, ...actions: SshAction[]): SshState {
  return actions.reduce((current, action) => applySshAction(current, action, view).nextState, state);
}
const route = (state: SshState, action: SshAction, view: SshView) =>
  applySshAction(state, action, view).frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`);
const A = "a" as const, B = "b" as const;
const keyed = (view: SshView = "setup") => play(createInitialSshState(), view, { type: "keygen", machine: A });
const registered = (view: SshView = "setup") => play(keyed(view), view, { type: "register", machine: A });

describe("SSH-01 — step 1: no key, no entry", () => {
  it("git push without any key is blocked at the scanner with Permission denied (publickey)", () => {
    const start = createInitialSshState();
    expect(route(start, { type: "push", machine: A }, "setup")).toEqual(["a→scanner:request", "scanner→a:blocked"]);
    const result = applySshAction(start, { type: "push", machine: A }, "setup");
    expect(result.outcome).toBe("failed");
    expect(result.frames.at(-1)!.caption).toContain("Permission denied (publickey)");
    expect(result.frames.at(-1)!.marks).toContainEqual({ spot: "scanner", tone: "blocked" });
    expect(result.nextState.pushes).toBe(0);
    expect(result.message).toContain("สร้างคู่กุญแจ");
  });
});

describe("SSH-02 — step 2: key pair", () => {
  it("ssh-keygen creates the private key and then the public key; a second run does nothing", () => {
    const result = applySshAction(createInitialSshState(), { type: "keygen", machine: A }, "setup");
    expect(result.frames.map((frame) => [frame.state.a.priv, frame.state.a.pub])).toEqual([[false, false], [true, false], [true, true], [true, true]]);
    // The public key is computed FROM the private key (one way), shown as a move inside ~/.ssh.
    expect(result.frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`)).toEqual([null, null, "priv→pub:ok", null]);
    expect(result.frames[2].caption).toContain("คำนวณ .pub ออกมาจากกุญแจลับ: ทางเดียว");
    expect(result.frames[2].caption).toContain("ย้อนกลับไปหากุญแจลับไม่ได้");
    expect(result.nextState.a.cmd).toBe('ssh-keygen -t ed25519 -C "you@example.com"');
    expect(result.outcome).toBe("success");
    expect(applySshAction(result.nextState, { type: "keygen", machine: A }, "setup").outcome).toBe("noop");
  });
});

describe("SSH-03 — step 3: register", () => {
  it("is rejected without a key; with a key the .pub travels to the SSH keys list", () => {
    const rejected = applySshAction(createInitialSshState(), { type: "register", machine: A }, "setup");
    expect(rejected).toMatchObject({ outcome: "rejected", changed: false, frames: [] });
    expect(rejected.message).toContain("สร้างคู่กุญแจ");
    const result = applySshAction(keyed(), { type: "register", machine: A }, "setup");
    expect(route(keyed(), { type: "register", machine: A }, "setup")).toEqual([null, "pub→keys:data", null]);
    expect(result.frames[1].hop!.detail?.some((line) => line.text.startsWith("ssh-ed25519"))).toBe(true);
    expect(result.nextState.registered).toEqual([A]);
    expect(applySshAction(result.nextState, { type: "register", machine: A }, "setup").outcome).toBe("noop");
  });
});

describe("SSH-04 — step 4: connect", () => {
  it("the door asks for a touch (one-time number), the laptop makes the scan result with the private key, the registered .pub checks it", () => {
    const state = registered();
    expect(route(state, { type: "test", machine: A }, "setup")).toEqual(["a→scanner:request", "github→a:request", null, "a→scanner:data", null, "scanner→a:ok"]);
    const result = applySshAction(state, { type: "test", machine: A }, "setup");
    expect(result.outcome).toBe("success");
    expect(result.nextState.a.out.join(" ")).toContain("Hi you!");
    expect(result.frames[1].hop!.label).toBe("ขอแตะนิ้ว");
    expect(result.frames[2].marks).toContainEqual({ spot: "priv", tone: "read" });
    expect(result.frames[2].caption).toContain("ตัวนิ้วไม่ออกไปไหน");
    expect(result.frames[3].hop!.label).toBe("ผลสแกน");
    expect(result.frames[4].caption).toContain("ใช้ลายนิ้วมือที่ลงทะเบียนไว้ (.pub) ตรวจผลสแกนที่กุญแจลับทำขึ้น");
    // The packet that carries the answer holds the scan result only, never the private key.
    expect(result.frames[3].hop!.detail!.map((line) => line.text).join(" ")).not.toContain("id_ed25519");
  });

  it("there is no host-key / known_hosts step anywhere: first connect and later ones play the same frames", () => {
    const first = applySshAction(registered(), { type: "push", machine: A }, "setup");
    const again = route(first.nextState, { type: "push", machine: A }, "setup");
    expect(again).toEqual(["a→scanner:request", "github→a:request", null, "a→scanner:data", null, "a→repo:ok"]);
    expect(route(registered(), { type: "push", machine: A }, "setup")).toEqual(again);
    expect(JSON.stringify(first.frames)).not.toMatch(/known_hosts|hostkey|host key/i);
    expect(first.nextState.pushes).toBe(1);
    expect(first.nextState.a.out[0]).toContain("github.com");
    expect(first.outcome).toBe("success");
    expect(Object.keys(first.nextState.a).sort()).toEqual(["cmd", "out", "priv", "pub"]);
  });

  it("an unregistered key is blocked with a hint to register (and a missing key to create one)", () => {
    const state = keyed();
    const blocked = applySshAction(state, { type: "push", machine: A }, "setup");
    expect(blocked.outcome).toBe("failed");
    expect(blocked.message).toContain("ลงทะเบียน .pub กับ GitHub");
    expect(blocked.nextState.pushes).toBe(0);
    expect(blocked.frames.at(-1)!.hop).toMatchObject({ from: "scanner", to: "a", tone: "blocked" });
    const noKey = applySshAction(createInitialSshState(), { type: "test", machine: A }, "setup");
    expect(noKey.outcome).toBe("failed");
    expect(noKey.message).toContain("สร้างคู่กุญแจ");
  });

  it("testing the door twice stays a success even though no file changes", () => {
    const once = applySshAction(registered(), { type: "test", machine: A }, "setup").nextState;
    const twice = applySshAction(once, { type: "test", machine: A }, "setup");
    expect(twice.outcome).toBe("success");
    expect(twice.changed).toBe(false);
  });
});

describe("SSH-05 — step 5: other machines, copied .pub, lost laptop", () => {
  it("laptop B has no matching finger: blocked, and A's registration does not help it", () => {
    const state = registered("others");
    const result = applySshAction(state, { type: "push", machine: B }, "others");
    expect(route(state, { type: "push", machine: B }, "others")).toEqual(["b→scanner:request", "scanner→b:blocked"]);
    expect(result.outcome).toBe("failed");
    expect(result.message).toContain("ไม่มีนิ้ว");
    expect(result.nextState.pushes).toBe(0);
  });

  it("someone who copied the .pub cannot sign the challenge", () => {
    const state = play(registered("others"), "others", { type: "push", machine: A });
    expect(route(state, { type: "thief.try" }, "others")).toEqual(["keys→thief:data", "thief→scanner:request", "scanner→thief:request", null, null, "scanner→thief:blocked"]);
    const result = applySshAction(state, { type: "thief.try" }, "others");
    expect(result).toMatchObject({ outcome: "failed" });
    expect(result.nextState.thief).toBe("denied");
    expect(result.nextState.pushes).toBe(state.pushes);
    expect(result.frames.at(-3)!.caption).toContain("ไม่มีนิ้วจริง");
    expect(result.frames.at(-2)!.caption).toContain(".pub ตรวจผลสแกนได้อย่างเดียว ทำผลสแกนไม่ได้ และย้อนไปหากุญแจลับก็ไม่ได้");
    expect(result.frames.at(-2)!.marks).toContainEqual({ spot: "thief", tone: "blocked" });
    expect(applySshAction(createInitialSshState(), { type: "thief.try" }, "others").outcome).toBe("rejected");
  });

  it("revoking A's key removes it from GitHub and A is rejected afterwards", () => {
    const state = play(registered("others"), "others", { type: "push", machine: A });
    expect(applySshAction(state, { type: "push", machine: A }, "others").outcome).toBe("success");
    const revoked = applySshAction(state, { type: "revoke", machine: A }, "others");
    expect(revoked.nextState.registered).toEqual([]);
    expect(revoked.frames.at(-1)!.marks).toContainEqual({ spot: "key:a", tone: "removed" });
    const after = applySshAction(revoked.nextState, { type: "push", machine: A }, "others");
    expect(after.outcome).toBe("failed");
    expect(after.frames.at(-1)!.hop!.tone).toBe("blocked");
    expect(after.message).toContain("ลบไปแล้ว");
    expect(applySshAction(revoked.nextState, { type: "revoke", machine: A }, "others").outcome).toBe("noop");
  });

  it("laptop B makes its own key, registers it and gets in (each machine has its own key)", () => {
    const state = registered("others");
    const setup = applySshAction(state, { type: "b.setup" }, "others");
    expect(setup.nextState.b).toMatchObject({ priv: true, pub: true });
    expect(setup.nextState.registered).toEqual([A, B]);
    expect(setup.nextState.a.priv).toBe(true);
    expect(applySshAction(setup.nextState, { type: "b.setup" }, "others").outcome).toBe("noop");
    const pushed = applySshAction(setup.nextState, { type: "push", machine: B }, "others");
    expect(pushed.outcome).toBe("success");
    // A key made earlier but never registered is only registered, not regenerated.
    const half = play(createInitialSshState(), "others", { type: "keygen", machine: B });
    expect(route(half, { type: "b.setup" }, "others")).toEqual([null, "pub:b→keys:data", null]);
  });

  it("laptop B and the copier only exist in the last step", () => {
    for (const action of [{ type: "push", machine: B }, { type: "keygen", machine: B }, { type: "thief.try" }, { type: "b.setup" }] satisfies SshAction[]) {
      const result = applySshAction(registered(), action, "setup");
      expect(result).toMatchObject({ outcome: "rejected", changed: false, frames: [] });
    }
  });
});

describe("SSH-06 — reset and persistence across steps", () => {
  it("registering in step 3 carries into step 4; reset returns to the starting state", () => {
    const state = registered();
    expect(applySshAction(state, { type: "push", machine: A }, "setup").outcome).toBe("success");
    const reset = applySshAction(state, { type: "reset" }, "setup");
    expect(reset.nextState).toEqual(createInitialSshState());
    expect(applySshAction(reset.nextState, { type: "reset" }, "setup").outcome).toBe("noop");
    expect(applySshAction(createInitialSshState(), { type: "push", machine: A }, "setup").nextState).toEqual({ ...createInitialSshState(), a: { ...createInitialSshState().a, cmd: "git push", out: ["git@github.com: Permission denied (publickey).", "fatal: Could not read from remote repository."] } });
  });
});

/** Every state reachable from the start by any action in any step (breadth first, capped), with the frames those actions produce. */
const ACTIONS: SshAction[] = [
  ...(["a", "b"] as const).flatMap((machine) => [{ type: "keygen", machine }, { type: "register", machine }, { type: "test", machine }, { type: "push", machine }, { type: "revoke", machine }] satisfies SshAction[]),
  { type: "thief.try" }, { type: "b.setup" }, { type: "reset" },
];
const VIEWS: SshView[] = ["setup", "others"];
function explore() {
  const seen = new Map<string, SshState>([[JSON.stringify(createInitialSshState()), createInitialSshState()]]);
  const transitions: { view: SshView; frames: ReturnType<typeof applySshAction>["frames"]; nextState: SshState }[] = [];
  const queue = [createInitialSshState()];
  while (queue.length && seen.size < 300) {
    const state = queue.shift()!;
    for (const view of VIEWS) for (const action of ACTIONS) {
      const result = applySshAction(state, action, view);
      transitions.push({ view, frames: result.frames, nextState: result.nextState });
      const key = JSON.stringify(result.nextState);
      if (!seen.has(key)) { seen.set(key, result.nextState); queue.push(result.nextState); }
    }
  }
  return { states: [...seen.values()], transitions };
}

describe("document schema", () => {
  it("accepts every state of every frame of every action in every step (and rejects broken ones)", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    const node = (state: unknown) => ({ id: "00000000-0000-4000-8000-000000000003", type: "ssh-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "connect", state });
    const { states, transitions } = explore();
    expect(states.length).toBeGreaterThan(20);
    expect(transitions.flatMap((item) => item.frames).length).toBeGreaterThan(200);
    for (const state of states) expect(canvasNodeSchema.safeParse(node(state)).success).toBe(true);
    for (const frame of transitions.flatMap((item) => item.frames)) expect(canvasNodeSchema.safeParse(node(frame.state)).success).toBe(true);
    const base = createInitialSshState();
    expect(canvasNodeSchema.safeParse(node({ ...base, registered: ["a"] })).success).toBe(false);
    expect(canvasNodeSchema.safeParse(node({ ...base, a: { ...base.a, pub: true } })).success).toBe(false);
    expect(canvasNodeSchema.safeParse(node({ ...base, pushes: 1000 })).success).toBe(false);
  });

  it("still opens documents saved with the old four setup steps (they become “setup”) and with the removed `known` field (dropped)", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    const base = createInitialSshState();
    const node = (view: string, state: unknown) => ({ id: "00000000-0000-4000-8000-000000000004", type: "ssh-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view, state });
    for (const view of ["why", "keygen", "register", "connect"]) {
      const parsed = canvasNodeSchema.parse(node(view, base));
      expect(parsed.type === "ssh-simulator" && parsed.view).toBe("setup");
    }
    expect(canvasNodeSchema.parse(node("others", base))).toMatchObject({ view: "others" });
    expect(canvasNodeSchema.safeParse(node("nonsense", base)).success).toBe(false);
    const old = { ...base, a: { ...base.a, priv: true, pub: true, known: true }, b: { ...base.b, known: false } };
    const parsed = canvasNodeSchema.parse(node("connect", old));
    expect(parsed.type === "ssh-simulator" && Object.keys(parsed.state.a).sort()).toEqual(["cmd", "out", "priv", "pub"]);
    expect(canvasNodeSchema.safeParse(node("setup", { ...base, a: { ...base.a, surprise: 1 } })).success).toBe(false);
    expect(normalizeSshView("keygen")).toBe("setup");
    expect(normalizeSshView("others")).toBe("others");
  });
});
