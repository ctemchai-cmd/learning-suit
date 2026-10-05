import { createInitialGitState } from "./initial";
import {
  GIT_LIMITS,
  type CommitId,
  type FileSnapshot,
  type GitAction,
  type GitResultCode,
  type GitSimulationState,
  type GitTransfer,
  type GitTransition,
  type MachineId,
  type MachineRepository,
} from "./model";
import {
  MAIN_BRANCH,
  analyzeBranchMerge,
  ancestorsOf,
  branchExists,
  branchTip,
  copySnapshot,
  currentBranch,
  headCommitId,
  headSnapshot,
  isAncestor,
  isClean,
  jsonEqual,
  snapshotsEqual,
  sortCommitIds,
  validateBranchName,
  validateCommitMessage,
  validateFileSnapshot,
} from "./selectors";

/**
 * Pure Git teaching reducer (plan 04 §3–§4).
 * Never mutates `state`, never throws for domain input, and returns the same `state`
 * reference whenever nothing changed. No time, randomness or I/O.
 */
export function applyGitAction(state: GitSimulationState, action: GitAction): GitTransition {
  switch (action.type) {
    case "edit": return edit(state, action.machine, action.file);
    case "stage": return stage(state, action.machine);
    case "commit": return commit(state, action.machine, action.message);
    case "push": return push(state, action.machine);
    case "clone": return clone(state, action.machine);
    case "pull": return pull(state, action.machine);
    case "merge": return merge(state, action.machine, action.keep);
    case "resetToRemote": return resetToRemote(state, action.machine);
    case "branchCreate": return branchCreate(state, action.machine, action.name);
    case "branchSwitch": return branchSwitch(state, action.machine, action.name);
    case "branchMerge": return branchMerge(state, action.machine, action.name, action.keep);
    case "branchDelete": return branchDelete(state, action.machine, action.name);
    case "reset": return reset(state);
    default: {
      action satisfies never;
      return unchanged(state, "noop", "NO_CHANGE");
    }
  }
}

function unchanged(state: GitSimulationState, outcome: "noop" | "rejected", code: GitResultCode): GitTransition {
  return { nextState: state, outcome, changed: false, code, affectedCommitIds: [], transfer: null };
}

function withMachine(state: GitSimulationState, machine: MachineId, repo: MachineRepository): GitSimulationState {
  return { ...state, machines: { ...state.machines, [machine]: repo } };
}

/** Points the current branch (`main` or another) at `id`. */
function moveCurrentBranch(repo: MachineRepository, id: CommitId): MachineRepository {
  const head = currentBranch(repo);
  return head === MAIN_BRANCH ? { ...repo, mainHead: id } : { ...repo, branches: { ...repo.branches, [head]: id } };
}

/** HEAD moves to `head` and the branch list stays canonical (no empty `branches`, no `head: "main"`). */
function withBranches(repo: MachineRepository, branches: Record<string, CommitId>, head: string): MachineRepository {
  const { branches: _branches, head: _head, ...rest } = repo;
  void _branches; void _head;
  return { ...rest, ...(Object.keys(branches).length ? { branches } : {}), ...(head !== MAIN_BRANCH ? { head } : {}) };
}

function onMain(repo: MachineRepository): boolean {
  return currentBranch(repo) === MAIN_BRANCH;
}

function transferOf(from: GitTransfer["from"], to: GitTransfer["to"], commitIds: CommitId[]): GitTransfer | null {
  return commitIds.length ? { from, to, commitIds: [...commitIds] } : null;
}

function edit(state: GitSimulationState, machine: MachineId, file: FileSnapshot): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const validation = validateFileSnapshot(file);
  if (!validation.ok) return unchanged(state, "rejected", "INVALID_FILE");
  if (snapshotsEqual(validation.file, repo.working)) return unchanged(state, "noop", "NO_CHANGE");
  const nextState = withMachine(state, machine, { ...repo, working: copySnapshot(validation.file) });
  return { nextState, outcome: "success", changed: true, code: "EDITED", affectedCommitIds: [], transfer: null };
}

function stage(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized || repo.working === null) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (snapshotsEqual(repo.working, repo.index)) return unchanged(state, "noop", "NO_CHANGE");
  const nextState = withMachine(state, machine, { ...repo, index: copySnapshot(repo.working) });
  return { nextState, outcome: "success", changed: true, code: "STAGED", affectedCommitIds: [], transfer: null };
}

