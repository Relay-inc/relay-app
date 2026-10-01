import { t, tn } from "../core/i18n";
import { changed, ls } from "../core/store";
import { ui, WAIT, REM, PRS, MAIL, boardKey } from "./ui";
import {
  chat,
  chatsOf,
  projectOf,
  terminalSessions,
  waitCount,
  isWaiting,
  runningSubs,
  displayTitle,
  type Chat,
  type TerminalSession,
} from "./chats/state";
import { vault, contexts, projectLabel } from "./vault";
import { config, ghOn, mailOn } from "./config";
import { readyBoards } from "./board";
import { mail, unread } from "./mail";
import { prs } from "./prs";
import type { Project } from "./vault";

// The sidebar's own state: the search text, folded sections and projects, and the order the user dragged.
export const sidebar = {
  find: "",
  collapsed: ls.get<Record<string, boolean>>("collapsed", {}),
  unfolded: new Set<string>(), // projects whose conversations past the first five are shown
  secOrder: ls.get<string[]>("secOrder", ["Algemeen"]), // sections,
  projOrder: ls.get<Record<string, string[]>>("projOrder", {}), // projects within a section,
  convOrder: ls.get<Record<string, string[]>>("convOrder", {}), // conversations per project (or "" for Algemeen)
};
export const setFind = (q: string) => {
  sidebar.find = q;
  changed();
};
export function toggleSection(id: string) {
  sidebar.collapsed[id] = !sidebar.collapsed[id];
  ls.set("collapsed", sidebar.collapsed);
  changed();
}
export function toggleUnfold(p: string) {
  if (sidebar.unfolded.has(p)) sidebar.unfolded.delete(p);
  else sidebar.unfolded.add(p);
  changed();
}
/** `list` with `id` moved before or after `ref` (to the end when `ref` is not in it). */
export const place = (list: string[], id: string, ref: string, after: boolean) => {
  const l = list.filter(x => x !== id),
    i = l.indexOf(ref);
  l.splice(i < 0 ? l.length : i + (after ? 1 : 0), 0, id);
  return l;
};
/** A drop after dragging: `visible` is the order as shown, the dragged `id` goes before or after `ref`. */
export function reorder(
  kind: "sec" | "proj" | "conv",
  ctx: string,
  visible: string[],
  id: string,
  ref: string,
  after: boolean,
) {
  if (kind === "sec") {
    sidebar.secOrder = place(sidebar.secOrder, id, ref, after);
    ls.set("secOrder", sidebar.secOrder);
  } else if (kind === "conv") {
    sidebar.convOrder[ctx] = place(visible, id, ref, after);
    ls.set("convOrder", sidebar.convOrder);
  } else {
    sidebar.projOrder[ctx] = place(visible, id, ref, after);
    ls.set("projOrder", sidebar.projOrder);
  }
  changed();
}
/** Rows in the user's dragged order first, the rest after them in their own order. */
export const ordered = <T>(
  rows: T[],
  key: (r: T) => string,
  order: string[] = [],
  rest: (a: T, b: T) => number = () => 0,
) =>
  rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ia = order.indexOf(key(a.r)),
        ib = order.indexOf(key(b.r));
      return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : rest(a.r, b.r) || a.i - b.i;
    })
    .map(x => x.r);

// ---------- what the sidebar shows, built from the state: the view rows on top, then the sections with their rows
export type Trail = "" | "dot" | "spin";
/** The badge or count at the end of a view row. */
export type Meta = { kind: "badge" | "count" | "late" | "soon"; n: number; title?: string };
export type ViewRow = { key: string; icon?: string; svg?: string; name: string; meta?: Meta };
export type ConvRow = {
  key: string;
  parent: string;
  term: boolean;
  title: string;
  selected: boolean;
  unseen: boolean;
  trail: Trail;
  subs: number;
  subsTitle: string;
  closable: boolean;
};
export type ProjectBlock = {
  name: string;
  context: string;
  label: string;
  img?: string | null;
  emoji?: string;
  unseen: boolean;
  trail: Trail;
  addTitle: string;
  convs: ConvRow[];
  fold: string;
};
/** `tint` is the colour of a vault context, `add` the project a new conversation from the header is about ("" for general). */
export type Section = {
  id: string;
  label: string;
  tint: "" | "ctx-a" | "ctx-m" | "ctx-p";
  count: number;
  collapsed: boolean;
  open: boolean;
  add?: string;
  convs: ConvRow[];
  projects: ProjectBlock[];
};

// contexts come from the vault index, in its order, each takes the next of three colours
const CTX = ["ctx-a", "ctx-m", "ctx-p"] as const;
export const GENERAL = "Algemeen";

// the open draft shows as "Nieuw gesprek" under its project, its title follows what is typed
const listed = (p: string | null): Chat[] => [
  ...Object.values(chat.chats).filter(
    c => c.draft && !c.closed && c.project === p && (c.key === ui.selected || chat.typed[c.key]),
  ),
  ...chatsOf(p),
];
const trailOf = (keys: string[]): Trail =>
  keys.some(isWaiting) ? "dot" : keys.some(k => chat.status[k] === "busy") ? "spin" : "";
