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
import { hasConflictMarkers, mergeCommitMessage } from "./merge3";
import {
  MAIN_BRANCH,
  analyzeBranchMerge,
  ancestorsOf,
  branchExists,
  branchTip,
  findRequest,
  openRequestFor,
  requestInfo,
  copySnapshot,
  currentBranch,
  headCommitId,
  headSnapshot,
  isAncestor,
  isClean,
  jsonEqual,
  snapshotsEqual,
  sortCommitIds,
  threeWayMerge,
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
    case "push": return push(state, action.machine, action.review === true);
    case "clone": return clone(state, action.machine);
    case "pull": return pull(state, action.machine, action.review === true);
    case "mrOpen": return mrOpen(state, action.machine);
    case "mrApprove": return mrApprove(state, action.machine, action.id);
    case "mrMerge": return mrMerge(state, action.machine, action.id);
    case "mergeTake": return mergeTake(state, action.machine, action.side);
    case "mergeAbort": return mergeAbort(state, action.machine);
    case "resetToRemote": return resetToRemote(state, action.machine);
    case "branchCreate": return branchCreate(state, action.machine, action.name);
    case "branchSwitch": return branchSwitch(state, action.machine, action.name);
    case "branchMerge": return branchMerge(state, action.machine, action.name);
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

/** The repository without its unfinished merge (the merge was committed, aborted or thrown away). */
function withoutMerging(repo: MachineRepository): MachineRepository {
  const { merging: _merging, ...rest } = repo;
  void _merging;
  return rest;
}

type MergeStart =
  | { ok: true; result: "merged" | "conflict"; state: GitSimulationState; id: CommitId | null }
  | { ok: false; result: "limit" | "missing" };

/**
 * `git merge` of `theirs` into the current branch, after the history is known to have forked. The files are joined
 * line by line (merge3): a merge commit right away when Git can do it by itself; otherwise nothing is committed —
 * the working file and Staging get the conflict markers and the machine enters the merging state.
 */
function startMerge(state: GitSimulationState, machine: MachineId, theirs: CommitId, label: string): MergeStart {
  const repo = state.machines[machine];
  const ours = headCommitId(repo);
  if (ours === null) return { ok: false, result: "missing" };
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return { ok: false, result: "limit" };
  const merged = threeWayMerge(state, repo, ours, theirs, label);
  if (!merged) return { ok: false, result: "missing" };
  if (merged.conflicts) {
    const nextRepo: MachineRepository = { ...repo, working: copySnapshot(merged.file), index: copySnapshot(merged.file), merging: { theirs, label } };
    return { ok: true, result: "conflict", state: withMachine(state, machine, nextRepo), id: null };
  }
  const id = `C${state.nextCommitNumber}`;
  const nextRepo: MachineRepository = {
    ...moveCurrentBranch(repo, id), working: copySnapshot(merged.file), index: copySnapshot(merged.file),
    knownCommitIds: sortCommitIds([...repo.knownCommitIds, id]),
  };
  const next: GitSimulationState = {
    ...withMachine(state, machine, nextRepo),
    commits: { ...state.commits, [id]: { id, parentId: ours, mergeParentId: theirs, message: mergeCommitMessage(label), snapshot: copySnapshot(merged.file) } },
    nextCommitNumber: state.nextCommitNumber + 1,
  };
  return { ok: true, result: "merged", state: next, id };
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
  // Precedence: message → staged changes (while merging: markers left) → commit limit.
  const validation = validateCommitMessage(message);
  if (!validation.ok) return unchanged(state, "rejected", "INVALID_MESSAGE");
  const merging = repo.merging;
  // While merging the Commit finishes the merge, so a file equal to HEAD is fine — but never one with markers in it.
  if (repo.index === null || (!merging && snapshotsEqual(repo.index, headSnapshot(state, repo)))) return unchanged(state, "rejected", "NOTHING_STAGED");
  if (merging && hasConflictMarkers(repo.index.content)) return unchanged(state, "rejected", "UNRESOLVED_CONFLICT");
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return unchanged(state, "rejected", "COMMIT_LIMIT");

  const id = `C${state.nextCommitNumber}`;
  const nextState: GitSimulationState = {
    ...state,
    commits: {
      ...state.commits,
      [id]: { id, parentId: headCommitId(repo), ...(merging ? { mergeParentId: merging.theirs } : {}), message: validation.message, snapshot: copySnapshot(repo.index) },
    },
    machines: {
      ...state.machines,
      [machine]: { ...moveCurrentBranch(withoutMerging(repo), id), knownCommitIds: sortCommitIds([...repo.knownCommitIds, id]) },
    },
    nextCommitNumber: state.nextCommitNumber + 1,
  };
  return { nextState, outcome: "success", changed: true, code: merging ? "MERGED" : "COMMITTED", affectedCommitIds: [id], transfer: null };
}

/**
 * `git push -u origin <branch>` in the review lesson: the branch (and the commits only it has) goes to the remote, which
 * keeps it next to main. Open Merge Requests of that branch see the new commits at once.
 */
function pushBranch(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  const name = currentBranch(repo);
  const tip = branchTip(repo, name);
  if (tip === null) return unchanged(state, "rejected", "NO_LOCAL_COMMITS");
  const remote = state.remote;
  // The remote needs its main first (the first push of main is the project's starting point).
  if (remote.mainHead === null) return unchanged(state, "rejected", "REMOTE_EMPTY");
  const pushed = remote.branches?.[name];
  if (pushed === tip) return unchanged(state, "noop", "NO_CHANGE");
  if (pushed !== undefined && !isAncestor(pushed, tip, repo.knownCommitIds, state.commits)) return unchanged(state, "rejected", "NON_FAST_FORWARD");
  const remoteKnown = new Set(remote.knownCommitIds);
  const sent = ancestorsOf(tip, repo.knownCommitIds, state.commits).filter((id) => !remoteKnown.has(id));
  const nextState: GitSimulationState = {
    ...state,
    remote: { ...remote, knownCommitIds: sortCommitIds([...remote.knownCommitIds, ...sent]), branches: { ...remote.branches, [name]: tip } },
  };
  return { nextState, outcome: "success", changed: true, code: "BRANCH_PUSHED", affectedCommitIds: sortCommitIds([...sent, tip]), transfer: transferOf(machine, "remote", sent) };
}

function push(state: GitSimulationState, machine: MachineId, review: boolean): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (repo.merging) return unchanged(state, "rejected", "MERGE_IN_PROGRESS");
  if (review && !onMain(repo)) return pushBranch(state, machine);
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

  // Review lesson: main is protected once it exists (the first push creates the project).
  if (review && remote.mainHead !== null) return unchanged(state, "rejected", "MAIN_PROTECTED");
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

function pull(state: GitSimulationState, machine: MachineId, review: boolean): GitTransition {
  const repo = state.machines[machine];
  // 1. initialized, and on main (Pull moves `main` and the file). The review lesson also allows a branch:
  // `git pull origin main` there brings origin/main into that branch.
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (repo.merging) return unchanged(state, "rejected", "MERGE_IN_PROGRESS");
  if (!review && !onMain(repo)) return unchanged(state, "rejected", "NOT_ON_MAIN");
  const tip = headCommitId(repo);
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
  if (tip === remoteHead || isAncestor(remoteHead, tip, knownAfterFetch, state.commits)) {
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
  if (snapshot && isAncestor(tip, remoteHead, knownAfterFetch, state.commits)) {
    const nextState = withMachine(state, machine, {
      ...moveCurrentBranch(fetchedRepo, remoteHead),
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

  // 7. diverged: merge origin/main into main — Git joins the files by itself, or stops on conflicts
  const started = startMerge(fetchedState, machine, remoteHead, "origin/main");
  if (!started.ok) {
    return { nextState: fetchedState, outcome: "rejected", changed: fetchChanged, code: "COMMIT_LIMIT", affectedCommitIds: [...fetched], transfer: fetchTransfer };
  }
  return {
    nextState: started.state,
    outcome: "success",
    changed: true,
    code: started.result === "merged" ? "AUTO_MERGED" : "MERGE_CONFLICT",
    affectedCommitIds: sortCommitIds([...fetched, ...(started.id ? [started.id] : [])]),
    transfer: fetchTransfer,
  };
}

// ---------------------------------------------------------------------------
// Merge Requests (review lesson)
// ---------------------------------------------------------------------------

function withRemote(state: GitSimulationState, remote: GitSimulationState["remote"], commits = state.commits): GitSimulationState {
  return { ...state, commits, remote };
}

/** Opens a Merge Request for the current branch: it must be pushed and have something main lacks. */
function mrOpen(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const source = currentBranch(repo);
  if (source === MAIN_BRANCH) return unchanged(state, "rejected", "MR_NEED_BRANCH");
  const { remote } = state;
  const tip = remote.branches?.[source];
  if (tip === undefined || remote.mainHead === null) return unchanged(state, "rejected", "MR_NOT_PUSHED");
  if (isAncestor(tip, remote.mainHead, remote.knownCommitIds, state.commits)) return unchanged(state, "rejected", "MR_NOTHING_NEW");
  if (openRequestFor(state, source)) return unchanged(state, "rejected", "MR_EXISTS");
  const requests = remote.requests ?? [];
  if (requests.length >= GIT_LIMITS.requests) return unchanged(state, "rejected", "MR_LIMIT");
  const request = { id: requests.length + 1, source, target: "main" as const, title: state.commits[tip]?.message ?? source, status: "open" as const, author: machine, approvedBy: [] };
  return { nextState: withRemote(state, { ...remote, requests: [...requests, request] }), outcome: "success", changed: true, code: "MR_OPENED", affectedCommitIds: [tip], transfer: null };
}

/** The teammate approves. The author cannot approve their own request. */
function mrApprove(state: GitSimulationState, machine: MachineId, id: number): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const request = findRequest(state, id);
  if (!request || request.status !== "open") return unchanged(state, "rejected", "MR_NOT_FOUND");
  if (request.author === machine) return unchanged(state, "rejected", "MR_SELF_APPROVE");
  if (request.approvedBy.includes(machine)) return unchanged(state, "noop", "NO_CHANGE");
  const requests = (state.remote.requests ?? []).map((item) => item.id === id ? { ...item, approvedBy: [...item.approvedBy, machine] } : item);
  return { nextState: withRemote(state, { ...state.remote, requests }), outcome: "success", changed: true, code: "MR_APPROVED", affectedCommitIds: [], transfer: null };
}

/**
 * Merges an approved request into the remote's main — a fast-forward when main has not moved, otherwise a merge
 * commit made on the remote — then the request is merged and its source branch is deleted on the remote.
 * Refused when main and the branch changed the same lines (the branch must be fixed and pushed again).
 */
function mrMerge(state: GitSimulationState, machine: MachineId, id: number): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const request = findRequest(state, id);
  const info = request ? requestInfo(state, request) : null;
  if (!request || !info) return unchanged(state, "rejected", "MR_NOT_FOUND");
  if (!info.approved) return unchanged(state, "rejected", "MR_NOT_APPROVED");
  if (info.conflict) return unchanged(state, "rejected", "MR_CONFLICT");
  const { remote } = state;
  const tip = remote.branches![request.source];
  const main = remote.mainHead!;
  const { [request.source]: _gone, ...otherBranches } = remote.branches!;
  void _gone;
  const requests = (remote.requests ?? []).map((item) => item.id === id ? { ...item, status: "merged" as const } : item);
  const settled = { branches: Object.keys(otherBranches).length ? otherBranches : undefined, requests };
  const { branches: _branches, ...remoteRest } = remote;
  void _branches;
  const finish = (next: GitSimulationState["remote"], code: "MR_MERGED" | "MR_FAST_FORWARDED", head: CommitId, commits = state.commits): GitTransition => ({
    nextState: withRemote(state, { ...next, ...(settled.branches ? { branches: settled.branches } : {}), requests: settled.requests }, commits),
    outcome: "success", changed: true, code, affectedCommitIds: [head], transfer: null,
  });
  if (isAncestor(tip, main, remote.knownCommitIds, state.commits)) return finish({ ...remoteRest }, "MR_FAST_FORWARDED", main); // already contained: only bookkeeping
  if (info.fastForward) return finish({ ...remoteRest, mainHead: tip }, "MR_FAST_FORWARDED", tip);
  if (Object.keys(state.commits).length >= GIT_LIMITS.commits) return unchanged(state, "rejected", "COMMIT_LIMIT");
  const merged = threeWayMerge(state, remote, main, tip, request.source);
  if (!merged) return unchanged(state, "rejected", "MR_NOT_FOUND");
  const commitId = `C${state.nextCommitNumber}`;
  const commit = { id: commitId, parentId: main, mergeParentId: tip, message: `Merge branch '${request.source}' (!${id})`, snapshot: copySnapshot(merged.file) };
  const next = finish({ ...remoteRest, mainHead: commitId, knownCommitIds: sortCommitIds([...remote.knownCommitIds, commitId]) }, "MR_MERGED", commitId, { ...state.commits, [commitId]: commit });
  return { ...next, nextState: { ...next.nextState, nextCommitNumber: state.nextCommitNumber + 1 } };
}

/** While merging: the working file becomes one side's file (like deleting the other half of every conflict by hand). */
function mergeTake(state: GitSimulationState, machine: MachineId, side: "ours" | "theirs"): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (!repo.merging) return unchanged(state, "rejected", "NOT_MERGING");
  const snapshot = side === "ours" ? headSnapshot(state, repo) : state.commits[repo.merging.theirs]?.snapshot ?? null;
  if (!snapshot) return unchanged(state, "rejected", "NOT_MERGING");
  if (snapshotsEqual(snapshot, repo.working)) return unchanged(state, "noop", "NO_CHANGE");
  return { nextState: withMachine(state, machine, { ...repo, working: copySnapshot(snapshot) }), outcome: "success", changed: true, code: "MERGE_TAKEN", affectedCommitIds: [], transfer: null };
}

/** `git merge --abort`: back to how HEAD was before the merge started (it only starts from a clean tree). */
function mergeAbort(state: GitSimulationState, machine: MachineId): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  const snapshot = headSnapshot(state, repo);
  if (!repo.merging || !snapshot) return unchanged(state, "rejected", "NOT_MERGING");
  const nextRepo: MachineRepository = { ...withoutMerging(repo), working: copySnapshot(snapshot), index: copySnapshot(snapshot) };
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "MERGE_ABORTED", affectedCommitIds: [], transfer: null };
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
  const nextRepo: MachineRepository = { ...withoutMerging(repo), mainHead: origin, working: copySnapshot(snapshot), index: copySnapshot(snapshot), knownCommitIds };
  if (jsonEqual(nextRepo, repo)) return unchanged(state, "noop", "NO_CHANGE");
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "RESET_TO_REMOTE", affectedCommitIds: [origin], transfer: null };
}