function commit(state: GitSimulationState, machine: MachineId, message: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  // Precedence: message → staged changes → commit limit.
  const validation = validateCommitMessage(message);
  if (!validation.ok) return unchanged(state, "rejected", "INVALID_MESSAGE");
  if (repo.index === null || snapshotsEqual(repo.index, headSnapshot(state, repo))) return unchanged(state, "rejected", "NOTHING_STAGED");
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return unchanged(state, "rejected", "COMMIT_LIMIT");

  const id = `C${state.nextCommitNumber}`;
  const nextState: GitSimulationState = {
    ...state,
    commits: {
      ...state.commits,
      [id]: { id, parentId: headCommitId(repo), message: validation.message, snapshot: copySnapshot(repo.index) },
    },
    machines: {
      ...state.machines,
      [machine]: { ...moveCurrentBranch(repo, id), knownCommitIds: sortCommitIds([...repo.knownCommitIds, id]) },
    },
    nextCommitNumber: state.nextCommitNumber + 1,
  };
  return { nextState, outcome: "success", changed: true, code: "COMMITTED", affectedCommitIds: [id], transfer: null };
}

function push(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!onMain(repo)) return unchanged(state, "rejected", "NOT_ON_MAIN");
  const localHead = repo.mainHead;
  if (localHead === null) return unchanged(state, "rejected", "NO_LOCAL_COMMITS");
  const remote = state.remote;

  if (remote.mainHead === localHead) {
    // Nothing new to send; only refresh the sender's stale tracking.
    if (repo.originMainHead === localHead) return unchanged(state, "noop", "NO_CHANGE");
    const nextState = withMachine(state, machine, { ...repo, originMainHead: localHead });
    return { nextState, outcome: "success", changed: true, code: "PUSHED", affectedCommitIds: [], transfer: null };
  }

  // Remote empty accepts every ancestor; otherwise remote HEAD must be an ancestor within the LOCAL known set.
  if (remote.mainHead !== null && !isAncestor(remote.mainHead, localHead, repo.knownCommitIds, state.commits)) {
    return unchanged(state, "rejected", "NON_FAST_FORWARD");
  }

  const remoteKnown = new Set(remote.knownCommitIds);
  const sent = ancestorsOf(localHead, repo.knownCommitIds, state.commits).filter((id) => !remoteKnown.has(id));
  const nextState: GitSimulationState = {
    ...state,
    machines: { ...state.machines, [machine]: { ...repo, originMainHead: localHead } },
    remote: { mainHead: localHead, knownCommitIds: sortCommitIds([...remote.knownCommitIds, ...sent]) },
  };
  return {
    nextState,
    outcome: "success",
    changed: true,
    code: "PUSHED",
    affectedCommitIds: sortCommitIds([...sent, localHead]),
    transfer: transferOf(machine, "remote", sent),
  };
}

function clone(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (repo.initialized) return unchanged(state, "rejected", "ALREADY_INITIALIZED");
  const remoteHead = state.remote.mainHead;
  const snapshot = remoteHead === null ? null : state.commits[remoteHead]?.snapshot ?? null;
  if (remoteHead === null || snapshot === null) return unchanged(state, "rejected", "REMOTE_EMPTY");

  const received = ancestorsOf(remoteHead, state.remote.knownCommitIds, state.commits);
  const nextState = withMachine(state, machine, {
    initialized: true,
    working: copySnapshot(snapshot),
    index: copySnapshot(snapshot),
    mainHead: remoteHead,
    originMainHead: remoteHead,
    knownCommitIds: received,
  });
  return {
    nextState,
    outcome: "success",
    changed: true,
    code: "CLONED",
    affectedCommitIds: [...received],
    transfer: transferOf("remote", machine, received),
  };
}

