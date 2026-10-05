import type { FlowFrame } from "../data/model";

// SSH teaching simulator (plan 07 §4c). Pure types: no React, no Konva, no network.
// Analogy: GitHub is a building whose door has a fingerprint scanner. The private key is our real finger (never leaves
// the laptop), the public key is the fingerprint pattern we registered once at the scanner (GitHub → Settings → SSH keys).

/** Lesson steps: the guided setup (try → key pair → register → connect), then other machines / lost laptop. */
export type SshView = "setup" | "others";
/** Views of documents saved before the four setup steps were merged: they behave as `setup`. */
export const LEGACY_SSH_VIEWS = ["why", "keygen", "register", "connect"] as const;
export const normalizeSshView = (view: string): SshView => (view === "others" ? "others" : "setup");

/** Laptop A is ours; laptop B is a friend's / a new one. */
export type Machine = "a" | "b";

/** What one laptop holds in `~/.ssh`, plus what its terminal last showed. */
export type SshMachine = {
  /** `id_ed25519` — the private key (the real finger). */
  priv: boolean;
  /** `id_ed25519.pub` — the public key (the fingerprint pattern). Always comes together with `priv`. */
  pub: boolean;
  /** Last command typed and its output lines (screens are cleared when the lesson step changes). */
  cmd: string;
  out: string[];
};

export type SshState = {
  version: 1;
  a: SshMachine;
  b: SshMachine;
  /** Public keys listed on GitHub (Settings → SSH keys), by the machine they belong to. */
  registered: Machine[];
  /** Pushes that got through the door (display only). */
  pushes: number;
  /** The person who only copied our `.pub`: `denied` after the failed attempt. */
  thief: "idle" | "copied" | "denied";
};

export type SshAction =
  | { type: "keygen"; machine: Machine }
  | { type: "register"; machine: Machine }
  /** `ssh -T git@github.com` — only tests the door. */
  | { type: "test"; machine: Machine }
  | { type: "push"; machine: Machine }
  /** Someone copies our `.pub` and tries to get in with it. */
  | { type: "thief.try" }
  /** Delete a machine's key from GitHub (e.g. the laptop was lost). */
  | { type: "revoke"; machine: Machine }
  /** Laptop B makes its own key pair and registers it. */
  | { type: "b.setup" }
  | { type: "reset" };

/** `failed` = the flow ran and the door stayed shut on purpose: red in the panel. */
export type SshOutcome = "success" | "rejected" | "noop" | "failed";
export type SshTransition = {
  nextState: SshState;
  changed: boolean;
  outcome: SshOutcome;
  message: string;
  frames: FlowFrame<SshState>[];
};

export const SSH_LIMITS = { cmd: 80, outLine: 100, outLines: 3, pushes: 99 } as const;
export const KEYGEN_COMMAND = 'ssh-keygen -t ed25519 -C "you@example.com"';
