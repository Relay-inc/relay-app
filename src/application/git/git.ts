import { commentsMessage, stagedDiff, worksIn, type GitFile, type GitRepo } from "../../domain/git/git";
import type { Side } from "../../domain/pull-requests/diff";
import * as backend from "../../infrastructure/backend";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts";
import { useConversationsStore } from "../conversations/store";
import { typedOf } from "../conversations/drafts";
import { typeInto } from "../conversations/actions";
import { useGitStore } from "./store";
import type { GitCommit } from "../../domain/git/graph";

// The Git drawer of a project (domain/git/git.ts): its checkouts as git sees them, staging, discarding, committing
// and pushing, the file open, and the comments on its lines that go back to the agent as one message in the composer.
const st = () => useGitStore.getState();
const set = useGitStore.setState;

export async function loadGit(key: string, project: string) {
  const fresh = st().key !== key || st().project !== project;
  set(draft => {
    draft.key = key;
    draft.project = project;
    draft.err = "";
    if (fresh) {
      draft.repos = null;
      draft.errs = {};
      draft.discard = "";
      draft.open = "";
      draft.line = "";
      draft.draft = "";
      draft.log = null;
      draft.logErr = "";
    }
  });
  try {
    const repos = await backend.gitRepos(key, project);
    if (st().key === key) set(draft => void (draft.repos = repos));
  } catch (err) {
    if (st().key === key) set(draft => void (draft.err = String(err)));
  }
  await loadLog();
}

// ---------- the log under the commit box: one repo at a time, folded under "\nlog"
export const LOG = "\nlog";
/** The repo the log shows: the one picked while it is listed, else the first. */
export const logRepoOf = (repos: GitRepo[] | null, picked: string) =>
  (repos ?? []).find(r => r.repo === picked) ?? repos?.[0];

/** The log read again, unless it is folded: it follows every load of the drawer (a commit, a turn that ended). */
export async function loadLog() {
  const { key, project, repos, logRepo, logAll, folded } = st();
  const repo = logRepoOf(repos, logRepo)?.repo;
  if (!repo || folded[LOG]) return;
  try {
    const log = await backend.gitLog(key, project, repo, logAll);
    // a pick or a switch while it ran: that load wins
    if (st().key === key && logRepoOf(st().repos, st().logRepo)?.repo === repo && st().logAll === logAll)
      set(draft => {
        draft.log = log;
        draft.logErr = "";
      });
  } catch (err) {
    if (st().key === key) set(draft => void (draft.logErr = String(err)));
  }
}
export function pickLogRepo(repo: string) {
  set(draft => {
    draft.logRepo = repo;
    draft.log = null;
  });
  void loadLog();
}
export function toggleLogAll() {
  set(draft => {
    draft.logAll = !draft.logAll;
    draft.log = null;
  });
  void loadLog();
}
export function toggleLog() {
  toggleFold(LOG);
  void loadLog();
}
export const toggleSplit = () => set(draft => void (draft.split = !draft.split));
export const setLogHeight = (px: number) => set(draft => void (draft.logHeight = px));

/** A commit of the log in a window over the app: its message and its files, one diff at a time. */
export async function openCommit(repo: string, commit: GitCommit) {
  const { key, project } = st();
  set(draft => {
    draft.commit = { repo, commit, body: commit.subject, files: null, err: "" };
    draft.commitFile = 0;
  });
  const mine = () => st().commit?.commit.hash === commit.hash;
  try {
    const { body, files } = await backend.gitShow(key, project, repo, commit.hash);
    if (mine()) set(draft => void Object.assign(draft.commit!, { body, files }));
  } catch (err) {
    if (mine()) set(draft => void (draft.commit!.err = String(err)));
  }
}
export const closeCommit = () => set(draft => void (draft.commit = null));
export const showCommitFile = (at: number) => set(draft => void (draft.commitFile = at));

/** The drawer follows the open conversation: loaded when it opens on another conversation or project, and again
 *  whenever no turn runs (a turn that ended may have changed files). */
export function followGit(key: string, project: string, busy: boolean) {
  if (st().key !== key || st().project !== project || !busy) void loadGit(key, project);
}

/** A git command in `repo`: its error stays under the repo, the drawer loads again after it either way. False when
 *  it failed. */
async function act(repo: string, run: () => Promise<unknown>) {
  let ok = true;
  const { key, project } = st();
  set(draft => {
    draft.running = repo;
    delete draft.errs[repo];
  });
  try {
    await run();
  } catch (err) {
    ok = false;
    set(draft => void (draft.errs[repo] = String(err)));
  }
  set(draft => void (draft.running = ""));
  await loadGit(key, project);
  return ok;
}

