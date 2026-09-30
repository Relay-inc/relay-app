import { invoke } from "@tauri-apps/api/core";
import { t, currentLocale } from "../i18n";
import type { Key } from "../locales/en";
import type { BoardProvider, BoardRef, Ctx, Opt } from "./types";

// Productive: a board is a `folder` in the API, its columns the task lists, its cards the open tasks.
// Config: integrations.productive.{org, user}. With a user id only the user's projects are listed.

// every page of a list endpoint, 200 per page. /activities has no total_pages, only a next link
// ponytail: stops at 10 pages (2000 records), a board that big is not a board anymore
async function all(c: Ctx, path: string) {
  const data: any[] = [], included: any[] = [];
  for (let p = 1, n = 1; p <= Math.min(n, 10); p++) {
    const r = await c.call("GET", `${path}&page[size]=200&page[number]=${p}`);
    data.push(...r.data); included.push(...(r.included || [])); n = r.meta?.total_pages || (r.links?.next ? p + 1 : p);
  }
  return { data, included };
}
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name, currentLocale());
const boardNames = new Map<string, string>();

// ---------- one task in the right panel, like Productive's own task view: fields, description, feed

// Productive sends HTML (description, comments), written by clients too. Only plain markup survives,
// every attribute goes except a web or mail link. The CSP already blocks inline script, this is the second wall.
const TAGS = new Set("P BR B STRONG I EM U S STRIKE UL OL LI A CODE PRE BLOCKQUOTE H1 H2 H3 H4 DIV SPAN HR TABLE THEAD TBODY TR TD TH".split(" "));
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  doc.body.querySelectorAll("script,style,iframe,object,embed,svg,math,template").forEach(n => n.remove());
  for (const n of [...doc.body.querySelectorAll("*")]) {
    if (!TAGS.has(n.tagName)) { n.replaceWith(...n.childNodes); continue; }
    const href = n.tagName === "A" ? n.getAttribute("href") : null;
    for (const a of [...n.attributes]) n.removeAttribute(a.name);
    if (href && /^(https?|mailto):/i.test(href)) n.setAttribute("href", href);
  }
  return doc.body.innerHTML;
}
const person = (p: any) => p ? [p.attributes.first_name, p.attributes.last_name].filter(Boolean).join(" ") : "";
const hours = (min: number | null) => min == null ? "" : `${t("kb.hours", { h: Math.floor(min / 60) })}${min % 60 ? ` ${min % 60}` : ""}`;
const LABEL: Record<string, Key> = { title: "f.title", task_list: "f.taskList", assignee: "f.assignee", workflow_status: "f.status", due_date: "f.due",
  start_date: "f.start", description: "pr.desc", initial_estimate: "f.estimate", tag_list: "f.tags", closed: "kb.closed", private: "f.private" };

