import { invoke } from "@tauri-apps/api/core";

// Productive boards as a kanban: pick a project and one of its boards, the columns are the board's task
// lists (a board is a `folder` in the API), the cards its open tasks. Dragging a card to another column
// moves it in Productive right away, it is the user's own action (decided 30/9). The backend holds the token.
type List = { id: string; name: string; placement: number };
type Card = { id: string; title: string; number: string; list: string; placement: number; due: string | null; who: string };
type Opt = { id: string; name: string };
type H = { esc: (s: unknown) => string; user: () => string; org: () => string; open: (id: string) => void };

const ls = { get: (k: string) => localStorage.getItem(k) || "", set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
let el: HTMLElement | null = null, h: H;
let projects: Opt[] | null = null, boards: Opt[] = [], lists: List[] = [], cards: Card[] = [];
let project = ls.get("pvProject"), board = ls.get("pvBoard"), err = "", busy = false, gen = 0, orgSlug = "", fields: Map<string, { name: string; opts: Map<string, string> }> | null = null;

const get = (path: string) => invoke<any>("productive", { method: "GET", path, body: null });
// every page of a list endpoint, 200 per page. /activities has no total_pages, only a next link
// ponytail: stops at 10 pages (2000 records), a board that big is not a board anymore
async function all(path: string) {
  const data: any[] = [], included: any[] = [];
  for (let p = 1, n = 1; p <= Math.min(n, 10); p++) {
    const r = await get(`${path}&page[size]=200&page[number]=${p}`);
    data.push(...r.data); included.push(...(r.included || [])); n = r.meta?.total_pages || (r.links?.next ? p + 1 : p);
  }
  return { data, included };
}
const byName = (a: Opt, b: Opt) => a.name.localeCompare(b.name, "nl");
// with a user id only the projects the user is on, else every active project
const fetchProjects = async (user: string): Promise<Opt[]> =>
  (await all(`/projects?filter[status]=1${user ? `&filter[person_id]=${user}` : ""}`)).data.map((p: any) => ({ id: p.id, name: p.attributes.name })).sort(byName);
const fetchBoards = async (p: string): Promise<Opt[]> =>
  (await all(`/folders?filter[project_id]=${p}&filter[status]=1`)).data
    .sort((a: any, b: any) => (a.attributes.placement ?? 0) - (b.attributes.placement ?? 0)).map((f: any) => ({ id: f.id, name: f.attributes.name }));
// include=task_list is required: without it the relationship comes back without an id
async function fetchCards(b: string): Promise<{ lists: List[]; cards: Card[]; raw: { data: any[]; included: any[] } }> {
  const [l, t] = await Promise.all([all(`/task_lists?filter[folder_id]=${b}&filter[status]=1`),
    all(`/tasks?filter[folder_id]=${b}&filter[status]=1&include=task_list,assignee,workflow_status,creator`)]);
  const people = new Map<string, string>(t.included.filter((i: any) => i.type === "people").map((i: any) => [i.id, i.attributes.first_name || ""]));
  return {
    lists: l.data.map((x: any) => ({ id: x.id, name: x.attributes.name, placement: x.attributes.placement ?? 0 })).sort((a: List, b: List) => a.placement - b.placement),
    cards: t.data.map((x: any) => ({ id: x.id, title: x.attributes.title, number: x.attributes.number, placement: x.attributes.placement ?? 0, due: x.attributes.due_date,
      list: x.relationships.task_list?.data?.id ?? "", who: people.get(x.relationships.assignee?.data?.id) || "" })),
    raw: t,
  };
}

// one load at a time: a newer choice makes the answer of an older one irrelevant
async function run(fn: (live: () => boolean) => Promise<void>) {
  const g = ++gen, live = () => g === gen;
  busy = true; err = ""; draw();
  try { await fn(live); } catch (x) { if (live()) err = String(x); }
  if (live()) { busy = false; draw(); }
}
const remember = () => { ls.set("pvProject", project); ls.set("pvBoard", board); };

/** new credentials: start over */
export function resetBoard() { projects = null; boards = []; lists = []; cards = []; err = ""; orgSlug = ""; fields = null; details.clear(); }

/** Show the board in the element, from what is known right away, then fresh from Productive. */
export function showBoard(target: HTMLElement, helpers: H) {
  el = target; h = helpers;
  run(async live => {
    const ps = projects ?? await fetchProjects(h.user()); if (!live()) return;
    projects = ps;
    if (!ps.some(p => p.id === project)) { project = ""; board = ""; }
    const bs = project ? await fetchBoards(project) : []; if (!live()) return;
    boards = bs;
    if (!bs.some(b => b.id === board)) board = bs[0]?.id || "";
    remember();
    const d = board ? await fetchCards(board) : { lists: [], cards: [], raw: { data: [], included: [] } }; if (!live()) return;
    ({ lists, cards } = d); prefetch(d.raw);
  });
}

function draw() {
  if (!el?.isConnected || drag?.on) return;
  const e = h.esc;
  const pick = (id: string, opts: Opt[], cur: string, empty: string) =>
    `<select id="${id}" class="kbsel">${cur ? "" : `<option value="">${empty}</option>`}${opts.map(o => `<option value="${e(o.id)}"${o.id === cur ? " selected" : ""}>${e(o.name)}</option>`).join("")}</select>`;
  const card = (c: Card) => `<div class="kcard" data-card="${e(c.id)}"><div class="kt">${e(c.title)}</div>
    <div class="km"><span>#${e(c.number)}</span>${c.who ? `<span>${e(c.who)}</span>` : ""}${c.due ? `<span>${e(c.due.split("-").reverse().slice(0, 2).map(Number).join("/"))}</span>` : ""}</div></div>`;
  const col = (l: List) => { const cs = cards.filter(c => c.list === l.id).sort((a, b) => a.placement - b.placement);
    return `<div class="kcol" data-list="${e(l.id)}"><div class="kh"><span>${e(l.name)}</span><span class="count">${cs.length}</span></div><div class="kcards">${cs.map(card).join("")}</div></div>`; };
  // a redraw replaces the columns, keep where the board and each column were scrolled to
  const sx = el.querySelector(".kb")?.scrollLeft ?? 0;
  const sy = new Map([...el.querySelectorAll<HTMLElement>(".kcol")].map(c => [c.dataset.list, c.querySelector(".kcards")!.scrollTop]));
  el.innerHTML = `<div class="kbhead">${pick("pvproj", projects || [], project, projects ? "Kies een project" : "Laden…")}`
    + (project ? pick("pvboard", boards, board, "Geen borden") : "")
    + `<span class="sp"></span>${busy ? '<span class="spin"></span>' : ""}<button class="btn" data-kb="reload">Vernieuwen</button></div>`
    + (err ? `<div class="err">${e(err)}</div>` : "")
    + (board && lists.length ? `<div class="kb">${lists.map(col).join("")}</div>` : board && !busy && !err ? '<div class="note">Dit bord heeft geen kolommen.</div>' : "");
  const kb = el.querySelector(".kb"); if (kb) kb.scrollLeft = sx;
  el.querySelectorAll<HTMLElement>(".kcol").forEach(c => { c.querySelector(".kcards")!.scrollTop = sy.get(c.dataset.list) ?? 0; });
}

document.addEventListener("change", e => {
  const t = e.target as HTMLSelectElement;
  if (t.id === "pvproj") {
    const p = t.value;
    run(async live => {
      const bs = p ? await fetchBoards(p) : []; if (!live()) return;
      project = p; boards = bs; board = bs[0]?.id || ""; lists = []; cards = []; remember();
      const d = board ? await fetchCards(board) : { lists: [], cards: [], raw: { data: [], included: [] } }; if (!live()) return;
      ({ lists, cards } = d); prefetch(d.raw);
    });
  } else if (t.id === "pvboard") {
    const b = t.value;
    run(async live => { const d = await fetchCards(b); if (!live()) return; board = b; remember(); ({ lists, cards } = d); prefetch(d.raw); });
  }
});
document.addEventListener("click", e => {
  if ((e.target as HTMLElement).closest("#kb [data-kb=reload]") && el) { projects = null; showBoard(el, h); }
});

// dragging a card: pointer events, the Mac webview does not deliver HTML drag and drop reliably
let drag: { id: string; x: number; y: number; dx: number; dy: number; on: boolean; ghost?: HTMLElement; over?: string } | null = null;
document.addEventListener("pointerdown", e => {
  const c = (e.target as HTMLElement).closest<HTMLElement>("#kb .kcard");
  if (!c || e.button !== 0) return;
  e.preventDefault();
  const r = c.getBoundingClientRect();
  drag = { id: c.dataset.card!, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, on: false };
});
window.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    const c = document.querySelector<HTMLElement>(`#kb .kcard[data-card="${CSS.escape(drag.id)}"]`);
    if (!c) { drag = null; return; }
    drag.on = true;
    drag.ghost = c.cloneNode(true) as HTMLElement;
    drag.ghost.classList.add("kghost"); drag.ghost.style.width = `${c.offsetWidth}px`;
    document.body.append(drag.ghost); c.classList.add("dragging"); document.body.classList.add("reordering");
  }
  drag.ghost!.style.transform = `translate(${e.clientX - drag.dx}px,${e.clientY - drag.dy}px)`;
  const col = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("#kb .kcol");
  document.querySelectorAll("#kb .kcol.over").forEach(x => x.classList.remove("over"));
  drag.over = col?.dataset.list; col?.classList.add("over");
});
window.addEventListener("pointerup", () => {
  const d = drag; drag = null;
  if (!d) return;
  if (!d.on) { h.open(d.id); return; }
  d.ghost?.remove(); document.body.classList.remove("reordering");
  const c = cards.find(x => x.id === d.id);
  if (c && d.over && d.over !== c.list) move(c, d.over); else draw();
});
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
const hours = (min: number | null) => min == null ? "" : `${Math.floor(min / 60)} u${min % 60 ? ` ${min % 60}` : ""}`;
const LABEL: Record<string, string> = { title: "Titel", task_list: "Taaklijst", assignee: "Toegewezen aan", workflow_status: "Status", due_date: "Deadline",
  start_date: "Start", description: "Beschrijving", initial_estimate: "Schatting", tag_list: "Tags", closed: "Afgesloten", private: "Privé" };

