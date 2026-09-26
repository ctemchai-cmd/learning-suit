import { describe, expect, it } from "vitest";
import { createInitialDeployState } from "./initial";
import type { DeployAction, DeployState, DeployView } from "./model";
import { applyDeployAction } from "./reducer";

function play(state: DeployState, view: DeployView, ...actions: DeployAction[]): DeployState {
  return actions.reduce((current, action) => applyDeployAction(current, action, view).nextState, state);
}
const route = (state: DeployState, action: DeployAction, view: DeployView) =>
  applyDeployAction(state, action, view).frames.map((frame) => frame.hop && `${frame.hop.from}→${frame.hop.to}:${frame.hop.tone}`);

describe("step 1 — local", () => {
  it("the local server shows the site on the laptop and hot-reloads edits", () => {
    let state = play(createInitialDeployState(), "local", { type: "local.start" });
    expect(state.local).toEqual({ running: true, showing: 1 });
    const edit = applyDeployAction(state, { type: "code.edit", title: "ร้านกาแฟ ใหม่", broken: false }, "local");
    expect(edit.frames.map((frame) => frame.hop?.to ?? null)).toEqual([null, "server", "browser"]);
    state = edit.nextState;
    expect(state.local.showing).toBe(2);
    expect(applyDeployAction(state, { type: "local.start" }, "local").outcome).toBe("noop");
  });

  it("a friend's phone cannot open our localhost", () => {
    const result = applyDeployAction(createInitialDeployState(), { type: "friend.localhost" }, "local");
    expect(route(createInitialDeployState(), { type: "friend.localhost" }, "local")).toEqual(["friend→localhostGate:request", "localhostGate→friend:blocked"]);
    expect(result.nextState.friend.tone).toBe("error");
  });
});

describe("step 2 — Vercel", () => {
  it("push → GitHub → Build → a deployment becomes Production, and the friend sees it", () => {
    const pushed = applyDeployAction(createInitialDeployState(), { type: "push" }, "vercel");
    expect(route(createInitialDeployState(), { type: "push" }, "vercel")).toEqual([
      "code→github:data", "github→vercel:request", "vercel→build:request", "build→deploy:1:ok", "deploy:1→url:ok",
    ]);
    expect(pushed.nextState).toMatchObject({ github: { rev: 1 }, production: 1, deployments: [{ id: 1, rev: 1, ok: true, hasKey: false }] });
    const visit = applyDeployAction(pushed.nextState, { type: "friend.visit" }, "vercel");
    expect(visit.nextState.friend).toMatchObject({ title: "ร้านกาแฟ", tone: "ok" });
    expect(applyDeployAction(pushed.nextState, { type: "push" }, "vercel").outcome).toBe("noop");
  });

  it("a failed build keeps the old site online; rollback moves Production back without building", () => {
    let state = play(createInitialDeployState(), "vercel", { type: "push" },
      { type: "code.edit", title: "รุ่นสอง", broken: false }, { type: "push" },
      { type: "code.edit", title: "รุ่นพัง", broken: true });
    expect(state.production).toBe(2);
    const failed = applyDeployAction(state, { type: "push" }, "vercel");
    expect(failed.frames.at(-1)).toMatchObject({ hop: { to: "vercel", tone: "blocked" }, marks: [{ spot: "build", tone: "blocked" }, { spot: "deploy:3", tone: "blocked" }] });
    state = failed.nextState;
    expect(state).toMatchObject({ production: 2, deployments: [{ id: 1 }, { id: 2 }, { id: 3, ok: false }] });
    state = play(state, "vercel", { type: "rollback" });
    expect(state.production).toBe(1);
    expect(applyDeployAction(state, { type: "rollback" }, "vercel").outcome).toBe("rejected");
  });

  it("visiting before any deployment shows that there is no site yet", () => {
    expect(applyDeployAction(createInitialDeployState(), { type: "friend.visit" }, "vercel").nextState.friend.tone).toBe("error");
  });
});

describe("step 3 — the secret key", () => {
  it("the key never goes to GitHub; without it on Vercel the live site cannot reach the database", () => {
    const pushed = applyDeployAction(createInitialDeployState(), { type: "push" }, "env");
    expect(pushed.frames[0]).toMatchObject({ hop: { from: "envfile", to: "gitignore", tone: "blocked" } });
    let state = pushed.nextState;
    const broken = applyDeployAction(state, { type: "friend.order", item: "ลาเต้" }, "env");
    expect(broken.nextState.orders).toEqual([]);
    expect(broken.nextState.friend.tone).toBe("error");
    // Locally it works thanks to .env.local.
    state = play(state, "env", { type: "local.start" }, { type: "local.order", item: "มอคค่า" });
    expect(state.orders).toEqual(["มอคค่า"]);
    // Adding the key on Vercel alone is not enough: the live deployment was built without it.
    state = play(state, "env", { type: "env.setVercel", on: true });
    expect(applyDeployAction(state, { type: "friend.order", item: "ลาเต้" }, "env").nextState.orders).toEqual(["มอคค่า"]);
    state = play(state, "env", { type: "redeploy" }, { type: "friend.order", item: "ลาเต้" });
    expect(state.deployments.at(-1)).toMatchObject({ id: 2, hasKey: true });
    expect(state.orders).toEqual(["มอคค่า", "ลาเต้"]);
    expect(state.friend).toMatchObject({ title: "สั่งสำเร็จ", tone: "ok" });
  });
});