/** The checkbox: a staged file is unstaged, any other staged. */
export const toggleStaged = (repo: string, file: GitFile) =>
  act(repo, () => backend.gitStage(st().key, st().project, repo, [file.path], !file.staged));

/** A repo folded to its header, or a group of its files ("repo\nchanges"), or open again. */
export const toggleFold = (what: string) => set(draft => void (draft.folded[what] = !draft.folded[what]));

/** Discard asks first: "" cancels. */
export const askDiscard = (repo: string, path: string) =>
  set(draft => void (draft.discard = repo || path ? `${repo}\n${path}` : ""));
export function discardFile() {
  const [repo, path] = st().discard.split("\n");
  set(draft => void (draft.discard = ""));
  if (st().open === `${repo}\n${path}`) openFile("", "");
  return act(repo, () => backend.gitDiscard(st().key, st().project, repo, path));
}

export const setMessage = (text: string) => set(draft => void (draft.message = text));

/** The repos with something staged: a commit goes to each of them. */
export const stagedRepos = (repos: GitRepo[] | null) => (repos ?? []).filter(r => r.files.some(f => f.staged));

/** One commit message for what is staged over every repo, written by the model the app writes with (ai_write). */
export async function suggestMessage(repos: GitRepo[]) {
  set(draft => {
    draft.suggesting = true;
    draft.err = "";
  });
  try {
    const diff = repos.map(r => `=== ${r.name}\n${stagedDiff(r, 20000 / repos.length)}`).join("\n\n");
    const text = await backend.aiWrite(
      fill(prompts.git.commitMessage, { untrusted: untrustedNote("en", ["diff"]) }),
      untrusted("diff", diff),
    );
    set(draft => void (draft.message = text.trim()));
  } catch (err) {
    set(draft => void (draft.err = String(err)));
  }
  set(draft => void (draft.suggesting = false));
}

/** The one message committed in every repo with something staged, one repo after the other, each pushed when asked.
 *  The message stays until every commit went through, so a failed repo can go again with it. */
export async function commitStaged(repos: string[], push: boolean) {
  const message = st().message.trim();
  let ok = true;
  for (const repo of repos)
    ok = (await act(repo, () => backend.gitCommit(st().key, st().project, repo, message, push))) && ok;
  if (ok) set(draft => void (draft.message = ""));
}

/** Pull the repo from its upstream, fast-forward only: git's error under the repo when it went its own way. */
export const pullRepo = (repo: string) => act(repo, () => backend.gitPull(st().key, st().project, repo));

/** The repos a commit would take an agent's half-done work in: a running conversation of the project works there (a
 *  tool call names the checkout), or the open conversation runs and made that worktree. */
export function busyRepos(): string[] {
  const { key, project, repos } = st();
  const cs = useConversationsStore.getState();
  // ponytail: scans every tool call of the running conversations on each store change while the drawer is open, cache per item if it shows in perf
  const running = Object.values(cs.chats).filter(
    c => c.project === project && !c.closed && cs.status[c.key] === "busy",
  );
  return (repos ?? [])
    .filter(r => running.some(c => (r.made && c.key === key) || worksIn(cs.messages[c.key], r.repo)))
    .map(r => r.repo);
}

export const openFile = (repo: string, path: string) =>
  set(draft => {
    draft.open = repo || path ? `${repo}\n${path}` : "";
    draft.line = "";
    draft.draft = "";
  });

/** Open or close the comment box on a line ("side:line"). */
export const pickLine = (line: string) =>
  set(draft => {
    draft.line = draft.line === line ? "" : line;
    draft.draft = "";
  });
export const setLineDraft = (text: string) => set(draft => void (draft.draft = text));

let counter = 0;
export function addComment(repo: string, path: string, side: Side, line: number, code: string) {
  const body = st().draft.trim();
  if (!body) return;
  set(draft => {
    (draft.comments[draft.key] ??= []).push({ id: `c${++counter}`, repo, path, line, side, code, body });
    draft.line = "";
    draft.draft = "";
  });
}
export const removeComment = (id: string) =>
  set(draft => {
    draft.comments[draft.key] = (draft.comments[draft.key] ?? []).filter(c => c.id !== id);
  });

/** The comments go in the composer, after what is typed there, for the user to send. */
export function sendComments(repos: GitRepo[]) {
  const key = st().key;
  const comments = st().comments[key] ?? [];
  if (!comments.length) return;
  const typed = typedOf(key);
  typeInto(key, `${typed ? `${typed}\n\n` : ""}${commentsMessage(comments, repos.length > 1)}`);
  set(draft => void (draft.comments[key] = []));
}