// custom field names and select options (the task only carries ids) and the org part of the web URL, once
async function ready() {
  await Promise.all([fields ?? all("/custom_fields?filter[customizable_type]=tasks&include=options").then(r => {
    const opts = new Map<string, string>(r.included.filter((i: any) => i.type === "custom_field_options").map((i: any) => [i.id, i.attributes.name]));
    fields = new Map(r.data.map((f: any) => [f.id, { name: f.attributes.name, opts: new Map<string, string>(
      (f.relationships.options?.data || []).map((o: any) => [o.id, opts.get(o.id) ?? ""])) }]));
  }), orgSlug || get(`/organizations/${h.org()}`).then(r => {
    orgSlug = `${h.org()}-${String(r.data.attributes.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  })]);
}
const pick = (included: any[], type: string, rel: any) => included.find((i: any) => i.type === type && i.id === rel?.data?.id);

// one task from its API record, its comments and its activities
function build(task: any, inc: any[], cs: any[], csInc: any[], acts: any[], actsInc: any[]) {
  const a = task.attributes, rel = task.relationships, id = task.id;
  const custom = Object.entries(a.custom_fields || {}).map(([fid, v]) => {
    const f = fields?.get(fid), vals = (Array.isArray(v) ? v : [v]).map(x => f?.opts.get(String(x)) || String(x));
    return [f?.name || fid, vals.join(", ")] as [string, string];
  }).filter(([, v]) => v);
  // the feed, newest first like Productive: comments, and what changed on the task itself
  const feed = [...cs.map((c: any) => ({ at: c.attributes.created_at, who: person(pick(csInc, "people", c.relationships.creator)), html: clean(c.attributes.body), change: "" })),
    ...acts.filter((x: any) => x.attributes.item_type === "task").map((x: any) => ({ at: x.attributes.created_at, who: person(pick(actsInc, "people", x.relationships.creator)), html: "",
      change: x.attributes.event === "create" ? "maakte de taak aan" : (x.attributes.changeset || []).map((c: any) => Object.entries(c).map(([k, [from, to]]: [string, any]) =>
        k === "description" ? "wijzigde de beschrijving" : `${LABEL[k] || k}: ${from?.value ?? "(leeg)"} → ${to?.value ?? "(leeg)"}`).join(", ")).join(", ") }))]
    .filter(f => f.html || f.change).sort((x, y) => y.at.localeCompare(x.at));
  const list = pick(inc, "task_lists", rel.task_list)?.attributes.name || "";
  return { title: a.title, number: a.number, closed: a.closed, description: clean(a.description), created: a.created_at, creator: person(pick(inc, "people", rel.creator)),
    board: boards.find(b => b.id === board)?.name || "", list, url: `https://app.productive.io/${orgSlug}/projects/${project}/tasks/task/${id}`,
    fields: ([["Status", pick(inc, "workflow_statuses", rel.workflow_status)?.attributes.name || ""], ["Taaklijst", list],
      ["Toegewezen aan", person(pick(inc, "people", rel.assignee))], ["Start", a.start_date || ""], ["Deadline", [a.due_date, a.due_time].filter(Boolean).join(" ")],
      ["Schatting", hours(a.initial_estimate)], ["Gewerkt", hours(a.worked_time)], ["Resterend", hours(a.remaining_time)],
      ["Tags", (a.tag_list || []).join(", ")], ...custom] as [string, string][]).filter(([, v]) => v),
    feed };
}
type Task = ReturnType<typeof build>;
const details = new Map<string, Task>();
let warming = 0;

/** What the background load already has for a task, so the panel opens at once. */
export const cachedTask = (id: string) => details.get(id);

// after a board loads: comments and activities of all its cards, 40 tasks per call, so opening a card
// needs no wait. Background only: when it fails, a click still loads the task itself.
async function prefetch(t: { data: any[]; included: any[] }) {
  const g = ++warming;
  try {
    await ready();
    for (let i = 0; i < t.data.length; i += 40) {
      const part = t.data.slice(i, i + 40), ids = part.map((x: any) => x.id).join(",");
      const [cs, acts] = await Promise.all([all(`/comments?filter[task_id]=${ids}&include=creator,task`), all(`/activities?filter[task_id]=${ids}&include=creator`)]);
      if (g !== warming) return;
      for (const x of part) details.set(x.id, build(x, t.included, cs.data.filter((c: any) => c.relationships.task?.data?.id === x.id), cs.included,
        acts.data.filter((y: any) => String(y.attributes.task_id) === x.id), acts.included));
    }
  } catch { /* see above */ }
}

/** A task fresh from Productive, also when the background load already had it. */
export async function fetchTask(id: string) {
  const [t, cs, acts] = await Promise.all([get(`/tasks/${id}?include=workflow_status,assignee,task_list,creator`),
    all(`/comments?filter[task_id]=${id}&include=creator`), all(`/activities?filter[task_id]=${id}&include=creator`), ready()]);
  const task = build(t.data, t.included || [], cs.data, cs.included, acts.data, acts.included);
  details.set(id, task);
  return task;
}

const when = (iso: string) => new Date(iso).toLocaleString("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** The panel, in the PR detail's classes so both look alike. */
export function renderTask(t: Task | null, err: string, e: (s: unknown) => string): string {
  const bar = `<div class="prd-bar"><button class="btn" data-pr-close title="Sluiten (Esc)">×</button>`
    + (t ? `<span class="sp"></span><a class="btn" href="${e(t.url)}">Openen in Productive</a>` : "") + `</div>`;
  if (err) return bar + `<div class="err">${e(err)}</div>`;
  if (!t) return bar + '<div class="meta">Laden…</div>';
  const sec = (title: string, n: number | string, body: string) => `<section class="prd-sec"><h3>${title}${n !== "" ? ` <span class="count">${n}</span>` : ""}</h3>${body}</section>`;
  return bar + `<div class="prd">
    <div class="pr-meta">${[t.board, t.list, `#${t.number}`].filter(Boolean).map(x => `<span>${e(x)}</span>`).join("")}</div>
    <h2 class="prd-t">${t.closed ? '<span class="pr-draft">Afgesloten</span>' : ""}${e(t.title)}</h2>
    <div class="pr-meta"><span>${e(t.creator)}</span><span>${e(when(t.created))}</span></div>
    <dl class="pvf">${t.fields.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join("")}</dl>`
    + sec("Beschrijving", "", t.description.trim() ? `<div class="prd-md">${t.description}</div>` : '<div class="meta">Geen beschrijving.</div>')
    + sec("Feed", t.feed.length, t.feed.length ? t.feed.map(f => `<div class="prd-c"><div class="prd-ch"><b>${e(f.who || "Productive")}</b><span class="count">${e(when(f.at))}</span></div>`
      + (f.html ? `<div class="prd-md">${f.html}</div>` : `<div class="meta">${e(f.change)}</div>`) + `</div>`).join("") : '<div class="meta">Nog niets.</div>')
    + `</div>`;
}

// shown in the new column at once, back where it was when Productive refuses
async function move(c: Card, to: string) {
  const from = c.list, was = c.placement;
  c.list = to; c.placement = Math.max(0, ...cards.filter(x => x.list === to && x !== c).map(x => x.placement)) + 1; err = ""; draw();
  try {
    const r = await invoke<any>("productive", { method: "PATCH", path: `/tasks/${c.id}`,
      body: { data: { type: "tasks", id: c.id, relationships: { task_list: { data: { type: "task_lists", id: to } } } } } });
    if (r?.data?.attributes?.placement != null) c.placement = r.data.attributes.placement;
  } catch (x) { c.list = from; c.placement = was; err = `Verplaatsen mislukt: ${x}`; }
  draw();
}
