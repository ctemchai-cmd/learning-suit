import type { FlowFrame } from "../data/model";

// Deploy teaching simulator (plan 07 §4). Pure types: no React, no Konva, no network.
// The coffee-shop website travels: laptop → (local server) → GitHub → Vercel → public URL → a friend's phone,
// and in the last steps the live site talks to the database with a secret key.

/** Lesson steps: open locally → the key in .env.local → deploy on Vercel → the key on Vercel → the whole system. */
export type DeployView = "local" | "localEnv" | "vercel" | "env" | "overall";

/** One build of the site on Vercel. `ok = false` = the build failed (never served). */
export type Deployment = { id: number; rev: number; title: string; ok: boolean; hasKey: boolean };

export type DeployState = {
  version: 1;
  /** The code on the teacher's laptop. `rev` grows on every edit; `broken` = contains a mistake the build will catch. */
  code: { rev: number; title: string; broken: boolean };
  /** The local development server (localhost). `showing` = code revision the laptop browser shows. */
  local: { running: boolean; showing: number | null };
  /** Last code pushed to GitHub (null rev = nothing pushed yet). */
  github: { rev: number | null; title: string; broken: boolean };
  deployments: Deployment[];
  /** Deployment served at the public URL (Production), or null before the first successful deploy. */
  production: number | null;
  nextDeployment: number;
  /** The database key: in `.env.local` on the laptop, and (only if the teacher adds it) in Vercel's settings. */
  keys: { local: boolean; vercel: boolean };
  /** What the friend's phone shows (last result). */
  friend: { title: string; lines: string[]; tone: "empty" | "ok" | "error" };
  /** What the laptop browser shows when the site talks to the database locally. */
  laptop: { lines: string[] };
  /** Orders saved in the database through the site. */
  orders: string[];
};

export type DeployAction =
  | { type: "local.start" }
  | { type: "local.stop" }
  | { type: "code.edit"; title: string; broken: boolean }
  | { type: "friend.localhost" }
  | { type: "push" }
  | { type: "friend.visit" }
  | { type: "rollback" }
  | { type: "env.setVercel"; on: boolean }
  /** Put the database key into (or take it out of) `.env.local` on the laptop. */
  | { type: "env.setLocal"; on: boolean }
  | { type: "redeploy" }
  | { type: "friend.order"; item: string }
  | { type: "local.order"; item: string }
  /** Step 4 helper: fix the code, add the key on Vercel and deploy, as one flow. */
  | { type: "overall.prepare" }
  | { type: "reset" };

/** `failed` = the flow ran and shows a problem on purpose (build failed, no key …): red in the panel. */
export type DeployOutcome = "success" | "rejected" | "noop" | "failed";
export type DeployTransition = {
  nextState: DeployState;
  changed: boolean;
  outcome: DeployOutcome;
  message: string;
  frames: FlowFrame<DeployState>[];
};

export const DEPLOY_LIMITS = { titleCodePoints: 40, deployments: 12, orders: 10 } as const;
/** Public address of the simulated site (display only). */
export const SITE_URL = "coffee-shop.vercel.app";
