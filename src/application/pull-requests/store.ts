import type { PRs } from "../../domain/pull-requests/types";
import { makeStore } from "../make-store";

type PullRequestsState = {
  list: PRs | null;
  err: string;
  busy: boolean;
  at: number; // when the list arrived, ms
  repos: Record<string, string[]>; // the GitHub repos per vault project: the title bar shows the PRs button for one that has some
  asks: Record<string, string[]>; // per conversation: repos it committed to that no project has, waiting for an answer
};

export const usePullRequestsStore = makeStore<PullRequestsState>(() => ({
  list: null,
  err: "",
  busy: false,
  at: 0,
  repos: {},
  asks: {},
}));
