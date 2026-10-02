// Pull requests from GitHub, fetched by the backend through gh: what is waiting on the user's review and what
// they opened. Read-only: a row opens the PR next to the list (description, checks, conversation), a link
// there opens it on GitHub. Anything others see (a review, a merge) does not happen from the app without approval (decided 29/9).
export type PR = {
  number: number;
  title: string;
  url: string;
  repo: string;
  draft: boolean;
  created: string;
  updated: string;
  author: string | null;
  review: string | null;
  ci: string | null;
  project: string | null;
};
export type PRs = { mine: PR[]; review: PR[] };

/** A GitHub user as the GraphQL answer names them: null for a deleted account ("ghost"). */
export type GhActor = { login?: string; name?: string } | null;
type Nodes<T> = { nodes?: T[] } | null;
type GhComment = { author: GhActor; createdAt: string; body?: string };
type GhReview = GhComment & { state: string };
export type GhCheck = {
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
  detailsUrl?: string;
  targetUrl?: string;
};
export type GhThread = {
  path: string;
  line?: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments?: Nodes<GhComment>;
};
/** One PR as github_pr returns it: the raw GraphQL answer, as far as the panel reads it. */
export type PrDetail = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: GhActor;
  createdAt: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body?: string;
  mergeable?: string;
  reviewDecision?: string | null;
  commits?: Nodes<{ commit: { statusCheckRollup?: { state?: string; contexts?: Nodes<GhCheck> } | null } }>;
  reviewRequests?: Nodes<{ requestedReviewer?: GhActor }>;
  comments?: Nodes<GhComment>;
  reviews?: Nodes<GhReview>;
  reviewThreads?: Nodes<GhThread>;
  files?: Nodes<{ path: string; additions: number; deletions: number }>;
};
