import { currentLocale, queryText, translator, type BoardProvider, type BoardRef, type Card, type CardView, type Ctx, type Opt, type State, type Tone } from "@relay/board-core";
import { toneOf } from "@relay/board-core/tone";
import { safeUrl } from "@relay/board-core/detail";
import strings, { type Key } from "./locales";
import { showMentions, toHtml, uploadFile } from "./write";
import { toFilters, toGroup, toLayout } from "./views";

const t = translator<Key>("productive");

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
// a workflow status' category: 1 not started, 2 started, 3 closed
const stateOf = (category: unknown): State => (category === 3 ? "done" : category === 2 ? "doing" : "todo");
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name, currentLocale());
const boardNames = new Map<string, string>();

// ---------- one task in the right panel, like Productive's own task view: fields, description, feed

// Productive sends HTML (description, comments), written by clients too. Only plain markup survives,
// every attribute goes except a web or mail link. The CSP already blocks inline script, this is the second wall.
const TAGS = new Set("P BR B STRONG I EM U S STRIKE UL OL LI A CODE PRE BLOCKQUOTE H1 H2 H3 H4 DIV SPAN HR TABLE THEAD TBODY TR TD TH".split(" "));
function clean(html: string): string {
  const doc = new DOMParser().parseFromString(showMentions(html || ""), "text/html");
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
const hours = (min: number | null) => min == null ? "" : `${t("hours", { h: Math.floor(min / 60) })}${min % 60 ? ` ${min % 60}` : ""}`;
const LABEL: Record<string, Key> = { title: "title", task_list: "taskList", assignee: "assignee", workflow_status: "status", due_date: "due",
  start_date: "start", description: "desc", initial_estimate: "estimate", tag_list: "tags", closed: "closed", private: "private" };

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
// per project: its workflow's statuses (the status columns, in Productive's order) and its people, for the panel's pickers
type Opts = { statuses: (Opt & { placement: number; state: State; tone: Tone })[]; people: (Opt & { first: string })[] };
const opts = new Map<string, Promise<Opts>>(), optsDone = new Map<string, Opts>();
function optsOf(c: Ctx, project: string) {
  if (!opts.has(project)) opts.set(project, (async () => {
    const pr = await c.call("GET", `/projects/${project}?include=workflow`), wf = pr.data?.relationships?.workflow?.data?.id;
    const [st, pp] = await Promise.all([wf ? all(c, `/workflow_statuses?filter[workflow_id]=${wf}`) : { data: [] }, all(c, `/people?filter[project_id]=${project}&filter[status]=1`)]);
    const sorted = st.data.map((x: any) => ({ id: x.id, name: x.attributes.name, placement: x.attributes.position ?? 0, state: stateOf(x.attributes.category_id) })).sort((a: any, b: any) => a.placement - b.placement);
    const o: Opts = { statuses: sorted.map((x: any, i: number) => ({ ...x, tone: toneOf(x.state, x.name, !sorted.slice(0, i).some((y: any) => y.state === x.state)) })),
      people: pp.data.map((x: any) => ({ id: x.id, name: person(x), first: x.attributes.first_name || "" })).sort(byName) };
    optsDone.set(project, o);
    return o;
  })().catch(e => { opts.delete(project); throw e; }));
  return opts.get(project)!;
}
// an attachment as the ticket window shows it; Productive keeps deleted ones with deleted_at. A picture also has its
// 100x100 thumb: the original wants a browser login, the thumb is public, so the backend fetches it for the preview
type File_ = { id: string; name: string; size: number; url: string; thumb: string };
const fileOf = (x: any): File_ => ({ id: x.id, name: x.attributes.name || "", size: x.attributes.size || 0, url: safeUrl(x.attributes.url),
  thumb: x.attributes.resized && /^image\//.test(x.attributes.content_type || "") ? x.attributes.thumb || "" : "" });
const live = (x: any) => x.type === "attachments" && !x.attributes?.deleted_at;
const onComment = (x: any) => x.attributes?.attachable_type === "comment" || !!x.relationships?.comment?.data;
const pick = (included: any[], type: string, rel: any) => included.find((i: any) => i.type === type && i.id === rel?.data?.id);
const taskUrl = (ref: BoardRef, id: string) => `https://app.productive.io/${orgSlug}/projects/${ref.project}/tasks/task/${id}`;

// one task from its API record, its comments and its activities
function build(ref: BoardRef, task: any, inc: any[], cs: any[], csInc: any[], acts: any[], actsInc: any[], atts: any[] | null) {
  const a = task.attributes, rel = task.relationships, id = task.id;
  const custom = Object.entries(a.custom_fields || {}).map(([fid, v]) => {
    const f = fields?.get(fid), vals = (Array.isArray(v) ? v : [v]).map(x => f?.opts.get(String(x)) || String(x));
    return [f?.name || fid, vals.join(", ")] as [string, string];
  }).filter(([, v]) => v);
  // the feed, newest first like Productive: comments, and what changed on the task itself
  const filesOf = (c: any) => csInc.filter(i => live(i) && ((c.relationships.attachments?.data || []).some((r: any) => r.id === i.id) || i.relationships?.comment?.data?.id === c.id)).map(fileOf);
  const feed = [...cs.map((c: any) => ({ at: c.attributes.created_at, who: person(pick(csInc, "people", c.relationships.creator)), html: clean(c.attributes.body), change: "", files: filesOf(c) })),
    ...acts.filter((x: any) => x.attributes.item_type === "task").map((x: any) => ({ at: x.attributes.created_at, who: person(pick(actsInc, "people", x.relationships.creator)), html: "",
      change: x.attributes.event === "create" ? t("created") : (x.attributes.changeset || []).map((c: any) => Object.entries(c).map(([k, [from, to]]: [string, any]) =>
        k === "description" ? t("descChanged") : `${LABEL[k] ? t(LABEL[k]) : k}: ${from?.value ?? t("empty")} → ${to?.value ?? t("empty")}`).join(", ")).join(", "), files: [] as File_[] }))]
    .filter(f => f.html || f.change || f.files.length).sort((x, y) => y.at.localeCompare(x.at));
  const list = pick(inc, "task_lists", rel.task_list)?.attributes.name || "";
  return { title: a.title, number: a.number, closed: a.closed, description: clean(a.description), created: a.created_at, creator: person(pick(inc, "people", rel.creator)),
    board: boardNames.get(ref.board) || "", list, url: taskUrl(ref, id), project: ref.project,
    statusId: rel.workflow_status?.data?.id ?? "", assigneeId: rel.assignee?.data?.id ?? "",
    statusName: pick(inc, "workflow_statuses", rel.workflow_status)?.attributes.name || "", state: a.closed ? "done" as State : stateOf(pick(inc, "workflow_statuses", rel.workflow_status)?.attributes.category_id),
    assignee: person(pick(inc, "people", rel.assignee)), due: a.due_date || "", labels: (a.tag_list || []) as string[],
    // the task's own attachments; null until fetched (the background load skips them)
    files: atts && atts.filter(x => live(x) && !onComment(x)).map(fileOf),
    fields: ([[t("status"), pick(inc, "workflow_statuses", rel.workflow_status)?.attributes.name || "", "status"], [t("taskList"), list],
      [t("assignee"), person(pick(inc, "people", rel.assignee)), "assignee"], [t("start"), a.start_date || ""], [t("due"), [a.due_date, a.due_time].filter(Boolean).join(" ")],
      [t("estimate"), hours(a.initial_estimate)], [t("worked"), hours(a.worked_time)], [t("remaining"), hours(a.remaining_time)],
      [t("tags"), (a.tag_list || []).join(", ")], ...custom] as [string, string, string?][]).filter(([, v, cd]) => v || cd),
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
      const [cs, acts] = await Promise.all([all(c, `/comments?filter[task_id]=${ids}&include=creator,task,attachments`), all(c, `/activities?filter[task_id]=${ids}&include=creator`)]);
      if (g !== warming) return;
      for (const x of part) details.set(x.id, build(ref, x, tk.included, cs.data.filter((y: any) => y.relationships.task?.data?.id === x.id), cs.included,
        acts.data.filter((y: any) => String(y.attributes.task_id) === x.id), acts.included, null));
    }
  } catch { /* see above */ }
}

// a task as a card, `o` the project's statuses for the ring's colour
function toCard(c: Ctx, ref: BoardRef, x: any, included: any[], o: Opts | null): Card {
  const status = pick(included, "workflow_statuses", x.relationships.workflow_status)?.attributes, who = pick(included, "people", x.relationships.assignee);
  const sid = x.relationships.workflow_status?.data?.id ?? "", state: State = x.attributes.closed ? "done" : stateOf(status?.category_id);
  return { id: x.id, title: x.attributes.title, number: String(x.attributes.number ?? ""), placement: x.attributes.placement ?? 0, due: x.attributes.due_date ?? null,
    column: x.relationships.task_list?.data?.id ?? "", in: { status: sid }, who: who?.attributes.first_name || "", whoName: person(who), me: !!who && who.id === String(c.config.user || ""),
    status: status?.name, state, tone: o?.statuses.find(s => s.id === sid)?.tone ?? toneOf(state, status?.name || "", state !== "doing"),
    folder: boardNames.get(ref.board), list: pick(included, "task_lists", x.relationships.task_list)?.attributes.name, labels: x.attributes.tag_list || [],
    updated: x.attributes.last_activity_at || x.attributes.updated_at };
}

const productive: BoardProvider<Key> = {
  id: "productive",
  name: "Productive",
  strings,
  // Productive's favicon (productive.io), as vector: its own colours, not the glyph stroke
  glyph: '<defs><linearGradient id="pvg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#AB40FF"/><stop offset="1" stop-color="#5D2BFF"/></linearGradient></defs><rect width="16" height="16" rx="3.6" fill="url(#pvg)" stroke="none"/><g transform="translate(2.5 1.6) scale(.357)" fill="#fff" stroke="none"><path d="M6.036 28.89L.17 18.977a1.217 1.217 0 01.426-1.667l4.633-2.74a1.217 1.217 0 011.666.426l3.3 5.579 3.424-5.89c4.28-7.018 8.712.738 6.693 4.034l-5.89 10.139a2.836 2.836 0 01-2.443 1.412l-3.492.015a2.838 2.838 0 01-2.451-1.393z"/><path d="M30.847 21.445a4.4 4.4 0 11-8.802.001 4.4 4.4 0 018.802 0zm-18.259 3.176c.966 1.64 3.34 1.632 4.297-.014l3.429-5.9c1.787-2.917 3.807-4.476 6.333-4.82.612-.083 1.211-.224 1.374-1.145l.938-5.259a1.234 1.234 0 00-1.207-1.485c-4.603 0-9.956 1.825-14.131 8.672l-3.426 5.892 2.393 4.059z"/></g>',
  // the sidebar's mark: bb's outline of the favicon; its own stroke width, as the group scales it down
  mark: '<g transform="scale(.75) translate(.34 .87) scale(.0753)" stroke-width="25.24"><path d="M140 347c51-2 42-5 80-69l41-71q31-51 76-58c7-1 14-2 16-13l12-64q2-15-15-17c-55 0-119 22-170 104l-41 70-18-31c-23-40-25-53-52-35l-39 24c-9 4-19 11-11 26 8 14 62 108 73 121 11 12 25 13 48 13z"/><path d="M355 302a52 52 0 1 1 0-104 52 52 0 0 1 0 104z"/></g>',

  groupings: [{ id: "list", label: "groupList" }, { id: "status", label: "groupStatus" }],
  projects: async c => (await all(c, `/projects?filter[status]=1${c.config.user ? `&filter[person_id]=${c.config.user}` : ""}`)).data
    .map((p: any) => ({ id: p.id, name: p.attributes.name })).sort(byName),
  boards: async (c, p) => {
    const bs = (await all(c, `/folders?filter[project_id]=${p}&filter[status]=1`)).data
      .sort((a: any, b: any) => (a.attributes.placement ?? 0) - (b.attributes.placement ?? 0)).map((f: any) => ({ id: f.id, name: f.attributes.name }));
    for (const b of bs) boardNames.set(b.id, b.name);
    return bs;
  },
  columns: async (c, ref, group) => group === "status" ? (await optsOf(c, ref.project)).statuses : (await all(c, `/task_lists?filter[folder_id]=${ref.board}&filter[status]=1`)).data
    .map((x: any) => ({ id: x.id, name: x.attributes.name, placement: x.attributes.placement ?? 0 })).sort((a, b) => a.placement - b.placement),
  cards: async (c, ref) => {
    // include=task_list is required: without it the relationship comes back without an id. The project's statuses
    // give the rings their colour. Without them a card still shows, coloured by its status' kind
    const [tk, o] = await Promise.all([all(c, `/tasks?filter[folder_id]=${ref.board}&filter[status]=1&include=task_list,assignee,workflow_status,creator`),
      optsOf(c, ref.project).catch(() => null)]);
    prefetch(c, ref, tk);
    return tk.data.map((x: any) => toCard(c, ref, x, tk.included, o));
  },
  // at the end of the lane: a task in the column's task list, or with the column's status in the board's first task list
  create: async (c, ref, { title, description, column, group }) => {
    const list = group === "status" ? (await all(c, `/task_lists?filter[folder_id]=${ref.board}&filter[status]=1`)).data
      .sort((a: any, b: any) => (a.attributes.placement ?? 0) - (b.attributes.placement ?? 0))[0]?.id : column;
    if (!list) throw new Error(t("noTaskList"));
    const rel: any = { project: { data: { type: "projects", id: ref.project } }, task_list: { data: { type: "task_lists", id: list } } };
    if (group === "status") rel.workflow_status = { data: { type: "workflow_statuses", id: column } };
    const made = await c.call("POST", "/tasks", { data: { type: "tasks", attributes: { title, description: description.trim() ? toHtml(description) : "" }, relationships: rel } });
    // read back with what the board shows (list, status, assignee by name)
    const [tk, o] = await Promise.all([c.call("GET", `/tasks/${made.data.id}?include=task_list,assignee,workflow_status,creator`), optsOf(c, ref.project).catch(() => null)]);
    return toCard(c, ref, tk.data, tk.included || [], o);
  },
  groupHint: "groupHint",
  move: async (c, _ref, card, to, group) => {
    const rel = group === "status" ? { workflow_status: { data: { type: "workflow_statuses", id: to } } } : { task_list: { data: { type: "task_lists", id: to } } };
    const r = await c.call("PATCH", `/tasks/${card.id}`, { data: { type: "tasks", id: card.id, relationships: rel } });
    return r?.data?.attributes?.placement ?? undefined;
  },
  // the project's saved task views (Productive keeps them per project, not per board), as its tabs order them
  views: async (c, ref) => {
    const [vs, o, pr] = await Promise.all([all(c, `/filters?filter[filterable_id]=${ref.project}&filter[filterable_type]=project`), optsOf(c, ref.project),
      c.call("GET", `/projects/${ref.project}`)]);
    const tasks = vs.data.filter((v: any) => v.attributes.filterable_collection === "tasks" && !v.attributes.hidden);
    const lists = tasks.some((v: any) => JSON.stringify(v.attributes.params || {}).includes('"task_list_id"'))
      ? new Map<string, string>((await all(c, `/task_lists?filter[folder_id]=${ref.board}`)).data.map((x: any) => [x.id, x.attributes.name])) : new Map<string, string>();
    const names = { status: new Map(o.statuses.map(s => [s.id, s.name])), who: new Map(o.people.map(p => [p.id, p.first])), list: lists, me: String(c.config.user || "") };
    const order: string[] = pr.data?.attributes?.preferences?.navigation_order || [];
    const at = (id: string) => (order.indexOf(id) + 1 || order.length + 1);
    return tasks.sort((a: any, b: any) => at(a.id) - at(b.id))
      .map((v: any) => ({ id: v.id, name: v.attributes.name, filters: toFilters(v.attributes.params, names), group: toGroup(v.attributes.group_by), layout: toLayout(v.attributes.layout_id) }));
  },
  // Productive's own search over the task title and number, open tasks only; the folder is the task list's
  search: async (c, q) => {
    const r = await c.call("GET", `/tasks?filter[query]=${queryText(q)}&filter[status]=1&page[size]=5&include=project,task_list.folder`);
    const inc = r.included || [];
    return (r.data || []).map((x: any) => ({ id: x.id, title: x.attributes.title, number: String(x.attributes.number ?? ""),
      ref: { provider: "productive", project: x.relationships.project?.data?.id ?? "", board: pick(inc, "task_lists", x.relationships.task_list)?.relationships?.folder?.data?.id ?? "" },
      where: pick(inc, "projects", x.relationships.project)?.attributes.name || "" }));
  },
  url: async (c, ref, id) => { await ready(c); return taskUrl(ref, id); },
  reset: () => { orgSlug = ""; fields = null; details.clear(); opts.clear(); optsDone.clear(); },

  detail: {
    cached: id => details.get(id),
    /** A task fresh from Productive, also when the background load already had it. */
    async fetch(c, ref, id) {
      const [tk, cs, acts, atts] = await Promise.all([c.call("GET", `/tasks/${id}?include=workflow_status,assignee,task_list,creator`),
        all(c, `/comments?filter[task_id]=${id}&include=creator,attachments`), all(c, `/activities?filter[task_id]=${id}&include=creator`),
        all(c, `/attachments?filter[task_id]=${id}`), ready(c), optsOf(c, ref.project).catch(() => null)]);
      const task = build(ref, tk.data, tk.included || [], cs.data, cs.included, acts.data, acts.included, atts.data);
      details.set(id, task);
      return task;
    },
    /** The ticket window's data: what the task has, and the pickers' choices once the project's are known. */
    view(tk: Task): CardView {
      const o = optsDone.get(tk.project);
      return { title: tk.title, number: tk.number, closed: tk.closed, url: tk.url, board: tk.board, list: tk.list, project: tk.project, created: tk.created, creator: tk.creator,
        description: tk.description, status: tk.statusId ? { id: tk.statusId, name: tk.statusName, state: tk.state, tone: o?.statuses.find(s => s.id === tk.statusId)?.tone } : undefined,
        editLabels: true, folder: tk.board,
        assignee: tk.assigneeId ? { id: tk.assigneeId, name: tk.assignee } : undefined, due: tk.due, labels: tk.labels,
        statuses: o?.statuses, people: o?.people, files: tk.files, feed: tk.feed };
    },
    /** comment, status, assignee, attach: done in Productive, then the task read again */
    async act(c, ref, id, action, { value, files, mentions = [] }) {
      const patch = (rel: any) => c.call("PATCH", `/tasks/${id}`, { data: { type: "tasks", id, relationships: rel } });
      if (action === "comment" && value.trim()) await c.call("POST", "/comments", { data: { type: "comments", attributes: { body: toHtml(value, mentions) }, relationships: { task: { data: { type: "tasks", id } } } } });
      else if (action === "status" && value) await patch({ workflow_status: { data: { type: "workflow_statuses", id: value } } });
      else if (action === "assignee") await patch({ assignee: { data: value ? { type: "people", id: value } : null } });
      else if ((action === "label-add" || action === "label-remove") && value.trim()) {
        // tags are the whole list: read now, a background load may be older than what someone else just added
        const now: string[] = (await c.call("GET", `/tasks/${id}`)).data?.attributes?.tag_list || [];
        const next = action === "label-add" ? [...new Set([...now, value.trim()])] : now.filter(x => x !== value);
        await c.call("PATCH", `/tasks/${id}`, { data: { type: "tasks", id, attributes: { tag_list: next } } });
      }
      else if (action === "attach" && files.length) {
        // the relationship is the whole list: the ones already there and the new ones
        // read now, not from the panel: a background load may have dropped them from the cache meanwhile
        const ids = (await all(c, `/attachments?filter[task_id]=${id}`)).data.filter((x: any) => live(x) && !onComment(x)).map((x: any) => x.id as string);
        for (const f of files) ids.push(await uploadFile(c, f));
        await patch({ attachments: { data: ids.map(x => ({ type: "attachments", id: x })) } });
      }
      return productive.detail!.fetch(c, ref, id);
    },
  },

  settings: {
    tokenLabel: "token",
    help: "help",
    fields: [{ key: "org", label: "org", numeric: true }, { key: "user", label: "user", placeholder: "userPh", numeric: true, optional: true }],
    async test(c) {
      const who = await c.call("GET", c.config.user ? `/people/${c.config.user}` : "/projects?page[size]=1");
      const a = who?.data?.attributes || {};
      return c.config.user ? t("connectedAs", { name: [a.first_name, a.last_name].filter(Boolean).join(" ") }) : t("connected");
    },
  },
};
export default productive;
