import type { BoardOpt, Card, Column, Opt, State } from "@relay/board-core";
import { toneOf } from "@relay/board-core/tone";

// GitHub's GraphQL answers for Projects (v2) turned into the board's shapes, and the queries that ask for them. No
// imports with side effects, so the tests (tests/map.test.ts) run it in plain Node on fixture JSON.

const projects = "projectsV2(first: 100) { nodes { id title closed } }";
/** The user and the organizations they are in, each with its projects: the two levels of the board picker. */
export const BOARDS = `query Boards { viewer { login name ${projects} organizations(first: 100) { nodes { login name ${projects} } } } }`;
/** A project's single-select fields (the Status field is its board's columns) and its page. */
export const FIELDS = "query Fields($id: ID!) { node(id: $id) { ... on ProjectV2 { url fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } } } } }";
const people = "assignees(first: 3) { nodes { login name } }";
const ticket = `number title url state ${people} labels(first: 10) { nodes { name } }`;
export const ITEMS = `query Items($id: ID!, $after: String, $field: String!) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { nodes { id isArchived updatedAt fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { optionId } } content { __typename ... on DraftIssue { title ${people} } ... on Issue { ${ticket} } ... on PullRequest { ${ticket} } } } pageInfo { hasNextPage endCursor } } } } }`;
/** The mutations the backend lets through (src/lib.rs, matched exactly): an item to another option of the Status
 *  field, to No status, and a new draft item. */
export const MOVE = "mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!) { updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { projectV2Item { id } } }";
export const CLEAR = "mutation Clear($project: ID!, $item: ID!, $field: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) { projectV2Item { id } } }";
export const CREATE = "mutation Create($project: ID!, $title: String!, $body: String!) { addProjectV2DraftIssue(input: { projectId: $project, title: $title, body: $body }) { projectItem { id } } }";

/** The column of the items without a status, first as on GitHub's own board (option ids are hex, so never this). */
export const NONE = "none";
/** At most this many pages of 100 items per board. */
export const MAX_PAGES = 10;

/** A project's options are free names: their kind read from the name (English and Dutch). */
const DONE = /done|closed|complete|shipped|released|merged|klaar|afgewerkt|gedaan/i;
const DOING = /progress|doing|review|block|test|wip|bezig|wacht/i;
export const stateOf = (name: string): State => (DONE.test(name) ? "done" : DOING.test(name) ? "doing" : "todo");
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name);

/** The viewer and their organizations as projects (id = login), each one's open projects as boards. */
export function mapBoards(data: any): { login: string; projects: Opt[]; boards: BoardOpt[] } {
  const v = data?.viewer;
  const owners = [v, ...(v?.organizations?.nodes || [])].filter(o => o?.login);
  return {
    login: v?.login || "",
    projects: owners.map(o => ({ id: o.login, name: o.name || o.login })),
    boards: owners.flatMap(o => (o.projectsV2?.nodes || []).filter((p: any) => p && !p.closed)
      .map((p: any) => ({ id: p.id, name: p.title, project: o.login, group: o.name || o.login })).sort(byName)),
  };
}

/** The field that makes the columns: the one named Status (every project has it), else the first single select. */
export type Field = { id: string; name: string; options: Opt[] };
export function mapField(data: any): { field: Field | null; url: string } {
  const fields = (data?.node?.fields?.nodes || []).filter((f: any) => f?.id && Array.isArray(f.options));
  const f = fields.find((x: any) => x.name === "Status") ?? fields[0];
  return { field: f ? { id: f.id, name: f.name, options: f.options.map((o: any) => ({ id: o.id, name: o.name })) } : null, url: data?.node?.url || "" };
}

/** No status first, then the field's options in the project's order, each with the kind its name says. */
export function mapColumns(field: Field | null, none: string): Column[] {
  const opts = [{ id: NONE, name: none }, ...(field?.options || [])];
  return opts.map((o, i) => { const state = o.id === NONE ? "todo" : stateOf(o.name); return { id: o.id, name: o.name, placement: i, state, tone: toneOf(state, o.name, i === 0) }; });
}

/** One page of items as cards (archived ones left out), each issue's or pull request's url, and the next cursor. */
export function mapItems(data: any, field: Field | null, me: string): { cards: Card[]; urls: [string, string][]; next: string | null } {
  const c = data?.node?.items;
  const nodes = (c?.nodes || []).filter((i: any) => i && !i.isArchived && i.content);
  const options = new Map((field?.options || []).map(o => [o.id, o.name]));
  return {
    cards: nodes.map((i: any, n: number) => {
      const x = i.content, who = x.assignees?.nodes?.[0];
      const status = options.get(i.fieldValueByName?.optionId);
      const state = status ? stateOf(status) : undefined;
      return { id: i.id, title: x.title || "", number: x.number ? String(x.number) : "", column: status ? i.fieldValueByName.optionId : NONE,
        placement: n, due: null, who: String(who?.name || who?.login || "").split(" ")[0],
        ...(who ? { whoName: String(who.name || who.login), me: who.login === me } : {}),
        ...(status && state ? { status, state, tone: toneOf(state, status, false) } : {}),
        ...(x.labels?.nodes?.length ? { labels: x.labels.nodes.map((l: any) => l.name) } : {}), ...(i.updatedAt ? { updated: i.updatedAt } : {}) };
    }),
    urls: nodes.filter((i: any) => i.content.url).map((i: any) => [i.id, i.content.url]),
    next: c?.pageInfo?.hasNextPage && c.pageInfo.endCursor ? c.pageInfo.endCursor : null,
  };
}

/** Every page of items, `page(after)` fetching one, stopping after MAX_PAGES; placement runs on across pages. */
export async function allItems(page: (after: string | null) => Promise<any>, field: Field | null, me: string) {
  const cards: Card[] = [], urls: [string, string][] = [];
  let after: string | null = null;
  for (let n = 0; n < MAX_PAGES; n++) {
    const r = mapItems(await page(after), field, me), base = cards.length;
    cards.push(...r.cards.map(c => ({ ...c, placement: base + c.placement }))); urls.push(...r.urls);
    if (!(after = r.next)) break;
  }
  return { cards, urls };
}
