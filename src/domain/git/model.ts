export type MachineId = "A" | "B";
export type CommitId = string;
export type FileSnapshot = { name: string; content: string };
export type GitCommit = {
  id: CommitId;
  parentId: CommitId | null;
  /** Second parent of a merge commit (the GitHub side that was merged in). Absent on ordinary commits. */
  mergeParentId?: CommitId;
  message: string;
  snapshot: FileSnapshot;
};
export type MachineRepository = {
  initialized: boolean;
  working: FileSnapshot | null;
  index: FileSnapshot | null;
  mainHead: CommitId | null;
  originMainHead: CommitId | null;
  knownCommitIds: CommitId[];
};
export type RemoteRepository = {
  mainHead: CommitId | null;
  knownCommitIds: CommitId[];
};
export type GitSimulationState = {
  version: 1;
  commits: Record<CommitId, GitCommit>;
  machines: { A: MachineRepository; B: MachineRepository };
  remote: RemoteRepository;
  nextCommitNumber: number;
};

export type RepositoryId = MachineId | "remote";

export type GitAction =
  | { type: "edit"; machine: MachineId; file: FileSnapshot }
  | { type: "stage"; machine: MachineId }
  | { type: "commit"; machine: MachineId; message: string }
  | { type: "push"; machine: MachineId }
  | { type: "clone"; machine: "B" }
  | { type: "pull"; machine: MachineId }
  /** Joins a diverged history: a merge commit whose file is ours or GitHub's (the simplified conflict choice). */
  | { type: "merge"; machine: MachineId; keep: "ours" | "theirs" }
  /** Throws away local work and moves `main` to the fetched `origin/main` (like `git reset --hard origin/main`). */
  | { type: "resetToRemote"; machine: MachineId }
  | { type: "reset" };

export type GitResultCode =
  | "EDITED" | "STAGED" | "COMMITTED" | "PUSHED" | "CLONED"
  | "PULLED" | "FETCHED_UP_TO_DATE" | "MERGED" | "RESET_TO_REMOTE" | "RESET" | "NO_CHANGE"
  | "NOT_INITIALIZED" | "INVALID_FILE" | "INVALID_MESSAGE"
  | "NOTHING_STAGED" | "NO_LOCAL_COMMITS" | "REMOTE_EMPTY"
  | "ALREADY_INITIALIZED" | "DIRTY_WORKTREE"
  | "NON_FAST_FORWARD" | "DIVERGED" | "COMMIT_LIMIT";

export type GitOutcome = "success" | "noop" | "rejected";

export type GitTransfer = {
  from: RepositoryId;
  to: RepositoryId;
  commitIds: CommitId[];
};

export type GitTransition = {
  nextState: GitSimulationState;
  outcome: GitOutcome;
  changed: boolean;
  code: GitResultCode;
  affectedCommitIds: CommitId[];
  transfer: GitTransfer | null;
};

/** Product limits of the simulator (Learning Suit decisions, not Git limits). */
export const GIT_LIMITS = {
  commits: 200,
  fileNameCodePoints: 120,
  fileContentBytes: 64 * 1024,
  messageCodePoints: 200,
} as const;
