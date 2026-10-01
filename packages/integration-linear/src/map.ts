import type { BoardOpt, BoardRef, Card, Column, Opt, State } from "@relay/board-core";

// Linear's GraphQL answers turned into the board's shapes, and the queries that ask for them. No imports
// with side effects, so the tests (tests/map.test.ts) run it in plain Node on fixture JSON.

/** The one mutation the backend lets through (src/lib.rs, MOVE): an issue to another workflow state. */
export const MOVE = "mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { id sortOrder } } }";
export const VIEWER = "query Viewer { viewer { id name displayName } }";
export const TEAMS = "query Teams { teams(first: 100) { nodes { id name key projects(first: 50) { nodes { id name } } } } }";
export const STATES = "query States($id: String!) { team(id: $id) { states(first: 100) { nodes { id name type position } } } }";
export const ISSUES = "query Issues($filter: IssueFilter, $after: String) { issues(first: 100, after: $after, filter: $filter) { nodes { id identifier title priority url sortOrder dueDate updatedAt state { id name type } labels { nodes { name } } assignee { name displayName } } pageInfo { hasNextPage endCursor } } }";
export const ISSUE_URL = "query Url($id: String!) { issue(id: $id) { url } }";

/** Workflow state types in board order: triage first when a team uses it, closed states last. */
export const TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const CLOSED = ["completed", "canceled"];
/** At most this many pages of 100 issues per board. */
export const MAX_PAGES = 10;

/** A workflow state type as the board's three kinds. */
const stateOf = (type: string): State => (CLOSED.includes(type) ? "done" : type === "started" ? "doing" : "todo");
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name);

/** `teams` as projects, and per team the whole team (board id = team id) followed by its Linear projects. */
export function mapTeams(data: any, allIssues: string): { projects: Opt[]; boards: BoardOpt[] } {
  const teams = (data?.teams?.nodes || []).map((t: any) => ({ id: t.id, name: t.name, projects: t.projects?.nodes || [] })).sort(byName);
  return {
    projects: teams.map((t: any) => ({ id: t.id, name: t.name })),
    boards: teams.flatMap((t: any) => [{ id: t.id, name: allIssues, project: t.id, group: t.name },
      ...t.projects.map((p: any) => ({ id: p.id, name: p.name, project: t.id, group: t.name })).sort(byName)]),
  };
}

/** A team's workflow states by type (TYPES) then position; completed and canceled only with `done`. */
export function mapStates(data: any, done: boolean): Column[] {
  const rank = (s: any) => { const i = TYPES.indexOf(s.type); return i < 0 ? TYPES.length : i; };
  return (data?.team?.states?.nodes || []).filter((s: any) => done || !CLOSED.includes(s.type))
    .sort((a: any, b: any) => rank(a) - rank(b) || (Number(a.position) || 0) - (Number(b.position) || 0))
    .map((s: any, i: number) => ({ id: s.id, name: s.name, placement: i, ...(s.type ? { state: stateOf(s.type) } : {}) }));
}

/** The issue filter for a board: the team, the Linear project unless the board is the whole team, open states unless `done`. */
export function issueFilter(ref: BoardRef, done: boolean): Record<string, unknown> {
  const f: Record<string, unknown> = { team: { id: { eq: ref.project } } };
  if (ref.board && ref.board !== ref.project) f.project = { id: { eq: ref.board } };
  if (!done) f.state = { type: { nin: CLOSED } };
  return f;
}

/** One page of `issues` as cards, with each issue's url, and the cursor of the next page (null on the last). */
export function mapIssues(data: any): { cards: Card[]; urls: [string, string][]; next: string | null } {
  const c = data?.issues;
  const nodes = c?.nodes || [];
  return {
    cards: nodes.map((i: any) => ({ id: i.id, title: i.title, number: i.identifier || "", column: i.state?.id || "",
      placement: Number(i.sortOrder) || 0, due: typeof i.dueDate === "string" ? i.dueDate.slice(0, 10) : null,
      who: String(i.assignee?.displayName || i.assignee?.name || "").split(" ")[0], priority: Number(i.priority) || 0,
      ...(i.state?.name ? { status: i.state.name } : {}), ...(i.state?.type ? { state: stateOf(i.state.type) } : {}),
      ...(i.labels?.nodes?.length ? { labels: i.labels.nodes.map((l: any) => l.name) } : {}), ...(i.updatedAt ? { updated: i.updatedAt } : {}) })),
    urls: nodes.filter((i: any) => i.url).map((i: any) => [i.id, i.url]),
    next: c?.pageInfo?.hasNextPage && c.pageInfo.endCursor ? c.pageInfo.endCursor : null,
  };
}

/** Every page of issues, `page(after)` fetching one, stopping after MAX_PAGES. */
export async function allIssues(page: (after: string | null) => Promise<any>) {
  const cards: Card[] = [], urls: [string, string][] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_PAGES; n++) {
    const r = mapIssues(await page(after));
    cards.push(...r.cards); urls.push(...r.urls);
    if (!(after = r.next)) break;
  }
  return { cards, urls };
}