/** `git switch -c`: needs a commit to branch from; uncommitted work comes along, like in Git. */
function branchCreate(state: GitSimulationState, machine: MachineId, name: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (repo.merging) return unchanged(state, "rejected", "MERGE_IN_PROGRESS");
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
  if (repo.merging) return unchanged(state, "rejected", "MERGE_IN_PROGRESS");
  if (!branchExists(repo, name)) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (name === currentBranch(repo)) return unchanged(state, "noop", "NO_CHANGE");
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  const tip = branchTip(repo, name);
  const snapshot = tip === null ? null : state.commits[tip]?.snapshot ?? null;
  if (tip === null || snapshot === null) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  const nextRepo: MachineRepository = { ...withBranches(repo, repo.branches ?? {}, name), working: copySnapshot(snapshot), index: copySnapshot(snapshot) };
  return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "SWITCHED", affectedCommitIds: [tip], transfer: null };
}

/** `git merge <name>` into the current branch: up to date, fast-forward, a merge commit Git makes itself, or a conflict to fix. */
function branchMerge(state: GitSimulationState, machine: MachineId, name: string): GitTransition {
  const repo = state.machines[machine];
  if (!repo.initialized) return unchanged(state, "rejected", "NOT_INITIALIZED");
  if (repo.merging) return unchanged(state, "rejected", "MERGE_IN_PROGRESS");
  if (!branchExists(repo, name)) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (name === currentBranch(repo)) return unchanged(state, "rejected", "SAME_BRANCH");
  if (!isClean(state, machine)) return unchanged(state, "rejected", "DIRTY_WORKTREE");
  const { plan } = analyzeBranchMerge(state, machine, name);
  const theirs = branchTip(repo, name);
  if (plan === "unavailable" || theirs === null) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
  if (plan === "up-to-date") return unchanged(state, "noop", "NO_CHANGE");

  if (plan === "fast-forward") {
    const snapshot = state.commits[theirs]?.snapshot;
    if (!snapshot) return unchanged(state, "rejected", "BRANCH_NOT_FOUND");
    const nextRepo: MachineRepository = { ...moveCurrentBranch(repo, theirs), working: copySnapshot(snapshot), index: copySnapshot(snapshot) };
    return { nextState: withMachine(state, machine, nextRepo), outcome: "success", changed: true, code: "FAST_FORWARDED", affectedCommitIds: [theirs], transfer: null };
  }

  const started = startMerge(state, machine, theirs, name);
  if (!started.ok) return unchanged(state, "rejected", started.result === "limit" ? "COMMIT_LIMIT" : "BRANCH_NOT_FOUND");
  return {
    nextState: started.state, outcome: "success", changed: true,
    code: started.result === "merged" ? "BRANCH_MERGED" : "MERGE_CONFLICT",
    affectedCommitIds: started.id ? [started.id] : [], transfer: null,
  };
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
