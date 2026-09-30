import { t } from "../i18n";
import type { BoardOpt, BoardProvider, Ctx, Opt } from "./types";
import { ISSUES, ISSUE_URL, MOVE, STATES, TEAMS, VIEWER, allIssues, issueFilter, mapStates, mapTeams } from "./linear-map";

// Linear: a project is a team, a board the whole team or one of its Linear projects, its columns the team's
// workflow states, its cards the issues. The personal API key is in the keychain (vault-app.linear), the backend
// sends it and turns GraphQL errors (also those answered with 200) and the rate limit into a message.
// Config: integrations.linear.done, also show the completed and canceled states.

let teams: { projects: Opt[]; boards: BoardOpt[] } | null = null;
const links = new Map<string, string>();
const gql = (c: Ctx, query: string, variables?: Record<string, unknown>) =>
  c.call("POST", "/graphql", variables ? { query, variables } : { query }).then((r: any) => r?.data);
const all = async (c: Ctx) => teams ??= mapTeams(await gql(c, TEAMS), t("li.allIssues"));

const linear: BoardProvider = {
  id: "linear",
  name: "Linear",
  // Linear's mark: a disc with diagonal cuts, in white on its indigo tile
  glyph: '<rect width="16" height="16" rx="3" fill="#5E6AD2" stroke="none"/><path d="M3.3 9.4l3.3 3.3a5 5 0 0 1-3.3-3.3zm-.2-1.7l5.2 5.2a5 5 0 0 0 1.4-.3L3.4 6.3a5 5 0 0 0-.3 1.4zm.8-2.4l6.8 6.8c.3-.2.6-.4.9-.7L4.6 4.4c-.3.3-.5.6-.7.9zm1.6-1.6l6.8 6.8A5 5 0 0 0 5.5 3.7z" fill="#fff" stroke="none"/>',

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
    if (!r?.success) throw new Error(t("li.moveRefused"));
    return typeof r.issue?.sortOrder === "number" ? r.issue.sortOrder : undefined;
  },
  url: async (c, _ref, id) => links.get(id) || (await gql(c, ISSUE_URL, { id }))?.issue?.url || "https://linear.app",
  reset: () => { teams = null; links.clear(); },

  settings: {
    tokenLabel: "li.token",
    help: "li.help",
    fields: [{ key: "done", label: "li.states", placeholder: "li.showDone", check: true, optional: true }],
    async test(c) { teams = null; const v = (await gql(c, VIEWER))?.viewer; return t("pv.connectedAs", { name: v?.displayName || v?.name || v?.id || "?" }); },
    allBoards: async c => (await all(c)).boards,
  },
};
export default linear;