let orgSlug = "", fields: Map<string, { name: string; opts: Map<string, string> }> | null = null;
// custom field names and select options (the task only carries ids) and the org part of the web URL, once
async function ready(c: Ctx) {
  const org = c.config.org;
  await Promise.all([fields ?? all(c, "/custom_fields?filter[customizable_type]=tasks&include=options").then(r => {
    const opts = new Map<string, string>(r.included.filter((i: any) => i.type === "custom_field_options").map((i: any) => [i.id, i.attributes.name]));
    fields = new Map(r.data.map((f: any) => [f.id, { name: f.attributes.name, opts: new Map<string, string>(
      (f.relationships.options?.data || []).map((o: any) => [o.id, opts.get(o.id) ?? ""])) }]));
  }), orgSlug || c.call("GET", `/organizations/${org}`).then(r => {
    orgSlug = `${org}-${String(r.data.attributes.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  })]);
}
const pick = (included: any[], type: string, rel: any) => included.find((i: any) => i.type === type && i.id === rel?.data?.id);
const taskUrl = (ref: BoardRef, id: string) => `https://app.productive.io/${orgSlug}/projects/${ref.project}/tasks/task/${id}`;

// one task from its API record, its comments and its activities
function build(ref: BoardRef, task: any, inc: any[], cs: any[], csInc: any[], acts: any[], actsInc: any[]) {
  const a = task.attributes, rel = task.relationships, id = task.id;
  const custom = Object.entries(a.custom_fields || {}).map(([fid, v]) => {
    const f = fields?.get(fid), vals = (Array.isArray(v) ? v : [v]).map(x => f?.opts.get(String(x)) || String(x));
    return [f?.name || fid, vals.join(", ")] as [string, string];
  }).filter(([, v]) => v);
  // the feed, newest first like Productive: comments, and what changed on the task itself
  const feed = [...cs.map((c: any) => ({ at: c.attributes.created_at, who: person(pick(csInc, "people", c.relationships.creator)), html: clean(c.attributes.body), change: "" })),
    ...acts.filter((x: any) => x.attributes.item_type === "task").map((x: any) => ({ at: x.attributes.created_at, who: person(pick(actsInc, "people", x.relationships.creator)), html: "",
      change: x.attributes.event === "create" ? t("kb.created") : (x.attributes.changeset || []).map((c: any) => Object.entries(c).map(([k, [from, to]]: [string, any]) =>
        k === "description" ? t("kb.descChanged") : `${LABEL[k] ? t(LABEL[k]) : k}: ${from?.value ?? t("kb.empty")} → ${to?.value ?? t("kb.empty")}`).join(", ")).join(", ") }))]
    .filter(f => f.html || f.change).sort((x, y) => y.at.localeCompare(x.at));
  const list = pick(inc, "task_lists", rel.task_list)?.attributes.name || "";
  return { title: a.title, number: a.number, closed: a.closed, description: clean(a.description), created: a.created_at, creator: person(pick(inc, "people", rel.creator)),
    board: boardNames.get(ref.board) || "", list, url: taskUrl(ref, id),
    fields: ([[t("f.status"), pick(inc, "workflow_statuses", rel.workflow_status)?.attributes.name || ""], [t("f.taskList"), list],
      [t("f.assignee"), person(pick(inc, "people", rel.assignee))], [t("f.start"), a.start_date || ""], [t("f.due"), [a.due_date, a.due_time].filter(Boolean).join(" ")],
      [t("f.estimate"), hours(a.initial_estimate)], [t("f.worked"), hours(a.worked_time)], [t("f.remaining"), hours(a.remaining_time)],
      [t("f.tags"), (a.tag_list || []).join(", ")], ...custom] as [string, string][]).filter(([, v]) => v),
    feed };
}
type Task = ReturnType<typeof build>;
const details = new Map<string, Task>();
let warming = 0;

// after a board loads: comments and activities of all its cards, 40 tasks per call, so opening a card
// needs no wait. Background only: when it fails, a click still loads the task itself.
async function prefetch(c: Ctx, ref: BoardRef, tk: { data: any[]; included: any[] }) {
  const g = ++warming;
  try {
    await ready(c);
    for (let i = 0; i < tk.data.length; i += 40) {
      const part = tk.data.slice(i, i + 40), ids = part.map((x: any) => x.id).join(",");
      const [cs, acts] = await Promise.all([all(c, `/comments?filter[task_id]=${ids}&include=creator,task`), all(c, `/activities?filter[task_id]=${ids}&include=creator`)]);
      if (g !== warming) return;
      for (const x of part) details.set(x.id, build(ref, x, tk.included, cs.data.filter((y: any) => y.relationships.task?.data?.id === x.id), cs.included,
        acts.data.filter((y: any) => String(y.attributes.task_id) === x.id), acts.included));
    }
  } catch { /* see above */ }
}

const when = (iso: string) => new Date(iso).toLocaleString(currentLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const productive: BoardProvider = {
  id: "productive",
  name: "Productive",
  // Productive's favicon (productive.io), as vector: its own colours, not the glyph stroke
  glyph: '<defs><linearGradient id="pvg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#AB40FF"/><stop offset="1" stop-color="#5D2BFF"/></linearGradient></defs><rect width="16" height="16" rx="3.6" fill="url(#pvg)" stroke="none"/><g transform="translate(2.5 1.6) scale(.357)" fill="#fff" stroke="none"><path d="M6.036 28.89L.17 18.977a1.217 1.217 0 01.426-1.667l4.633-2.74a1.217 1.217 0 011.666.426l3.3 5.579 3.424-5.89c4.28-7.018 8.712.738 6.693 4.034l-5.89 10.139a2.836 2.836 0 01-2.443 1.412l-3.492.015a2.838 2.838 0 01-2.451-1.393z"/><path d="M30.847 21.445a4.4 4.4 0 11-8.802.001 4.4 4.4 0 018.802 0zm-18.259 3.176c.966 1.64 3.34 1.632 4.297-.014l3.429-5.9c1.787-2.917 3.807-4.476 6.333-4.82.612-.083 1.211-.224 1.374-1.145l.938-5.259a1.234 1.234 0 00-1.207-1.485c-4.603 0-9.956 1.825-14.131 8.672l-3.426 5.892 2.393 4.059z"/></g>',

  projects: async c => (await all(c, `/projects?filter[status]=1${c.config.user ? `&filter[person_id]=${c.config.user}` : ""}`)).data
    .map((p: any) => ({ id: p.id, name: p.attributes.name })).sort(byName),
  boards: async (c, p) => {
    const bs = (await all(c, `/folders?filter[project_id]=${p}&filter[status]=1`)).data
      .sort((a: any, b: any) => (a.attributes.placement ?? 0) - (b.attributes.placement ?? 0)).map((f: any) => ({ id: f.id, name: f.attributes.name }));
    for (const b of bs) boardNames.set(b.id, b.name);
    return bs;
  },
  columns: async (c, ref) => (await all(c, `/task_lists?filter[folder_id]=${ref.board}&filter[status]=1`)).data
    .map((x: any) => ({ id: x.id, name: x.attributes.name, placement: x.attributes.placement ?? 0 })).sort((a, b) => a.placement - b.placement),
  cards: async (c, ref) => {
    // include=task_list is required: without it the relationship comes back without an id
    const tk = await all(c, `/tasks?filter[folder_id]=${ref.board}&filter[status]=1&include=task_list,assignee,workflow_status,creator`);
    const people = new Map<string, string>(tk.included.filter((i: any) => i.type === "people").map((i: any) => [i.id, i.attributes.first_name || ""]));
    prefetch(c, ref, tk);
    return tk.data.map((x: any) => ({ id: x.id, title: x.attributes.title, number: x.attributes.number, placement: x.attributes.placement ?? 0, due: x.attributes.due_date,
      column: x.relationships.task_list?.data?.id ?? "", who: people.get(x.relationships.assignee?.data?.id) || "" }));
  },
  move: async (c, _ref, card, to) => {
    const r = await c.call("PATCH", `/tasks/${card.id}`, { data: { type: "tasks", id: card.id, relationships: { task_list: { data: { type: "task_lists", id: to } } } } });
    return r?.data?.attributes?.placement ?? undefined;
  },
  url: async (c, ref, id) => { await ready(c); return taskUrl(ref, id); },
  reset: () => { orgSlug = ""; fields = null; details.clear(); },

  detail: {
    cached: id => details.get(id),
    /** A task fresh from Productive, also when the background load already had it. */
    async fetch(c, ref, id) {
      const [tk, cs, acts] = await Promise.all([c.call("GET", `/tasks/${id}?include=workflow_status,assignee,task_list,creator`),
        all(c, `/comments?filter[task_id]=${id}&include=creator`), all(c, `/activities?filter[task_id]=${id}&include=creator`), ready(c)]);
      const task = build(ref, tk.data, tk.included || [], cs.data, cs.included, acts.data, acts.included);
      details.set(id, task);
      return task;
    },
    /** The panel, in the PR detail's classes so both look alike. */
    render(tk: Task | null, err, e) {
      const bar = `<div class="prd-bar"><button class="btn" data-pr-close title="${t("pr.close")}">×</button>`
        + (tk ? `<span class="sp"></span><a class="btn" href="${e(tk.url)}">${t("kb.open", { name: "Productive" })}</a>` : "") + `</div>`;
      if (err) return bar + `<div class="err">${e(err)}</div>`;
      if (!tk) return bar + `<div class="meta">${t("pr.loading")}</div>`;
      const sec = (title: string, n: number | string, body: string) => `<section class="prd-sec"><h3>${title}${n !== "" ? ` <span class="count">${n}</span>` : ""}</h3>${body}</section>`;
      return bar + `<div class="prd">
        <div class="pr-meta">${[tk.board, tk.list, `#${tk.number}`].filter(Boolean).map(x => `<span>${e(x)}</span>`).join("")}</div>
        <h2 class="prd-t">${tk.closed ? `<span class="pr-draft">${t("kb.closed")}</span>` : ""}${e(tk.title)}</h2>
        <div class="pr-meta"><span>${e(tk.creator)}</span><span>${e(when(tk.created))}</span></div>
        <dl class="pvf">${tk.fields.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join("")}</dl>`
        + sec(t("pr.desc"), "", tk.description.trim() ? `<div class="prd-md">${tk.description}</div>` : `<div class="meta">${t("pr.noDesc")}</div>`)
        + sec(t("kb.feed"), tk.feed.length, tk.feed.length ? tk.feed.map(f => `<div class="prd-c"><div class="prd-ch"><b>${e(f.who || "Productive")}</b><span class="count">${e(when(f.at))}</span></div>`
          + (f.html ? `<div class="prd-md">${f.html}</div>` : `<div class="meta">${e(f.change)}</div>`) + `</div>`).join("") : `<div class="meta">${t("kb.nothing")}</div>`)
        + `</div>`;
    },
  },

  settings: {
    tokenLabel: "int.token",
    help: "pv.help",
    fields: [{ key: "org", label: "pv.org", numeric: true }, { key: "user", label: "pv.user", placeholder: "pv.userPh", numeric: true, optional: true }],
    async test(c) {
      const who = await c.call("GET", c.config.user ? `/people/${c.config.user}` : "/projects?page[size]=1");
      const a = who?.data?.attributes || {};
      return c.config.user ? t("pv.connectedAs", { name: [a.first_name, a.last_name].filter(Boolean).join(" ") }) : t("int.connected");
    },
    import: { label: "pv.import", run: () => invoke<Record<string, string>>("productive_import") },
  },
};
export default productive;
