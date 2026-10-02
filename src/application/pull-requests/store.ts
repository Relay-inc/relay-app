import type { PRs } from "../../domain/pull-requests/types";
import { makeStore } from "../make-store";

type PullRequestsState = { list: PRs | null; err: string; busy: boolean; at: number /* when the list arrived, ms */ };

export const usePullRequestsStore = makeStore<PullRequestsState>(() => ({ list: null, err: "", busy: false, at: 0 }));
