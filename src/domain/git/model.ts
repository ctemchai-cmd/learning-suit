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
  /** Branches other than `main` (name → tip). Absent in older documents = only `main`. Kept canonical: never empty. */
  branches?: Record<string, CommitId>;
  /** The branch HEAD is on. Absent = `main`. Never "main" when present. */
  head?: string;
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
  /** `git switch -c <name>`: a new branch at the current commit; HEAD moves onto it. */
  | { type: "branchCreate"; machine: MachineId; name: string }
  /** `git switch <name>`: working file and Staging become the branch's tip. Refused with uncommitted work. */
  | { type: "branchSwitch"; machine: MachineId; name: string }
  /** `git merge <name>`: fast-forward, a merge commit, or (when both sides changed the file) `keep` decides the file. */
  | { type: "branchMerge"; machine: MachineId; name: string; keep?: "ours" | "theirs" }
  /** `git branch -d <name>`: only a branch already merged into the current one. */
  | { type: "branchDelete"; machine: MachineId; name: string }
  | { type: "reset" };

export type GitResultCode =
  | "EDITED" | "STAGED" | "COMMITTED" | "PUSHED" | "CLONED"
  | "PULLED" | "FETCHED_UP_TO_DATE" | "MERGED" | "RESET_TO_REMOTE" | "RESET" | "NO_CHANGE"
  | "NOT_INITIALIZED" | "INVALID_FILE" | "INVALID_MESSAGE"
  | "NOTHING_STAGED" | "NO_LOCAL_COMMITS" | "REMOTE_EMPTY"
  | "ALREADY_INITIALIZED" | "DIRTY_WORKTREE"
  | "NON_FAST_FORWARD" | "DIVERGED" | "COMMIT_LIMIT"
  | "BRANCH_CREATED" | "SWITCHED" | "FAST_FORWARDED" | "BRANCH_MERGED" | "BRANCH_DELETED"
  | "INVALID_BRANCH_NAME" | "BRANCH_EXISTS" | "BRANCH_NOT_FOUND" | "BRANCH_LIMIT" | "NEED_COMMIT_FOR_BRANCH"
  | "SAME_BRANCH" | "MERGE_CONFLICT" | "BRANCH_NOT_MERGED" | "CANNOT_DELETE_BRANCH" | "NOT_ON_MAIN";

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
  /** Branches other than `main` per machine. */
  branches: 20,
  branchNameCodePoints: 40,
} as const;