describe("step 4 — the whole system", () => {
  it("an order travels phone → URL → Vercel → access rule → orders table → phone", () => {
    const ready = play(createInitialDeployState(), "overall", { type: "env.setVercel", on: true }, { type: "push" });
    expect(route(ready, { type: "friend.order", item: "ลาเต้" }, "overall")).toEqual([
      "friend→url:data", "url→vercel:request", "vercel→rls:request", "rls→orders:ok", "orders→friend:ok",
    ]);
  });

  it("is deterministic and Reset returns the exact start", () => {
    const action: DeployAction = { type: "push" };
    expect(applyDeployAction(createInitialDeployState(), action, "vercel")).toEqual(applyDeployAction(createInitialDeployState(), action, "vercel"));
    const changed = play(createInitialDeployState(), "vercel", action);
    expect(applyDeployAction(changed, { type: "reset" }, "vercel").nextState).toEqual(createInitialDeployState());
  });
});

describe("document schema", () => {
  it("accepts every state the scenarios produce", async () => {
    const { canvasNodeSchema } = await import("../document/schema");
    const node = (state: DeployState) => ({ id: "00000000-0000-4000-8000-000000000002", type: "deploy-simulator", x: 0, y: 0, rotation: 0, opacity: 1, locked: false, scale: 1, view: "env", state });
    let state = createInitialDeployState();
    const steps: [DeployAction, DeployView][] = [
      [{ type: "local.start" }, "local"], [{ type: "friend.localhost" }, "local"], [{ type: "code.edit", title: "ร้านใหม่", broken: false }, "local"],
      [{ type: "push" }, "vercel"], [{ type: "friend.visit" }, "vercel"], [{ type: "code.edit", title: "พัง", broken: true }, "vercel"], [{ type: "push" }, "vercel"],
      [{ type: "env.setVercel", on: true }, "env"], [{ type: "redeploy" }, "env"], [{ type: "friend.order", item: "ลาเต้" }, "env"], [{ type: "local.order", item: "มอคค่า" }, "env"],
    ];
    for (const [action, view] of steps) {
      state = applyDeployAction(state, action, view).nextState;
      expect(canvasNodeSchema.safeParse(node(state)).success).toBe(true);
    }
    expect(canvasNodeSchema.safeParse(node({ ...state, production: 99 })).success).toBe(false);
  });
});

describe("step 4 helper", () => {
  it("prepare fixes broken code, adds the key and deploys so the next order succeeds", () => {
    const messy = play(createInitialDeployState(), "vercel", { type: "push" }, { type: "code.edit", title: "พัง", broken: true }, { type: "push" });
    const prepared = applyDeployAction(messy, { type: "overall.prepare" }, "overall");
    expect(prepared.outcome).toBe("success");
    const live = prepared.nextState.deployments.find((item) => item.id === prepared.nextState.production)!;
    expect(live).toMatchObject({ ok: true, hasKey: true });
    expect(prepared.nextState.code.broken).toBe(false);
    expect(applyDeployAction(prepared.nextState, { type: "overall.prepare" }, "overall").outcome).toBe("noop");
    const ordered = applyDeployAction(prepared.nextState, { type: "friend.order", item: "ลาเต้" }, "overall");
    expect(ordered.nextState.orders).toEqual(["ลาเต้"]);
  });
});

describe("step 2 — the key in .env.local", () => {
  it("the local server reads the key from .env.local; without it the database is out of reach", () => {
    const running = play(createInitialDeployState(), "localEnv", { type: "local.start" });
    expect(route(running, { type: "local.order", item: "ลาเต้" }, "localEnv")).toEqual([
      "browser→server:data", "envfile→server:data", "server→supabase:ok", "supabase→browser:ok",
    ]);
    const noKey = play(running, "localEnv", { type: "env.setLocal", on: false });
    expect(route(noKey, { type: "local.order", item: "ลาเต้" }, "localEnv")).toEqual([
      "browser→server:data", "envfile→server:blocked", "server→supabase:blocked", "server→browser:blocked",
    ]);
    const failed = applyDeployAction(noKey, { type: "local.order", item: "ลาเต้" }, "localEnv").nextState;
    expect(failed.orders).toEqual([]);
    expect(failed.laptop.lines).toEqual(["บันทึกไม่สำเร็จ ✗"]);
    expect(applyDeployAction(noKey, { type: "env.setLocal", on: false }, "localEnv").outcome).toBe("noop");
  });
});

describe("outcomes shown in red", () => {
  it("marks demonstrated failures as failed (not success) while keeping the error on screen", () => {
    const running = play(createInitialDeployState(), "localEnv", { type: "local.start" }, { type: "env.setLocal", on: false });
    const noKey = applyDeployAction(running, { type: "local.order", item: "ลาเต้" }, "localEnv");
    expect(noKey).toMatchObject({ outcome: "failed", changed: true });
    expect(noKey.nextState.laptop.lines).toEqual(["บันทึกไม่สำเร็จ ✗"]);
    expect(applyDeployAction(createInitialDeployState(), { type: "friend.localhost" }, "local").outcome).toBe("failed");
    const broken = play(createInitialDeployState(), "vercel", { type: "code.edit", title: "พัง", broken: true });
    expect(applyDeployAction(broken, { type: "push" }, "vercel").outcome).toBe("failed");
    expect(applyDeployAction(createInitialDeployState(), { type: "push" }, "vercel").outcome).toBe("success");
  });
});
