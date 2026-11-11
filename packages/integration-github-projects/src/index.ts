import { translator, type BoardProvider, type BoardRef, type Ctx } from "@relay/board-core";
import { BOARDS, CLEAR, CREATE, FIELDS, ITEMS, MOVE, NONE, allItems, mapBoards, mapColumns, mapField, stateOf, type Field } from "./map";
import strings, { type Key } from "./locales";

const t = translator<Key>("github-projects");

// GitHub Projects (v2): a project is the user or one of their organizations (id = login), a board one of its projects,
// its columns the options of the project's Status field (No status first), its cards the items: issues, pull requests
// and drafts. The token is in the keychain (vault-app.github-projects), the backend sends it and turns GraphQL errors
// (also those answered with 200) and the rate limit into a message. No ticket window: a card opens on GitHub.

let owners: ReturnType<typeof mapBoards> | null = null;
const fields = new Map<string, Promise<{ field: Field | null; url: string }>>();
const links = new Map<string, string>();
const gql = (c: Ctx, query: string, variables?: Record<string, unknown>) =>
  c.call("POST", "/graphql", variables ? { query, variables } : { query }).then((r: any) => r?.data);
const all = async (c: Ctx) => owners ??= mapBoards(await gql(c, BOARDS));
/** The board's Status field, asked once per board (a failed ask is asked again). */
const fieldOf = (c: Ctx, ref: BoardRef) => {
  let got = fields.get(ref.board);
  if (!got) {
    got = gql(c, FIELDS, { id: ref.board }).then(mapField);
    got.catch(() => fields.delete(ref.board));
    fields.set(ref.board, got);
  }
  return got;
};
const statusField = async (c: Ctx, ref: BoardRef) => {
  const { field } = await fieldOf(c, ref);
  if (!field) throw new Error(t("noStatus"));
  return field;
};

const github: BoardProvider<Key> = {
  id: "github-projects",
  name: "GitHub Projects",
  strings,
  // GitHub's mark in white on a dark tile
  glyph: '<rect width="16" height="16" rx="3" fill="#24292f" stroke="none"/><path fill="#fff" stroke="none" d="M8 2.5a5.5 5.5 0 0 0-1.74 10.72c.28.05.38-.12.38-.27v-.94c-1.53.33-1.85-.74-1.85-.74-.25-.64-.61-.81-.61-.81-.5-.34.04-.33.04-.33.55.04.84.57.84.57.49.84 1.29.6 1.6.46.05-.36.19-.6.35-.74-1.22-.14-2.5-.61-2.5-2.72 0-.6.21-1.09.57-1.47-.06-.14-.25-.7.05-1.46 0 0 .46-.15 1.51.56a5.2 5.2 0 0 1 2.75 0c1.05-.71 1.51-.56 1.51-.56.3.76.11 1.32.05 1.46.35.38.57.87.57 1.47 0 2.11-1.29 2.58-2.51 2.71.2.17.37.5.37 1.01v1.5c0 .15.1.32.38.27A5.5 5.5 0 0 0 8 2.5z"/>',
  // the sidebar's mark: a project board, three columns of cards
  mark: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/><path d="M5.5 8h1.5M11.5 8h1.5M11.5 11h1.5M17.5 8h1.5"/>',

  projects: async c => (await all(c)).projects,
  boards: async (c, p) => (await all(c)).boards.filter(b => b.project === p),
  columns: async (c, ref) => mapColumns((await fieldOf(c, ref)).field, t("noStatusColumn")),
  cards: async (c, ref) => {
    const [field, { login }] = await Promise.all([statusField(c, ref), all(c)]);
    const r = await allItems(after => gql(c, ITEMS, { id: ref.board, after, field: field.name }), field, login);
    for (const [id, url] of r.urls) links.set(id, url);
    return r.cards;
  },
  move: async (c, ref, card, to) => {
    const field = await statusField(c, ref);
    const ids = { project: ref.board, item: card.id, field: field.id };
    const r = to === NONE ? (await gql(c, CLEAR, ids))?.clearProjectV2ItemFieldValue : (await gql(c, MOVE, { ...ids, option: to }))?.updateProjectV2ItemFieldValue;
    if (!r?.projectV2Item) throw new Error(t("moveRefused"));
  },
  // a draft item, then into the lane's option unless that is No status
  create: async (c, ref, { title, description, column }) => {
    const item = (await gql(c, CREATE, { project: ref.board, title, body: description }))?.addProjectV2DraftIssue?.projectItem;
    if (!item?.id) throw new Error(t("createRefused"));
    const card = { id: item.id, title, number: "", column: NONE, placement: Number.MAX_SAFE_INTEGER, due: null, who: "" };
    if (column === NONE) return card;
    await github.move(c, ref, card, column);
    const status = (await statusField(c, ref)).options.find(o => o.id === column)?.name;
    return { ...card, column, ...(status ? { status, state: stateOf(status) } : {}) };
  },
  // an issue or pull request on its own page; a draft only lives on the project's
  url: async (c, ref, id) => links.get(id) || (await fieldOf(c, ref)).url || "https://github.com",
  reset: () => { owners = null; fields.clear(); links.clear(); },

  settings: {
    tokenLabel: "token",
    help: "help",
    // a classic token with the scopes already ticked
    tokenUrl: () => "https://github.com/settings/tokens/new?scopes=project,repo,read:org&description=Relay",
    check: s => (s.token && !/^(ghp|gho|github_pat)_\w+$/.test(s.token) ? "badToken" : undefined),
    fields: [],
    async test(c) { owners = null; const v = (await all(c)); return t("connectedAs", { name: v.login || "?", boards: v.boards.length }); },
    allBoards: async c => (await all(c)).boards,
  },
};
export default github;
