import type { CardView, Ctx, Opt } from "@relay/board-core";
import { markdown, safeUrl, ticketDetail } from "@relay/board-core/detail";

const person = (m: any): Opt => ({ id: m.id, name: m.fullName || m.username || m.id });
const file = (a: any) => ({ id: a.id, name: a.name || a.fileName || "", size: Number(a.bytes) || 0, url: safeUrl(a.url) });

/** Actions are newest first; page by the last action id so older comments are not silently dropped. */
export async function actions(c: Ctx, id: string) {
  const result: any[] = [];
  let before = "";
  for (;;) {
    const page = await c.call("GET", `/cards/${id}/actions?filter=all&limit=1000${before ? `&before=${before}` : ""}`);
    result.push(...page);
    if (page.length < 1000) return result;
    const next = page[page.length - 1].id;
    if (!next || next === before) throw new Error("Trello: activity pagination did not advance");
    before = next;
  }
}

export function mapDetail(card: any, lists: any[], people: any[], feed: any[], project: string): CardView {
  const created = feed.find(a => a.type === "createCard" || a.type === "copyCard");
  return {
    title: card.name, number: String(card.idShort), closed: !!card.closed, url: safeUrl(card.shortUrl || card.url),
    board: card.board?.name || "", list: card.list?.name || "", project,
    created: created?.date || "", creator: created?.memberCreator?.fullName || "",
    description: markdown(card.desc || ""), due: card.due?.slice(0, 10) || "",
    labels: (card.labels || []).map((l: any) => l.name || l.color).filter(Boolean),
    status: { id: card.idList, name: card.list?.name || lists.find(l => l.id === card.idList)?.name || "" },
    statuses: lists.filter(l => !l.closed || l.id === card.idList).map(l => ({ id: l.id, name: l.name })),
    assignees: (card.members || []).map(person), people: people.map(person),
    files: (card.attachments || []).map(file),
    feed: feed.map(a => {
      const d = a.data || {};
      // Trello's display entities include a readable value for the changed field, without translating API keys.
      const changes = d.listBefore && d.listAfter ? `${d.listBefore.name} → ${d.listAfter.name}`
        : Object.entries(d.old || {}).map(([k, old]) => `${k}: ${String(old ?? "–")} → ${String(d.card?.[k] ?? "–")}`).join(", ");
      return { at: a.date, who: a.memberCreator?.fullName || a.memberCreator?.username || "",
        html: a.type === "commentCard" ? markdown(d.text || "") : "",
        change: a.type === "commentCard" ? "" : changes || a.type.replace(/([a-z])([A-Z])/g, "$1 $2"),
        files: d.attachment ? [file(d.attachment)] : [] };
    }).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

export const trelloTicket = ticketDetail(async (c, ref, id) => {
  const card = await c.call("GET", `/cards/${id}?fields=name,desc,idShort,idList,idBoard,closed,due,labels,shortUrl&members=true&member_fields=fullName,username&board=true&board_fields=name&list=true&list_fields=name&attachments=true`);
  const [lists, people, feed] = await Promise.all([
    c.call("GET", `/boards/${card.idBoard}/lists?filter=all&fields=name,closed,pos`),
    c.call("GET", `/boards/${card.idBoard}/members?fields=fullName,username`), actions(c, id),
  ]);
  return mapDetail(card, lists, people, feed, ref.project);
}, async (c, ref, id, action, { value, files }) => {
  if (action === "status" && value) await c.call("PUT", `/cards/${id}`, { idList: value, pos: "bottom" });
  else if (action === "member-add" && value) await c.call("POST", `/cards/${id}/idMembers`, { value });
  else if (action === "member-remove" && value) await c.call("DELETE", `/cards/${id}/idMembers/${value}`);
  else if (action === "comment" && value.trim()) await c.call("POST", `/cards/${id}/actions/comments`, { text: value });
  else if (action === "attach") for (const f of files) await c.upload(`https://api.trello.com/1/cards/${id}/attachments`, {}, f);
  else throw new Error("Trello: unsupported ticket action");
  return trelloTicket.detail.fetch(c, ref, id);
});
