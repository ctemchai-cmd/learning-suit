import type { DeployState } from "./model";

/** Starting point of the deploy lesson (plan 07 §4). Returns fresh objects on every call; also the Reset target. */
export function createInitialDeployState(): DeployState {
  return {
    version: 1,
    code: { rev: 1, title: "ร้านกาแฟ", broken: false },
    local: { running: false, showing: null },
    github: { rev: null, title: "", broken: false },
    deployments: [],
    production: null,
    nextDeployment: 1,
    keys: { local: true, vercel: false },
    friend: { title: "", lines: [], tone: "empty" },
    laptop: { lines: [] },
    orders: [],
  };
}
