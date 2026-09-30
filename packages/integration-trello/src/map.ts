import type { BoardOpt, Card, Column, Opt } from "@vault/board-core";

// Trello's answers turned into the board's shapes. No imports with side effects, so the tests
// (tests/map.test.ts) run it in plain Node on fixture JSON.

/** Boards the user has not got through a workspace they are a member of (personal, guest) sit under this project. */
export const PERSONAL = "personal";

/** /members/me/boards and /members/me/organizations as workspaces (with a personal one when needed) and their boards. */
export function mapBoards(boards: any[], orgs: any[], personal: string): { projects: Opt[]; boards: BoardOpt[] } {
  const names = new Map<string, string>(orgs.map((o: any) => [o.id, o.displayName || o.name || o.id]));
  const bs: BoardOpt[] = boards.filter((b: any) => !b.closed).map((b: any) => {
    const project = b.idOrganization && names.has(b.idOrganization) ? b.idOrganization : PERSONAL;
    return { id: b.id, name: b.name, project, group: project === PERSONAL ? personal : names.get(project)! };
  });
  const used = new Set(bs.map(b => b.project));
  const projects = [...names].filter(([id]) => used.has(id)).map(([id, name]) => ({ id, name }));
  if (used.has(PERSONAL)) projects.push({ id: PERSONAL, name: personal });
  return { projects, boards: bs };
}

/** /boards/{id}/lists?filter=open: the open lists, in board order. */
export const mapColumns = (lists: any[]): Column[] => lists.filter((l: any) => !l.closed)
  .map((l: any) => ({ id: l.id, name: l.name, placement: Number(l.pos) || 0 })).sort((a, b) => a.placement - b.placement);

/** /boards/{id}/cards/open with members: the open cards, only those with `me` as a member when given. */
export const mapCards = (cards: any[], me?: string): Card[] => cards
  .filter((c: any) => !c.closed && (!me || (c.idMembers || []).includes(me)))
  .map((c: any) => ({ id: c.id, title: c.name, number: c.idShort != null ? String(c.idShort) : "", column: c.idList, placement: Number(c.pos) || 0,
    due: typeof c.due === "string" ? c.due.slice(0, 10) : null, who: String((c.members || [])[0]?.fullName || "").split(" ")[0] }));
