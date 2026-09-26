import type { GitSimulationState } from "./model";

export const INITIAL_FILE_NAME = "main.py";
export const INITIAL_FILE_CONTENT = "print(\"Hello World\")\n";

/** The exact fixture of plan 04 §2. Returns fresh objects on every call. */
export function createInitialGitState(): GitSimulationState {
  return {
    version: 1,
    commits: {},
    machines: {
      A: {
        initialized: true,
        working: { name: INITIAL_FILE_NAME, content: INITIAL_FILE_CONTENT },
        index: null,
        mainHead: null,
        originMainHead: null,
        knownCommitIds: [],
      },
      B: {
        initialized: false,
        working: null,
        index: null,
        mainHead: null,
        originMainHead: null,
        knownCommitIds: [],
      },
    },
    remote: { mainHead: null, knownCommitIds: [] },
    nextCommitNumber: 1,
  };
}
