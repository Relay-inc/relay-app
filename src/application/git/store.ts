import type { GitRepo, LineComment } from "../../domain/git/git";
import { makeStore } from "../make-store";

type GitState = {
  key: string; // the conversation the drawer is open on
  project: string; // its project, whose repos show
  repos: GitRepo[] | null; // null while loading
  err: string; // loading failed
  errs: Record<string, string>; // per repo: what git or the model said when an action there failed
  running: string; // the repo a git command runs in, "" for none
  messages: Record<string, string>; // per repo, the commit message being written
  suggesting: string; // the repo whose commit message a model is writing
  discard: string; // the file whose discard waits for a confirmation, "repo\npath", "" for none
  open: string; // the file shown, "repo\npath", "" for the list
  line: string; // the line a comment is being written on, "side:line", "" for none
  draft: string;
  comments: Record<string, LineComment[]>; // per conversation, until sent
};

export const useGitStore = makeStore<GitState>(() => ({
  key: "",
  project: "",
  repos: null,
  err: "",
  errs: {},
  running: "",
  messages: {},
  suggesting: "",
  discard: "",
  open: "",
  line: "",
  draft: "",
  comments: {},
}));