function pull(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  // 1. initialized, and on main (Pull moves `main` and the file)
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!onMain(repo)) return unchanged(state, "rejected", "NOT_ON_MAIN");
  // 2. clean BEFORE fetch (simulator rule)
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  // 3. remote empty: tracking untouched
  const remoteHead = state.remote.mainHead;
  if (remoteHead === null) return unchanged(state, "rejected", "REMOTE_EMPTY");

  // 4. fetch: only ancestors the remote knows; keep IDs and snapshots
  const localKnown = new Set(repo.knownCommitIds);
  const fetched = ancestorsOf(remoteHead, state.remote.knownCommitIds, state.commits).filter((id) => !localKnown.has(id));
  const knownAfterFetch = sortCommitIds([...repo.knownCommitIds, ...fetched]);
  const fetchChanged = fetched.length > 0 || repo.originMainHead !== remoteHead;
  const fetchedRepo: MachineRepository = fetchChanged
    ? { ...repo, knownCommitIds: knownAfterFetch, originMainHead: remoteHead }
    : repo;
  const fetchedState = fetchChanged ? withMachine(state, machine, fetchedRepo) : state;
  const fetchTransfer = transferOf("remote", machine, fetched);

  // 5. up to date or ahead: never move an ahead machine backwards
  if (repo.mainHead === remoteHead || isAncestor(remoteHead, repo.mainHead, knownAfterFetch, state.commits)) {
    if (!fetchChanged) return unchanged(state, "noop", "NO_CHANGE");
    return {
      nextState: fetchedState,
      outcome: "success",
      changed: true,
      code: "FETCHED_UP_TO_DATE",
      affectedCommitIds: [...fetched],
      transfer: fetchTransfer,
    };
  }

  // 6. fast-forward
  const snapshot = state.commits[remoteHead]?.snapshot;
  if (snapshot && isAncestor(repo.mainHead, remoteHead, knownAfterFetch, state.commits)) {
    const nextState = withMachine(state, machine, {
      ...fetchedRepo,
      mainHead: remoteHead,
      working: copySnapshot(snapshot),
      index: copySnapshot(snapshot),
    });
    return {
      nextState,
      outcome: "success",
      changed: true,
      code: "PULLED",
      affectedCommitIds: sortCommitIds([...fetched, remoteHead]),
      transfer: fetchTransfer,
    };
  }

  // 7. diverged: keep the fetch result, leave HEAD/index/working alone
  return {
    nextState: fetchedState,
    outcome: "rejected",
    changed: fetchChanged,
    code: "DIVERGED",
    affectedCommitIds: [...fetched],
    transfer: fetchTransfer,
  };
}

export const MERGE_MESSAGES = {
  ours: "Merge งานจาก GitHub (ใช้ไฟล์ของเรา)",
  theirs: "Merge งานจาก GitHub (ใช้ไฟล์จาก GitHub)",
} as const;

/**
 * Joins a diverged history after Pull has fetched it: a merge commit with two parents (`main` and the fetched
 * `origin/main`). Both sides edited the one file, so the learner picks whose file the merge keeps — the
 * simulator's stand-in for resolving a conflict. Push then works because GitHub's commit is an ancestor.
 */
function merge(state: GitSimulationState, machine: MachineId, keep: "ours" | "theirs"): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!onMain(repo)) return unchanged(state, "rejected", "NOT_ON_MAIN");
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  const origin = repo.originMainHead;
  const ours = headSnapshot(state, repo);
  const theirs = origin === null ? null : state.commits[origin]?.snapshot ?? null;
  if (origin === null || theirs === null || ours === null) return unchanged(state, "rejected", "REMOTE_EMPTY");
  // Already contains GitHub's work, or simply behind (Pull fast-forwards that): nothing to merge.
  if (isAncestor(origin, repo.mainHead, repo.knownCommitIds, state.commits)
    || isAncestor(repo.mainHead, origin, repo.knownCommitIds, state.commits)) return unchanged(state, "noop", "NO_CHANGE");
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return unchanged(state, "rejected", "COMMIT_LIMIT");

  const id = `C${state.nextCommitNumber}`;
  const snapshot = copySnapshot(keep === "ours" ? ours : theirs);
  const nextState: GitSimulationState = {
    ...state,
    commits: {
      ...state.commits,
      [id]: { id, parentId: repo.mainHead, mergeParentId: origin, message: MERGE_MESSAGES[keep], snapshot },
    },
    machines: {
      ...state.machines,
      [machine]: {
        ...repo, mainHead: id, working: copySnapshot(snapshot), index: copySnapshot(snapshot),
        knownCommitIds: sortCommitIds([...repo.knownCommitIds, id]),
      },
    },
    nextCommitNumber: state.nextCommitNumber + 1,
  };
  return { nextState, outcome: "success", changed: true, code: "MERGED", affectedCommitIds: [id], transfer: null };
}

/**
 * Drops this machine's own commits and uncommitted edits and takes GitHub's version (the last fetched
 * `origin/main`). Commits nobody else knows disappear from this machine's list; Undo brings them back.
 */
function resetToRemote(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!onMain(repo)) return unchanged(state, "rejected", "NOT_ON_MAIN");
  const origin = repo.originMainHead;
  const snapshot = origin === null ? null : state.commits[origin]?.snapshot ?? null;
  if (origin === null || snapshot === null) return unchanged(state, "rejected", "REMOTE_EMPTY");
  const knownCommitIds = ancestorsOf(origin, repo.knownCommitIds, state.commits);
  const nextRepo: MachineRepository = { ...repo, mainHead: origin, working: copySnapshot(snapshot), index: copySnapshot(snapshot), knownCommitIds };
  if (jsonEqual(nextRepo, repo)) return unchanged(state, "noop", "NO_CHANGE");
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "RESET_TO_REMOTE", affectedCommitIds: [origin], transfer: null };
}

