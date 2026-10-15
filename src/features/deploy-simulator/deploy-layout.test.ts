import { describe, expect, it } from "vitest";
import type { FlowFrame } from "../../domain/data/model";
import { revealForParts } from "../../domain/document/reveal";
import { createInitialDeployState } from "../../domain/deploy/initial";
import type { DeployAction, DeployState, DeployView } from "../../domain/deploy/model";
import { applyDeployAction } from "../../domain/deploy/reducer";
import { spotsOfFrames, walkFrames } from "../flow/frame-walk";
import { deployPartOfSpot, deployParts, deployPartsOfFrames, sceneOf, spotPoint } from "./deploy-layout";

// Actions the panel offers in each lesson step. The places frames name come from running the reducer, not from the layout.
const VIEWS: Record<DeployView, DeployAction[]> = {
  local: [{ type: "local.start" }, { type: "local.stop" }, { type: "code.edit", title: "ร้านกาแฟ ใหม่", broken: false }, { type: "friend.localhost" }],
  localEnv: [{ type: "local.start" }, { type: "local.stop" }, { type: "env.setLocal", on: false }, { type: "env.setLocal", on: true }, { type: "local.order", item: "ลาเต้" }],
  vercel: [{ type: "code.edit", title: "ร้านกาแฟ ใหม่", broken: false }, { type: "code.edit", title: "ร้านกาแฟ พัง", broken: true }, { type: "push" }, { type: "friend.visit" }, { type: "rollback" }],
  env: [{ type: "env.setVercel", on: true }, { type: "env.setVercel", on: false }, { type: "code.edit", title: "ร้านกาแฟ ใหม่", broken: false }, { type: "push" }, { type: "redeploy" }, { type: "friend.order", item: "ลาเต้" }, { type: "local.start" }, { type: "local.order", item: "ลาเต้" }],
  overall: [{ type: "overall.prepare" }, { type: "friend.order", item: "ลาเต้" }, { type: "friend.visit" }],
};
const apply = (view: DeployView) => (state: DeployState, action: DeployAction) => applyDeployAction(state, action, view);
const framesOf = (view: DeployView) => walkFrames(createInitialDeployState(), VIEWS[view], apply(view), 3);
const unmapped = (view: DeployView, frames: FlowFrame<unknown>[], partOf: (view: DeployView, spot: string) => string | null) =>
  [...spotsOfFrames(frames)].filter((spot) => partOf(view, spot) === null).sort();

describe("deploy reveal parts (plan 07 §2)", () => {
  it("each step has 3–6 ordered, labelled parts with unique ids", () => {
    for (const view of Object.keys(VIEWS) as DeployView[]) {
      const parts = deployParts(view);
      expect(parts.length, view).toBeGreaterThanOrEqual(3);
      expect(parts.length, view).toBeLessThanOrEqual(6);
      expect(new Set(parts.map((part) => part.id)).size).toBe(parts.length);
      for (const part of parts) expect(part.label.trim()).not.toBe("");
    }
    expect(deployParts("vercel").map((part) => part.id)).toEqual(["code", "github", "vercel", "deployments", "url", "friend"]);
    expect(deployParts("local").map((part) => part.id)).toEqual(["code", "server", "browser", "friend"]);
  });

  for (const view of Object.keys(VIEWS) as DeployView[]) {
    it(`step ${view}: every place any frame names maps to a part of the step, and exactly the drawn ones do`, () => {
      const frames = framesOf(view);
      const spots = spotsOfFrames(frames);
      expect(frames.length).toBeGreaterThan(10);
      expect(spots.size).toBeGreaterThanOrEqual(3);
      // Places a step does not draw (e.g. the .env.local box in the last step) have no part: those packets land at once.
      const notDrawn = [...spots].filter((spot) => !spot.startsWith("deploy:") && spotPoint(view, createInitialDeployState(), spot) === null).sort();
      expect(unmapped(view, frames, deployPartOfSpot).filter((spot) => !spot.startsWith("deploy:"))).toEqual(notDrawn);
      expect(unmapped(view, frames, deployPartOfSpot).filter((spot) => spot.startsWith("deploy:"))).toEqual([]);
      if (view !== "overall") expect(notDrawn).toEqual([]);
      const ids = deployParts(view).map((part) => part.id);
      for (const frame of frames) for (const spot of [...spotsOfFrames([frame])]) {
        const id = deployPartOfSpot(view, spot);
        if (id !== null) expect(ids).toContain(id);
        // The same set of places as the scene draws (deployment rows depend on the state, so they are checked by the list part).
        if (!spot.startsWith("deploy:")) expect(deployPartOfSpot(view, spot) === null, `${view} ${spot}`).toBe(spotPoint(view, frame.state, spot) === null);
      }
    });
    it(`step ${view}: every part has a drawn place or a pipe`, () => {
      const homes = new Set<string | null>([...spotsOfFrames(framesOf(view))].map((spot) => deployPartOfSpot(view, spot)));
      for (const pipe of sceneOf(view).pipes) homes.add(pipe.part);
      for (const part of deployParts(view)) expect(homes.has(part.id), part.id).toBe(true);
    });
    it(`step ${view}: every pipe belongs to a part of the step`, () => {
      const ids = deployParts(view).map((part) => part.id);
      for (const pipe of sceneOf(view).pipes) expect(ids).toContain(pipe.part);
    });
  }

  it("planted omission: a mapping that forgets Vercel's build gate is reported", () => {
    const forgetful = (view: DeployView, spot: string) => (spot === "build" ? null : deployPartOfSpot(view, spot));
    expect(unmapped("vercel", framesOf("vercel"), forgetful)).toEqual(["build"]);
  });

  it("actions need their parts (counts follow part order)", () => {
    const fresh = createInitialDeployState();
    const need = (view: DeployView, action: DeployAction, state = fresh) => deployPartsOfFrames(view, applyDeployAction(state, action, view).frames).sort();
    expect(need("local", { type: "local.start" })).toEqual(["browser", "code", "server"]);
    expect(need("local", { type: "friend.localhost" })).toEqual(["friend"]);
    const pushed = need("vercel", { type: "push" });
    expect(pushed).toEqual(expect.arrayContaining(["code", "github", "vercel", "deployments"]));
    const parts = deployParts("vercel");
    expect(revealForParts(parts, 0, pushed)).toBe(5); // the push ends with the new site at the URL
    // A friend's packet to the site passes the URL box.
    const live = applyDeployAction(fresh, { type: "push" }, "vercel").nextState;
    expect(need("vercel", { type: "friend.visit" }, live)).toEqual(expect.arrayContaining(["friend", "url"]));
    expect(revealForParts(parts, 0, need("vercel", { type: "friend.visit" }, live))).toBe(6);
  });
});
