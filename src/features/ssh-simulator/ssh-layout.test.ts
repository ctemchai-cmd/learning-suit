import { describe, expect, it } from "vitest";
import type { FlowFrame, Hop } from "../../domain/data/model";
import { createInitialSshState } from "../../domain/ssh/initial";
import type { SshAction, SshState, SshView } from "../../domain/ssh/model";
import { applySshAction } from "../../domain/ssh/reducer";
import { hopPath, sceneOf, spotPoint } from "./ssh-layout";

// Coverage of the scenes: every place a frame names (packet ends and highlighted spots) must be drawn in the step
// where that action is available. The set of names comes from running the scenarios, not from the layout.

const VIEWS: SshView[] = ["setup", "others"];
const ACTIONS: SshAction[] = [
  ...(["a", "b"] as const).flatMap((machine) => [{ type: "keygen", machine }, { type: "register", machine }, { type: "test", machine }, { type: "push", machine }, { type: "revoke", machine }] satisfies SshAction[]),
  { type: "thief.try" }, { type: "b.setup" },
];

function framesPerView(): Record<SshView, FlowFrame<SshState>[]> {
  const out: Record<SshView, FlowFrame<SshState>[]> = { setup: [], others: [] };
  // Walk a few action sequences so every branch (first connect, revoked key, B registered …) is hit.
  const starts: SshState[] = [createInitialSshState()];
  for (const view of VIEWS) {
    let frontier = starts;
    for (let depth = 0; depth < 3; depth++) {
      const next: SshState[] = [];
      for (const state of frontier) for (const action of ACTIONS) {
        const result = applySshAction(state, action, view);
        out[view].push(...result.frames);
        if (result.changed) next.push(result.nextState);
      }
      frontier = next.slice(0, 40);
    }
  }
  return out;
}
const missing = (view: SshView, frames: FlowFrame<SshState>[]) => {
  const names = new Set<string>();
  for (const frame of frames) {
    if (frame.hop) { names.add(frame.hop.from); names.add(frame.hop.to); }
    for (const mark of frame.marks) names.add(mark.spot);
  }
  return { names, absent: [...names].filter((name) => spotPoint(view, name) === null).sort() };
};

describe("scenes draw every place the scenarios use", () => {
  const frames = framesPerView();
  for (const view of VIEWS) {
    it(`step ${view}: all hop ends and marks have a position, every hop has a path`, () => {
      const { names, absent } = missing(view, frames[view]);
      expect(frames[view].length).toBeGreaterThan(20);
      expect(names.size).toBeGreaterThanOrEqual(8);
      expect(absent).toEqual([]);
      for (const frame of frames[view]) if (frame.hop) expect(hopPath(view, frame.hop), `${frame.hop.from}→${frame.hop.to}`).not.toBeNull();
    });
  }

  it("planted omission: a place the scene does not draw is reported (laptop B outside the last step, a made-up spot)", () => {
    const withB: FlowFrame<SshState>[] = [{ hop: { from: "b", to: "scanner", label: "x", tone: "request" }, caption: "x", state: createInitialSshState(), marks: [{ spot: "pub:b", tone: "new" }] }];
    expect(missing("setup", withB).absent).toEqual(["b", "pub:b"]);
    expect(missing("others", withB).absent).toEqual([]);
    expect(missing("others", [{ ...withB[0], hop: { from: "nowhere", to: "scanner", label: "x", tone: "ok" }, marks: [] }]).absent).toEqual(["nowhere"]);
    expect(hopPath("setup", { from: "nowhere", to: "scanner", label: "x", tone: "ok" })).toBeNull();
  });
});

describe("known_hosts is gone", () => {
  it("neither scene draws a host-key box or a known_hosts row", () => {
    for (const view of VIEWS) {
      expect(spotPoint(view, "hostkey")).toBeNull();
      expect(spotPoint(view, "known")).toBeNull();
      expect(Object.keys(sceneOf(view).machines.a.rows)).toEqual(["priv", "pub"]);
    }
  });
  it("legacy step ids draw the setup scene", () => {
    expect(sceneOf("why")).toBe(sceneOf("setup"));
    expect(sceneOf("connect").compact).toBe(false);
  });
});

describe("hop paths", () => {
  const hop = (from: string, to: string): Hop => ({ from, to, label: "x", tone: "data" });
  it("laptop ↔ GitHub always passes the laptop's edge, the scanner and GitHub's edge", () => {
    const scene = sceneOf("setup");
    const path = hopPath("setup", hop("pub", "keys"))!;
    expect(path.map((point) => `${point.x},${point.y}`)).toEqual([spotPoint("setup", "pub"), scene.machines.a.edge, scene.scanner, scene.gEdge, spotPoint("setup", "keys")].map((point) => `${point!.x},${point!.y}`));
    expect(hopPath("setup", hop("a", "pub"))).toHaveLength(2);
    expect(hopPath("others", hop("keys", "thief"))).toHaveLength(2);
  });
  it("the compact scene keeps the copier clear of laptop B and the widget inside its frame", () => {
    const scene = sceneOf("others");
    const b = scene.machines.b!.box, thief = scene.thief!;
    expect(thief.x).toBeGreaterThan(b.x + b.w + 18);
    // Laptops also draw a 18px base under themselves; everything must end above the caption bar (y = 620).
    for (const box of [scene.github, scene.legend, thief]) expect(box.y + box.h).toBeLessThanOrEqual(620);
    for (const box of [scene.machines.a.box, b]) expect(box.y + box.h + 18).toBeLessThanOrEqual(620);
  });
});