/** `git switch -c`: needs a commit to branch from; uncommitted work comes along, like in Git. */
function branchCreate(state: GitSimulationState, machine: MachineId, name: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const validation = validateBranchName(repo, name);
  if (!validation.ok) return unchanged(state, "rejected", validation.error === "branch-exists" ? "BRANCH_EXISTS" : "INVALID_BRANCH_NAME");
  const tip = headCommitId(repo);
  if (tip === null) return unchanged(state, "rejected", "NEED_COMMIT_FOR_BRANCH");
  if (Object.keys(repo.branches ?? {}).length >= GIT_LIMITS.branches) return unchanged(state, "rejected", "BRANCH_LIMIT");
  const nextRepo = withBranches(repo, { ...repo.branches, [validation.name]: tip }, validation.name);
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "BRANCH_CREATED", affectedCommitIds: [tip], transfer: null };
}

/** `git switch`: working file and Staging become the target tip. Refused while anything is uncommitted. */
function branchSwitch(state: GitSimulationState, machine: MachineId, name: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!branchExists(repo, name)) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (name === currentBranch(repo)) return unchanged(state, "noop", "NO_CHANGE");
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  const tip = branchTip(repo, name);
  const snapshot = tip === null ? null : state.commits[tip]?.snapshot ?? null;
  if (tip === null || snapshot === null) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  const nextRepo: MachineRepository = { ...withBranches(repo, repo.branches ?? {}, name), working: copySnapshot(snapshot), index: copySnapshot(snapshot) };
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "SWITCHED", affectedCommitIds: [tip], transfer: null };
}

/** `git merge <name>` into the current branch: up to date, fast-forward, or a merge commit with two parents. */
function branchMerge(state: GitSimulationState, machine: MachineId, name: string, keep: "ours" | "theirs" | undefined): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!branchExists(repo, name)) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (name === currentBranch(repo)) return unchanged(state, "rejected", "SAME_BRANCH");
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  const { plan, file } = analyzeBranchMerge(state, machine, name);
  const ours = headCommitId(repo);
  const theirs = branchTip(repo, name);
  if (plan === "unavailable" || ours === null || theirs === null) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (plan === "up-to-date") return unchanged(state, "noop", "NO_CHANGE");

  if (plan === "fast-forward") {
    const snapshot = state.commits[theirs]?.snapshot;
    if (!snapshot) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
    const nextRepo: MachineRepository = { ...moveCurrentBranch(repo, theirs), working: copySnapshot(snapshot), index: copySnapshot(snapshot) };
    return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "FAST_FORWARDED", affectedCommitIds: [theirs], transfer: null };
  }

  let result = file;
  if (plan === "conflict") {
    if (!keep) return unchanged(state, "rejected", "MERGE_CONFLICT");
    result = state.commits[keep === "ours" ? ours : theirs]?.snapshot ?? null;
  }
  if (!result) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return unchanged(state, "rejected", "COMMIT_LIMIT");
  const id = `C${state.nextCommitNumber}`;
  const message = `Merge branch '${name}'`;
  const nextState: GitSimulationState = {
    ...state,
    commits: { ...state.commits, [id]: { id, parentId: ours, mergeParentId: theirs, message, snapshot: copySnapshot(result) } },
    machines: {
      ...state.machines,
      [machine]: {
        ...moveCurrentBranch(repo, id), working: copySnapshot(result), index: copySnapshot(result),
        knownCommitIds: sortCommitIds([...repo.knownCommitIds, id]),
      },
    },
    nextCommitNumber: state.nextCommitNumber + 1,
  };
  return { nextState, outcome: "success", changed: true, code: "BRANCH_MERGED", affectedCommitIds: [id], transfer: null };
}

/** `git branch -d`: only another branch whose work the current branch already contains. Commits stay in the history. */
function branchDelete(state: GitSimulationState, machine: MachineId, name: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!branchExists(repo, name)) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (name === MAIN_BRANCH || name === currentBranch(repo)) return unchanged(state, "rejected", "CANNOT_DELETE_BRANCH");
  const tip = branchTip(repo, name);
  if (tip === null || !isAncestor(tip, headCommitId(repo), repo.knownCommitIds, state.commits)) return unchanged(state, "rejected", "BRANCH_NOT_MERGED");
  const { [name]: _removed, ...rest } = repo.branches ?? {};
  void _removed;
  const nextRepo = withBranches(repo, rest, currentBranch(repo));
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "BRANCH_DELETED", affectedCommitIds: [tip], transfer: null };
}

function reset(state: GitSimulationState): GitTransition {
  const initial = createInitialGitState();
  if (jsonEqual(state, initial)) return unchanged(state, "noop", "NO_CHANGE");
  return { nextState: initial, outcome: "success", changed: true, code: "RESET", affectedCommitIds: [], transfer: null };
}
