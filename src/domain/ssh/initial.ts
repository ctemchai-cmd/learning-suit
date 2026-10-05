import type { SshMachine, SshState } from "./model";

const machine = (): SshMachine => ({ priv: false, pub: false, known: false, cmd: "", out: [] });

/** Starting point of the SSH lesson (plan 07 §4c): no keys anywhere, GitHub knows nobody. Fresh objects on every call; also the Reset target. */
export function createInitialSshState(): SshState {
  return { version: 1, a: machine(), b: machine(), registered: [], pushes: 0, thief: "idle" };
}
