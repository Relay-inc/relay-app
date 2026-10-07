import { currentLocale, queryText, translator, type BoardOpt, type BoardProvider, type Ctx, type Opt } from "@relay/board-core";
import { PERSONAL, mapBoards, mapCards, mapColumns } from "./map";
import { trelloTicket } from "./detail";
import strings, { type Key } from "./locales";

const t = translator<Key>("trello");

// Trello: a project is a workspace, a board a board, its columns the open lists, its cards the open cards.
// Key and token are both in the keychain (vault-app.trello), the backend sends them in the OAuth header. The key comes
// from a Power-Up of the user's own, the token from Trello's authorize page for that key (no OAuth, no Secret).
// Config: integrations.trello.mine, only the cards the user is a member of.

let me: { id: string; fullName: string } | null = null, mine: { projects: Opt[]; boards: BoardOpt[] } | null = null;
const links = new Map<string, string>();
const who = async (c: Ctx) => me ??= await c.call("GET", "/members/me?fields=id,fullName");
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name, currentLocale());
async function all(c: Ctx) {
  if (mine) return mine;
  const [bs, os] = await Promise.all([c.call("GET", "/members/me/boards?filter=open&fields=name,idOrganization,closed"),
    c.call("GET", "/members/me/organizations?fields=displayName,name")]);
  const r = mapBoards(bs || [], os || [], t("personal"));
  return mine = { projects: r.projects.sort(byName), boards: r.boards.sort(byName) };
}

const trello: BoardProvider<Key> = {
  id: "trello",
  name: "Trello",
  strings,
  // Trello's mark: two bars in a blue tile
  glyph: '<rect width="16" height="16" rx="3" fill="#0C66E4" stroke="none"/><rect x="3.2" y="3.2" width="4" height="9.2" rx="1" fill="#fff" stroke="none"/><rect x="8.8" y="3.2" width="4" height="5.6" rx="1" fill="#fff" stroke="none"/>',
  // the sidebar's mark: Hugeicons' Trello, the set the app draws in
  mark: '<path d="M2.5 12C2.5 7.52166 2.5 5.28249 3.89124 3.89124C5.28249 2.5 7.52166 2.5 12 2.5C16.4783 2.5 18.7175 2.5 20.1088 3.89124C21.5 5.28249 21.5 7.52166 21.5 12C21.5 16.4783 21.5 18.7175 20.1088 20.1088C18.7175 21.5 16.4783 21.5 12 21.5C7.52166 21.5 5.28249 21.5 3.89124 20.1088C2.5 18.7175 2.5 16.4783 2.5 12Z"/><path d="M6 8C6 7.05719 6 6.58579 6.29289 6.29289C6.58579 6 7.05719 6 8 6H8.5C9.44281 6 9.91421 6 10.2071 6.29289C10.5 6.58579 10.5 7.05719 10.5 8V15C10.5 15.9428 10.5 16.4142 10.2071 16.7071C9.91421 17 9.44281 17 8.5 17H8C7.05719 17 6.58579 17 6.29289 16.7071C6 16.4142 6 15.9428 6 15V8Z"/><path d="M13.5 8C13.5 7.05719 13.5 6.58579 13.7929 6.29289C14.0858 6 14.5572 6 15.5 6H16C16.9428 6 17.4142 6 17.7071 6.29289C18 6.58579 18 7.05719 18 8V10C18 10.9428 18 11.4142 17.7071 11.7071C17.4142 12 16.9428 12 16 12H15.5C14.5572 12 14.0858 12 13.7929 11.7071C13.5 11.4142 13.5 10.9428 13.5 10V8Z"/>',

  projects: async c => (await all(c)).projects,
  boards: async (c, p) => (await all(c)).boards.filter(b => b.project === p),
  columns: async (c, ref) => mapColumns(await c.call("GET", `/boards/${ref.board}/lists?filter=open&fields=name,pos,closed`)),
  cards: async (c, ref) => {
    const [raw, m] = await Promise.all([c.call("GET", `/boards/${ref.board}/cards/open?fields=name,idShort,idList,pos,due,idMembers,shortUrl,closed,labels,dateLastActivity&members=true&member_fields=fullName`),
      c.config.mine ? who(c) : null]);
    for (const x of raw || []) links.set(x.id, x.shortUrl);
    return mapCards(raw || [], m?.id);
  },
  // at the bottom of the new list, where the board already shows it (like Productive)
  move: async (c, _ref, card, to) => {
    const r = await c.call("PUT", `/cards/${card.id}`, { idList: to, pos: "bottom" });
    return typeof r?.pos === "number" ? r.pos : undefined;
  },
  // at the bottom of the lane's list
  create: async (c, _ref, { title, description, column }) => {
    const r = await c.call("POST", "/cards", { idList: column, name: title, desc: description, pos: "bottom" });
    if (r?.shortUrl) links.set(r.id, r.shortUrl);
    return mapCards([r])[0];
  },
  // Trello's search over the open boards, open cards only (`is:open`), `partial` so a word being typed matches too
  search: async (c, q) => {
    const r = await c.call("GET", `/search?query=${queryText(`is:open ${q}`)}&modelTypes=cards&partial=true&cards_limit=5&card_fields=name,idShort,idBoard,shortUrl&card_board=true&board_fields=name,idOrganization`);
    return (r?.cards || []).map((x: any) => {
      links.set(x.id, x.shortUrl);
      return { id: x.id, title: x.name, number: String(x.idShort), where: x.board?.name || "",
        ref: { provider: "trello", project: x.board?.idOrganization || PERSONAL, board: x.idBoard } };
    });
  },
  url: async (_c, _ref, id) => links.get(id) || `https://trello.com/c/${id}`,
  detail: trelloTicket.detail,
  reset: () => { me = null; mine = null; links.clear(); trelloTicket.reset(); },

  settings: {
    tokenLabel: "token",
    help: "help",
    // read and write: moving a card writes. Without a return_url Trello shows the token on the page, to copy
    tokenUrl: s =>
      s.key ? `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=Relay&key=${encodeURIComponent(s.key)}` : undefined,
    check: s => {
      // a key is 32 hex digits; the Secret (and an older token) 64; a token today starts with ATTA
      if (s.key?.startsWith("ATTA")) return "keyIsToken";
      if (s.key && /^[0-9a-f]{64}$/i.test(s.key)) return "keyIsSecret";
      if (s.key && !/^[0-9a-f]{32}$/i.test(s.key)) return "badKey";
      if (s.token && !/^(ATTA[0-9A-Za-z]{20,}|[0-9a-f]{64})$/.test(s.token)) return "badToken";
      return undefined;
    },
    fields: [{ key: "key", label: "key", secret: true }, { key: "mine", label: "cards", placeholder: "mine", check: true, optional: true }],
    async test(c) { me = null; mine = null; const m = await who(c); return t("connectedAs", { name: m.fullName || m.id }); },
    allBoards: async c => (await all(c)).boards,
  },
};
export default trello;
