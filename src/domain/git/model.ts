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
  /**
   * A merge that stopped on conflicts (`git merge` said CONFLICT): `theirs` is the commit being merged in, `label` its name
   * (a branch, or `origin/main`). The working file holds the markers; Commit finishes it, `mergeAbort` drops it.
   */
  merging?: MergeInProgress;
};
export type MergeInProgress = { theirs: CommitId; label: string };
/** A Merge Request (GitHub: Pull Request) on the remote: `source` branch → main, reviewed by the other machine. */
export type MergeRequest = {
  /** 1, 2, 3… in the order opened. */
  id: number;
  source: string;
  target: "main";
  title: string;
  status: "open" | "merged" | "closed";
  /** The machine that opened it (cannot approve its own). */
  author: MachineId;
  approvedBy: MachineId[];
};
export type RemoteRepository = {
  mainHead: CommitId | null;
  knownCommitIds: CommitId[];
  /** Branches other than `main` pushed to the remote (review lesson). Absent in older documents. */
  branches?: Record<string, CommitId>;
  /** Merge Requests, oldest first (at most GIT_LIMITS.requests). Absent in older documents. */
  requests?: MergeRequest[];
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
  /** `review` = the Merge Request lesson: `main` is protected and a push from another branch sends that branch. */
  | { type: "push"; machine: MachineId; review?: boolean }
  | { type: "clone"; machine: "B" }
  /** `review`: also allowed on a branch, where it merges `origin/main` into that branch (`git pull origin main`). */
  | { type: "pull"; machine: MachineId; review?: boolean }
  /** Opens a Merge Request from the current (pushed) branch into main. */
  | { type: "mrOpen"; machine: MachineId }
  /** The teammate approves a Merge Request (not its author). */
  | { type: "mrApprove"; machine: MachineId; id: number }
  /** Merges an approved Merge Request into the remote's main and deletes its source branch there. */
  | { type: "mrMerge"; machine: MachineId; id: number }
  /** While merging: fills the working file with one side's whole file (a shortcut for deleting the other half by hand). */
  | { type: "mergeTake"; machine: MachineId; side: "ours" | "theirs" }
  /** `git merge --abort`: leaves the merge and puts the working file and Staging back to HEAD. */
  | { type: "mergeAbort"; machine: MachineId }
  /** Throws away local work and moves `main` to the fetched `origin/main` (like `git reset --hard origin/main`). */
  | { type: "resetToRemote"; machine: MachineId }
  /** `git switch -c <name>`: a new branch at the current commit; HEAD moves onto it. */
  | { type: "branchCreate"; machine: MachineId; name: string }
  /** `git switch <name>`: working file and Staging become the branch's tip. Refused with uncommitted work. */
  | { type: "branchSwitch"; machine: MachineId; name: string }
  /** `git merge <name>`: fast-forward, a merge commit Git makes by itself, or a conflict the learner resolves in the file. */
  | { type: "branchMerge"; machine: MachineId; name: string }
  /** `git branch -d <name>`: only a branch already merged into the current one. */
  | { type: "branchDelete"; machine: MachineId; name: string }
  | { type: "reset" };

export type GitResultCode =
  | "EDITED" | "STAGED" | "COMMITTED" | "PUSHED" | "CLONED"
  | "PULLED" | "FETCHED_UP_TO_DATE" | "MERGED" | "AUTO_MERGED" | "BRANCH_PUSHED" | "MR_OPENED" | "MR_APPROVED" | "MR_MERGED" | "MR_FAST_FORWARDED" | "MERGE_ABORTED" | "MERGE_TAKEN" | "RESET_TO_REMOTE" | "RESET" | "NO_CHANGE"
  | "NOT_INITIALIZED" | "INVALID_FILE" | "INVALID_MESSAGE"
  | "NOTHING_STAGED" | "NO_LOCAL_COMMITS" | "REMOTE_EMPTY"
  | "ALREADY_INITIALIZED" | "DIRTY_WORKTREE"
  | "NON_FAST_FORWARD" | "COMMIT_LIMIT" | "MERGE_IN_PROGRESS" | "MAIN_PROTECTED" | "MR_NEED_BRANCH" | "MR_NOT_PUSHED" | "MR_NOTHING_NEW" | "MR_EXISTS" | "MR_LIMIT" | "MR_NOT_FOUND" | "MR_SELF_APPROVE" | "MR_NOT_APPROVED" | "MR_CONFLICT" | "NOT_MERGING" | "UNRESOLVED_CONFLICT"
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
  /** Merge Requests per remote. */
  requests: 20,
} as const;
