import type { GitRepo, LineComment } from "../../domain/git/git";
import type { GitCommit, OpenCommit } from "../../domain/git/graph";
import { makeStore } from "../make-store";

type GitState = {
  key: string; // the conversation the drawer is open on
  project: string; // its project, whose repos show
  repos: GitRepo[] | null; // null while loading
  err: string; // loading failed
  errs: Record<string, string>; // per repo: what git or the model said when an action there failed
  running: string; // the repo a git command runs in, "" for none
  folded: Record<string, boolean>; // the repos folded to their header and their groups ("repo\nchanges"), kept over conversations
  message: string; // the commit message being written, one for every repo with staged files
  suggesting: boolean; // a model is writing the commit message
  discard: string; // the file whose discard waits for a confirmation, "repo\npath", "" for none
  open: string; // the file shown, "repo\npath", "" for the list
  line: string; // the line a comment is being written on, "side:line", "" for none
  draft: string;
  comments: Record<string, LineComment[]>; // per conversation, until sent
  logRepo: string; // the repo the log shows, "" (or one no longer listed) for the first
  logAll: boolean; // every branch in the log, else the branch checked out and its upstream
  log: GitCommit[] | null; // null while loading
  logErr: string;
  logHeight: number; // px, dragged on its top edge
  commit: OpenCommit | null; // the commit open in a window over the app
  commitFile: number; // the file of it shown
};

export const useGitStore = makeStore<GitState>(() => ({
  key: "",
  project: "",
  repos: null,
  err: "",
  errs: {},
  running: "",
  folded: {},
  message: "",
  suggesting: false,
  discard: "",
  open: "",
  line: "",
  draft: "",
  comments: {},
  logRepo: "",
  logAll: false,
  log: null,
  logErr: "",
  logHeight: 260,
  commit: null,
  commitFile: 0,
}));
