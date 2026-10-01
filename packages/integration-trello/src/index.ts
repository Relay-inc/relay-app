import { currentLocale, translator, type BoardOpt, type BoardProvider, type Ctx, type Opt } from "@relay/board-core";
import { mapBoards, mapCards, mapColumns } from "./map";
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

  projects: async c => (await all(c)).projects,
  boards: async (c, p) => (await all(c)).boards.filter(b => b.project === p),
  columns: async (c, ref) => mapColumns(await c.call("GET", `/boards/${ref.board}/lists?filter=open&fields=name,pos,closed`)),
  cards: async (c, ref) => {
    const [raw, m] = await Promise.all([c.call("GET", `/boards/${ref.board}/cards/open?fields=name,idShort,idList,pos,due,idMembers,shortUrl,closed&members=true&member_fields=fullName`),
      c.config.mine ? who(c) : null]);
    for (const x of raw || []) links.set(x.id, x.shortUrl);
    return mapCards(raw || [], m?.id);
  },
  // at the bottom of the new list, where the board already shows it (like Productive)
  move: async (c, _ref, card, to) => {
    const r = await c.call("PUT", `/cards/${card.id}`, { idList: to, pos: "bottom" });
    return typeof r?.pos === "number" ? r.pos : undefined;
  },
  url: async (_c, _ref, id) => links.get(id) || `https://trello.com/c/${id}`,
  reset: () => { me = null; mine = null; links.clear(); },

  settings: {
    tokenLabel: "token",
    help: "help",
    // read and write: moving a card writes. Without a return_url Trello shows the token on the page, to copy
    tokenUrl: s =>
      s.key ? `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=Relay&key=${encodeURIComponent(s.key)}` : undefined,
    check: s => {
      // a key is 32 hex digits; the Secret (and an older token) 64; a token today starts with ATTA
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