const subsOf = (k: string) => {
  const n = runningSubs(k);
  return { subs: n, subsTitle: n ? tn("nav.agentsWorking", n) : "" };
};
const convRow = (c: Chat): ConvRow => ({
  key: c.key,
  parent: c.project ?? "",
  term: false,
  title: displayTitle(c.title),
  selected: ui.selected === c.key,
  unseen: chat.unseen.has(c.key),
  trail: trailOf([c.key]),
  ...subsOf(c.key),
  closable: !(c.draft && !chat.typed[c.key]),
});
const termRow = (tm: TerminalSession): ConvRow => ({
  key: tm.key,
  parent: tm.project ?? "",
  term: true,
  title: tm.title,
  selected: ui.selected === tm.key,
  unseen: false,
  trail: tm.status === "busy" ? "spin" : tm.state === "blocked" ? "dot" : "",
  ...subsOf(tm.key),
  closable: true,
});

function projectBlock(p: Project, T: TerminalSession[]): ProjectBlock {
  const cs = listed(p.name),
    ts = T.filter(tm => tm.project === p.name),
    keys = [...cs.map(c => c.key), ...ts.map(tm => tm.key)];
  const unfolded = sidebar.unfolded.has(p.name),
    ic = vault.icons[p.name];
  return {
    name: p.name,
    context: p.context,
    unseen: keys.some(k => chat.unseen.has(k)),
    trail: trailOf(keys),
    addTitle: t("nav.newChatAbout", { name: p.name }),
    label: projectLabel(p.name).replace(/^\S+ (?=.)/, s => (config.value.projects[p.name]?.icon ? "" : s)),
    img: ic?.img,
    emoji: ic?.icon,
    convs: ordered(
      [...ts.map(termRow), ...cs.slice(0, unfolded ? cs.length : 5).map(convRow)],
      r => r.key,
      sidebar.convOrder[p.name],
    ),
    fold: cs.length > 5 ? (unfolded ? t("nav.less") : t("nav.more", { n: cs.length - 5 })) : "",
  };
}

export function sidebarModel(): { views: ViewRow[]; sections: Section[] } {
  const q = sidebar.find.toLowerCase(),
    selP = projectOf(ui.selected),
    T = terminalSessions();
  const w = waitCount(),
    due = vault.snap.reminders.filter(r => r.days <= 0).length;
  const views: ViewRow[] = [
    { key: WAIT, icon: "bell", name: t("nav.waiting"), meta: w ? { kind: "badge", n: w } : undefined },
    {
      key: REM,
      icon: "list",
      name: t("nav.reminders"),
      meta: due ? { kind: vault.snap.reminders.some(r => r.days < 0) ? "late" : "soon", n: due } : undefined,
    },
    ...readyBoards().map(p => ({ key: boardKey(p.id), svg: p.glyph, name: p.name })),
    ...(ghOn()
      ? [
          {
            key: PRS,
            icon: "pr",
            name: t("nav.prs"),
            meta: prs.list?.review.length
              ? { kind: "count" as const, n: prs.list.review.length, title: t("nav.prsReview") }
              : undefined,
          },
        ]
      : []),
    ...(mailOn()
      ? [
          {
            key: MAIL,
            icon: "mail",
            name: t("nav.mail"),
            meta: mail.list?.some(unread) ? { kind: "count" as const, n: mail.list.filter(unread).length } : undefined,
          },
        ]
      : []),
  ];

  const gc = listed(null).filter(c => !q || c.title.toLowerCase().includes(q)),
    gt = T.filter(tm => !tm.project && (!q || tm.title.toLowerCase().includes(q)));
  const sec = (id: string, s: Omit<Section, "id" | "collapsed" | "open">): Section => ({
    id,
    collapsed: !!sidebar.collapsed[id],
    open: !sidebar.collapsed[id] || !!q,
    ...s,
  });
  const secs: Record<string, Section> = {
    [GENERAL]: sec(GENERAL, {
      label: t("general").toUpperCase(),
      tint: "",
      count: gc.length + gt.length,
      add: "",
      convs: ordered([...gc.map(convRow), ...gt.map(termRow)], r => r.key, sidebar.convOrder[""]),
      projects: [],
    }),
  };

  // an app conversation stays until the user closes it, a terminal session as long as it is open
  const open = (p: Project) => T.some(tm => tm.project === p.name) || chatsOf(p.name).length > 0;
  const lastAt = (n: string) =>
    Math.max(0, ...chatsOf(n).map(c => c.at), ...T.filter(tm => tm.project === n).map(tm => tm.mtime));
  const match = (p: Project) => p.name.toLowerCase().includes(q) || projectLabel(p.name).toLowerCase().includes(q);
  contexts().forEach((ctx, i) => {
    // manual order from dragging comes first, the rest follows by recency
    const shown = ordered(
      vault.snap.projects.filter((p: Project) => p.context === ctx && match(p) && (q || open(p) || p.name === selP)),
      (p: Project) => p.name,
      sidebar.projOrder[ctx],
      (a: Project, b: Project) => lastAt(b.name) - lastAt(a.name),
    );
    if (shown.length)
      secs[ctx] = sec(ctx, {
        label: ctx.toUpperCase(),
        tint: CTX[i % CTX.length],
        count: shown.length,
        convs: [],
        projects: shown.map(p => projectBlock(p, T)),
      });
  });
  // sections the user never dragged follow in the index order
  return {
    views,
    sections: [...sidebar.secOrder, ...Object.keys(secs).filter(k => !sidebar.secOrder.includes(k))]
      .filter(k => secs[k])
      .map(k => secs[k]),
  };
}
