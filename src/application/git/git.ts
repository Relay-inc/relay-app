import { commentsMessage, stagedDiff, worksIn, type GitFile, type GitRepo } from "../../domain/git/git";
import type { Side } from "../../domain/pull-requests/diff";
import * as backend from "../../infrastructure/backend";
import { fill, prompts, untrusted, untrustedNote } from "../../shared/prompts";
import { useConversationsStore } from "../conversations/store";
import { typedOf } from "../conversations/drafts";
import { typeInto } from "../conversations/actions";
import { useGitStore } from "./store";

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
    }
  });
  try {
    const repos = await backend.gitRepos(key, project);
    if (st().key === key) set(draft => void (draft.repos = repos));
  } catch (err) {
    if (st().key === key) set(draft => void (draft.err = String(err)));
  }
}

/** The drawer follows the open conversation: loaded when it opens on another conversation or project, and again
 *  whenever no turn runs (a turn that ended may have changed files). */
export function followGit(key: string, project: string, busy: boolean) {
  if (st().key !== key || st().project !== project || !busy) void loadGit(key, project);
}

/** A git command in `repo`: its error stays under the repo, the drawer loads again after it either way. */
async function act(repo: string, run: () => Promise<unknown>) {
  const { key, project } = st();
  set(draft => {
    draft.running = repo;
    delete draft.errs[repo];
  });
  try {
    await run();
  } catch (err) {
    set(draft => void (draft.errs[repo] = String(err)));
  }
  set(draft => void (draft.running = ""));
  await loadGit(key, project);
}

/** The checkbox: a staged file is unstaged, any other staged. */
export const toggleStaged = (repo: string, file: GitFile) =>
  act(repo, () => backend.gitStage(st().key, st().project, repo, [file.path], !file.staged));

/** Discard asks first: "" cancels. */
export const askDiscard = (repo: string, path: string) =>
  set(draft => void (draft.discard = repo || path ? `${repo}\n${path}` : ""));
export function discardFile() {
  const [repo, path] = st().discard.split("\n");
  set(draft => void (draft.discard = ""));
  if (st().open === `${repo}\n${path}`) openFile("", "");
  return act(repo, () => backend.gitDiscard(st().key, st().project, repo, path));
}

export const setMessage = (repo: string, text: string) => set(draft => void (draft.messages[repo] = text));

/** A commit message for what is staged, written by the model the app writes with (ai_write). */
export async function suggestMessage(repo: GitRepo) {
  set(draft => {
    draft.suggesting = repo.repo;
    delete draft.errs[repo.repo];
  });
  try {
    const text = await backend.aiWrite(
      fill(prompts.git.commitMessage, { untrusted: untrustedNote("en", ["diff"]) }),
      untrusted("diff", stagedDiff(repo, 20000)),
    );
    set(draft => void (draft.messages[repo.repo] = text.trim()));
  } catch (err) {
    set(draft => void (draft.errs[repo.repo] = String(err)));
  }
  set(draft => void (draft.suggesting = ""));
}

/** Commit what is staged with the repo's message, then push when asked. The message goes once the commit is made. */
export const commitRepo = (repo: string, push: boolean) =>
  act(repo, async () => {
    await backend.gitCommit(st().key, st().project, repo, st().messages[repo]?.trim() ?? "", push);
    set(draft => void (draft.messages[repo] = ""));
  });

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
