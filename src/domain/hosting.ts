// Where the class keeps its code: the Git and SSH simulators can show GitHub or GitLab (same Git, different names).
// A widget without a `host` shows GitHub (documents made before the switch existed).

export type HostId = "github" | "gitlab";

export type Host = {
  id: HostId;
  /** Brand name shown on the board and in messages. */
  name: string;
  /** SSH address used by `ssh -T` and remote URLs (`git@<sshHost>:team/repo.git`). */
  sshHost: string;
  /** Where a public key is pasted on the website. */
  keysPage: string;
  /** What a request to merge a branch is called on this site. */
  mergeRequest: string;
  /** Short form of `mergeRequest` (PR / MR). */
  mergeRequestShort: string;
  /** What `ssh -T` answers once the key is accepted. */
  sshWelcome: string;
};

export const HOSTS: Record<HostId, Host> = {
  github: {
    id: "github", name: "GitHub", sshHost: "github.com", keysPage: "Settings → SSH keys",
    mergeRequest: "Pull Request", mergeRequestShort: "PR",
    sshWelcome: "Hi you! You've successfully authenticated, but GitHub does not provide shell access.",
  },
  gitlab: {
    id: "gitlab", name: "GitLab", sshHost: "gitlab.com", keysPage: "Preferences → SSH Keys",
    mergeRequest: "Merge Request", mergeRequestShort: "MR",
    sshWelcome: "Welcome to GitLab, @you!",
  },
};

export const hostOf = (id: HostId | undefined): Host => HOSTS[id ?? "github"];
