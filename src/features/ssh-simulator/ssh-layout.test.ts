import { describe, expect, it } from "vitest";
import type { FlowFrame, Hop } from "../../domain/data/model";
import { createInitialSshState } from "../../domain/ssh/initial";
import type { SshAction, SshState, SshView } from "../../domain/ssh/model";
import { applySshAction } from "../../domain/ssh/reducer";
import { revealForParts } from "../../domain/document/reveal";
import { hopPath, sceneOf, spotPoint, sshPartOfSpot, sshParts, sshPartsOfFrames } from "./ssh-layout";

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
    for (const box of [scene.github, thief]) expect(box.y + box.h).toBeLessThanOrEqual(620);
    for (const box of [scene.machines.a.box, b]) expect(box.y + box.h + 18).toBeLessThanOrEqual(620);
  });
});

describe("reveal parts (plan 07 §2)", () => {
  const frames = framesPerView();
  const ids = (view: SshView) => sshParts(view).map((part) => part.id);

  it("each step has its ordered, labelled, unique parts", () => {
    expect(ids("setup")).toEqual(["a", "ssh", "host", "gate", "keys"]);
    expect(ids("others")).toEqual(["a", "b", "host", "gate", "thief"]);
    for (const view of VIEWS) {
      const parts = sshParts(view);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
      for (const part of parts) expect(part.label.trim()).not.toBe("");
    }
    expect(sshParts("setup").map((part) => part.label)).toEqual(["เครื่อง A (ของเรา)", "โฟลเดอร์ ~/.ssh", "GitHub และ repo", "ด่านสแกนนิ้ว", "รายการ SSH Keys"]);
    expect(sshParts("setup", "gitlab")[2].label).toBe("GitLab และ repo");
    expect(sshParts("others", "gitlab")[2].label).toBe("GitLab");
    expect(sshParts("why")).toEqual(sshParts("setup"));
  });

  // The spots come from running the scenarios; "drawn" comes from the scene (spotPoint), so the part map is checked against both.
  const unmapped = (view: SshView, partOf: (view: SshView, spot: string) => string | null) => {
    const spots = new Set<string>();
    for (const frame of frames[view]) {
      if (frame.hop) { spots.add(frame.hop.from); spots.add(frame.hop.to); }
      for (const mark of frame.marks) spots.add(mark.spot);
    }
    return { spots, bad: [...spots].filter((spot) => partOf(view, spot) === null).sort() };
  };
  for (const view of VIEWS) {
    it(`step ${view}: every spot any frame uses maps to one of the step's parts, and only spots that are drawn do`, () => {
      const { spots, bad } = unmapped(view, sshPartOfSpot);
      expect(spots.size).toBeGreaterThanOrEqual(8);
      expect(bad).toEqual([]);
      for (const spot of spots) expect(ids(view)).toContain(sshPartOfSpot(view, spot));
      for (const spot of [...spots, "hostkey", "nowhere", "b", "pub:b", "thief", "key:b"]) expect(sshPartOfSpot(view, spot) === null, spot).toBe(spotPoint(view, spot) === null);
    });
    it(`step ${view}: every part is the home of at least one drawn spot (gate = the scanner)`, () => {
      const homes = new Set([...unmapped(view, sshPartOfSpot).spots].map((spot) => sshPartOfSpot(view, spot)));
      for (const id of ids(view)) expect(homes.has(id), id).toBe(true);
    });
  }
  it("planted omission: a mapping that forgets the keys list is reported", () => {
    const forgetful = (view: SshView, spot: string) => (spot === "keys" || spot === "key:a" ? null : sshPartOfSpot(view, spot));
    expect(unmapped("setup", forgetful).bad).toEqual(["key:a", "keys"]);
  });

  it("actions need their parts: setup step (spots → parts, the gate when a packet passes the scanner)", () => {
    const fresh = createInitialSshState();
    const parts = (action: SshAction, state = fresh, view: SshView = "setup") => sshPartsOfFrames(view, applySshAction(state, action, view).frames).sort();
    expect(parts({ type: "push", machine: "a" })).toEqual(["a", "gate"]);
    expect(parts({ type: "keygen", machine: "a" })).toEqual(["ssh"]);
    const keyed = applySshAction(fresh, { type: "keygen", machine: "a" }, "setup").nextState;
    expect(parts({ type: "register", machine: "a" }, keyed)).toEqual(["gate", "keys", "ssh"]);
    const registered = applySshAction(keyed, { type: "register", machine: "a" }, "setup").nextState;
    expect(parts({ type: "test", machine: "a" }, registered)).toEqual(["a", "gate", "host", "keys", "ssh"]);
    expect(parts({ type: "push", machine: "a" }, registered)).toEqual(["a", "gate", "host", "keys", "ssh"]);
  });
  it("actions need their parts: last step", () => {
    const fresh = createInitialSshState();
    const registered = applySshAction(applySshAction(fresh, { type: "keygen", machine: "a" }, "others").nextState, { type: "register", machine: "a" }, "others").nextState;
    const parts = (action: SshAction, state = registered) => sshPartsOfFrames("others", applySshAction(state, action, "others").frames).sort();
    expect(parts({ type: "push", machine: "b" })).toEqual(["b", "gate"]);
    expect(parts({ type: "thief.try" })).toEqual(["gate", "host", "thief"]);
    expect(parts({ type: "b.setup" })).toEqual(["b", "gate", "host"]);
  });
  it("auto-reveal count follows the last needed part (counts are in part order)", () => {
    const fresh = createInitialSshState();
    const parts = sshParts("setup");
    const need = (action: SshAction) => sshPartsOfFrames("setup", applySshAction(fresh, action, "setup").frames);
    expect(revealForParts(parts, 0, need({ type: "push", machine: "a" }))).toBe(4);
    expect(revealForParts(parts, 0, need({ type: "keygen", machine: "a" }))).toBe(2);
    expect(revealForParts(parts, undefined, need({ type: "push", machine: "a" }))).toBeUndefined();
  });
});
