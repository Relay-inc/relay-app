import { translator, type BoardOpt, type BoardProvider, type Ctx, type Opt } from "@relay/board-core";
import { CREATE, ISSUES, ISSUE_URL, MOVE, STATES, TEAMS, VIEWER, allIssues, issueFilter, mapIssues, mapStates, mapTeams } from "./map";
import { linearTicket } from "./detail";
import strings, { type Key } from "./locales";

const t = translator<Key>("linear");

// Linear: a project is a team, a board the whole team or one of its Linear projects, its columns the team's
// workflow states, its cards the issues. The personal API key is in the keychain (vault-app.linear), the backend
// sends it and turns GraphQL errors (also those answered with 200) and the rate limit into a message.
// Config: integrations.linear.done, also show the completed and canceled states.

let teams: { projects: Opt[]; boards: BoardOpt[] } | null = null;
const links = new Map<string, string>();
const gql = (c: Ctx, query: string, variables?: Record<string, unknown>) =>
  c.call("POST", "/graphql", variables ? { query, variables } : { query }).then((r: any) => r?.data);
const all = async (c: Ctx) => teams ??= mapTeams(await gql(c, TEAMS), t("allIssues"));

const linear: BoardProvider<Key> = {
  id: "linear",
  name: "Linear",
  strings,
  // Linear's mark: a disc with diagonal cuts, in white on its indigo tile
  glyph: '<rect width="16" height="16" rx="3" fill="#5E6AD2" stroke="none"/><path d="M3.3 9.4l3.3 3.3a5 5 0 0 1-3.3-3.3zm-.2-1.7l5.2 5.2a5 5 0 0 0 1.4-.3L3.4 6.3a5 5 0 0 0-.3 1.4zm.8-2.4l6.8 6.8c.3-.2.6-.4.9-.7L4.6 4.4c-.3.3-.5.6-.7.9zm1.6-1.6l6.8 6.8A5 5 0 0 0 5.5 3.7z" fill="#fff" stroke="none"/>',
  // the sidebar's mark: the same disc and cuts as an outline
  mark: '<path d="M4.97 6.38A9 9 0 1 1 17.62 19.03Z"/><path d="M3.62 8.71L15.29 20.38"/><path d="M3.01 11.63L12.37 20.99"/><path d="M3.67 15.41L8.59 20.33"/>',

  projects: async c => (await all(c)).projects,
  boards: async (c, p) => (await all(c)).boards.filter(b => b.project === p),
  columns: async (c, ref) => mapStates(await gql(c, STATES, { id: ref.project }), !!c.config.done),
  cards: async (c, ref) => {
    const filter = issueFilter(ref, !!c.config.done);
    const r = await allIssues(after => gql(c, ISSUES, { filter, after }));
    for (const [id, url] of r.urls) links.set(id, url);
    return r.cards;
  },
  move: async (c, _ref, card, to) => {
    const r = (await gql(c, MOVE, { id: card.id, stateId: to }))?.issueUpdate;
    if (!r?.success) throw new Error(t("moveRefused"));
    return typeof r.issue?.sortOrder === "number" ? r.issue.sortOrder : undefined;
  },
  // in the lane's workflow state, in the board's Linear project when it is one
  create: async (c, ref, { title, description, column }) => {
    const r = (await gql(c, CREATE, { teamId: ref.project, stateId: column, title, description, projectId: ref.board && ref.board !== ref.project ? ref.board : null }))?.issueCreate;
    if (!r?.success || !r.issue) throw new Error(t("createRefused"));
    const made = mapIssues({ issues: { nodes: [r.issue] } });
    for (const [id, url] of made.urls) links.set(id, url);
    return made.cards[0];
  },
  url: async (c, _ref, id) => links.get(id) || (await gql(c, ISSUE_URL, { id }))?.issue?.url || "https://linear.app",
  detail: linearTicket.detail,
  reset: () => { teams = null; links.clear(); linearTicket.reset(); },

  settings: {
    tokenLabel: "token",
    help: "help",
    // Linear's own page for personal API keys, shown as a button next to the field
    tokenUrl: () => "https://linear.app/settings/account/security",
    check: s => (s.token && !/^lin_api_\S+$/.test(s.token) ? "badToken" : undefined),
    fields: [{ key: "done", label: "states", placeholder: "showDone", check: true, optional: true }],
    async test(c) { teams = null; const v = (await gql(c, VIEWER))?.viewer; return t("connectedAs", { name: v?.displayName || v?.name || v?.id || "?" }); },
    allBoards: async c => (await all(c)).boards,
  },
};
export default linear;
