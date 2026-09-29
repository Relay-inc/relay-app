import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";

// ---------- safe markdown: Claude's text never becomes live HTML in a window that can approve actions
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
marked.use({
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
    },
  },
});
const md = (s: string) => marked.parse(s, { async: false }) as string;

// ---------- state
// A conversation has its own key and hangs under a project (or under Algemeen when project is null).
// The key never changes, so moving a conversation to a project is only a label: the running
// process and its session are untouched. Metadata is kept locally, the session lives in Claude Code.
type Item = { kind: "me" | "ai" | "tool" | "err" | "note"; text: string; id?: string; state?: "run" | "ok" | "err"; path?: string };
type Chat = { key: string; project: string | null; title: string; at: number; draft?: boolean };
const store = { get: (k: string, d: any) => { try { return JSON.parse(localStorage.getItem(k) || "") ?? d; } catch { return d; } },
  set: (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };
const convo: Record<string, Item[]> = {};
const status: Record<string, "idle" | "busy"> = {};
const unseen = new Set<string>();
const dismissed = new Set<string>();
let chats: Record<string, Chat> = store.get("chats", {});
let pendingList: any[] = [];
let agentsList: any[] = [];
let hidden: string[] = store.get("hiddenAgents", []);
let snap: any = { projects: [], reminders: [] };
let routeChoice: { key: string; text: string; hits: string[] } | null = null;
const WAIT = "__wait", NEW = "Nieuw gesprek";
let sel: string = store.get("sel", "") || WAIT;
let tab = "open";

const $ = (id: string) => document.getElementById(id)!;
const project = (n: string | null) => n ? snap.projects.find((p: any) => p.name === n) : undefined;
const saveChats = () => store.set("chats", Object.fromEntries(Object.entries(chats).filter(([, c]) => !c.draft)));
const projOf = (key: string) => chats[key]?.project ?? null;
const label = (key: string) => chats[key]?.title || key;
const chatsOf = (p: string | null) => Object.values(chats).filter(c => c.project === p && !c.draft).sort((a, b) => b.at - a.at);
function newChat(p: string | null): string {
  const key = `c:${Date.now().toString(36)}`;
  chats[key] = { key, project: p, title: NEW, at: Date.now(), draft: true };
  return key;
}

// ---------- which project a text is about: names plus aliases from the note frontmatter
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function findProjects(text: string): string[] {
  const hits = new Set<string>();
  for (const p of snap.projects) for (const t of [p.name, ...(p.aliases || [])]) {
    if (t.length < 3) continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(t)}([^\\p{L}\\p{N}]|$)`, "iu").test(text)) hits.add(p.name);
  }
  return [...hits];
}
function aboutProject(key: string): string | null {
  const score: Record<string, number> = {};
  for (const it of convo[key] || []) {
    if (it.kind === "me") for (const p of findProjects(it.text)) score[p] = (score[p] || 0) + 1;
    if (it.kind === "tool" && it.path) for (const p of snap.projects) {
      if (it.path.endsWith(`/${p.name}.md`) || it.path.includes(`/Portfolio/${p.name}/`)) score[p.name] = (score[p.name] || 0) + 2;
    }
  }
  const top = Object.entries(score).sort((a, b) => b[1] - a[1]);
  return top.length && (top.length === 1 || top[0][1] >= 2 * top[1][1]) ? top[0][0] : null;
}

// ---------- tool lines
function base(p = "") { return p.split("/").pop() || p; }
function toolLine(name: string, input: any): string {
  const i = input || {};
  switch (name) {
    case "Read": return `${esc(base(i.file_path))} gelezen`;
    case "Write": return `${esc(base(i.file_path))} geschreven`;
    case "Edit": case "MultiEdit": return `${esc(base(i.file_path))} aangepast`;
    case "Bash": return `<code>${esc(String(i.command || "").slice(0, 90))}</code>`;
    case "Grep": return `gezocht naar <code>${esc(i.pattern)}</code>`;
    case "Glob": return `bestanden gezocht: <code>${esc(i.pattern)}</code>`;
    case "WebSearch": return `op het web gezocht: ${esc(i.query)}`;
    case "WebFetch": try { return `pagina gelezen: ${esc(new URL(i.url).host)}`; } catch { return "pagina gelezen"; }
    case "Agent": case "Task": return `agent: ${esc(i.description || i.subagent_type || "")}`;
    case "Skill": return `skill: ${esc(i.skill)}`;
    case "TodoWrite": return "takenlijst bijgewerkt";
  }
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${esc(m[1].replace(/^claude_ai_|^plugin_/g, ""))}: ${esc(m[2])}` : esc(name);
}

// ---------- incoming events from the claude processes
function push(k: string, it: Item) { (convo[k] ||= []).push(it); }
function onEvent(k: string, ev: any) {
  if (ev.type === "assistant") {
    for (const c of ev.message?.content || []) {
      if (c.type === "text" && c.text.trim()) push(k, { kind: "ai", text: c.text });
      if (c.type === "tool_use") push(k, { kind: "tool", id: c.id, text: toolLine(c.name, c.input), state: "run", path: c.input?.file_path });
    }
  } else if (ev.type === "user") {
    for (const c of ev.message?.content || []) {
      if (c.type !== "tool_result") continue;
      const t = convo[k]?.find(x => x.id === c.tool_use_id);
      if (t) t.state = c.is_error ? "err" : "ok";
    }
  } else if (ev.type === "result") {
    status[k] = "idle";
    if (ev.is_error || ev.subtype !== "success") push(k, { kind: "err", text: ev.result || ev.subtype || "Onbekende fout" });
    if (k !== sel) unseen.add(k);
    if (chats[k]) { chats[k].at = Date.now(); saveChats(); }
    loadSnapshot();
  } else if (ev.type === "stderr") {
    if (ev.text.trim()) push(k, { kind: "err", text: ev.text.slice(0, 2000) });
  } else if (ev.type === "exit") {
    status[k] = "idle";
  } else return;
  if (k === sel) renderChat(); else renderNav();
}

// ---------- history from the transcript, when a conversation opens for the first time
async function ensureHistory(k: string) {
  if (convo[k]) return;
  const hist: any[] = await invoke("history", { project: k });
  const items: Item[] = [];
  for (const e of hist) {
    const c = e.message?.content;
    if (e.type === "user") {
      if (typeof c === "string" && !c.startsWith("<")) items.push({ kind: "me", text: c });
      else if (Array.isArray(c)) for (const x of c) if (x.type === "text" && !x.text.startsWith("<")) items.push({ kind: "me", text: x.text });
    } else for (const x of c || []) {
      if (x.type === "text" && x.text.trim()) items.push({ kind: "ai", text: x.text });
      if (x.type === "tool_use") items.push({ kind: "tool", id: x.id, text: toolLine(x.name, x.input), state: "ok", path: x.input?.file_path });
    }
  }
  convo[k] = items;
  const first = items.find(i => i.kind === "me");
  if (chats[k] && [NEW, "Gesprek", "Algemeen gesprek"].includes(chats[k].title) && first) { chats[k].title = first.text.slice(0, 48); saveChats(); }
}

// ---------- permission and question cards
function describe(r: any): string {
  const i = r.input || {};
  if (r.tool_name === "Bash") return esc(i.command);
  if (i.file_path) return esc(i.file_path) + (i.content ? `\n\n${esc(String(i.content).slice(0, 600))}` : "");
  return esc(JSON.stringify(i, null, 2).slice(0, 900));
}
function card(r: any): string {
  if (r.tool_name === "AskUserQuestion") {
    return `<div class="perm" data-id="${esc(r.id)}"><div class="q">Claude vraagt</div>${(r.input.questions || []).map((q: any, qi: number) => `
      <div class="qh">${esc(q.question)}</div>
      <div class="opts" data-q="${qi}" data-multi="${q.multiSelect ? 1 : 0}">${(q.options || []).map((o: any) =>
        `<button class="btn" data-label="${esc(o.label)}" title="${esc(o.description || "")}">${esc(o.label)}</button>`).join("")}</div>`).join("")}
      <div class="acts"><button class="btn primary" data-act="answer">Antwoorden</button></div></div>`;
  }
  return `<div class="perm" data-id="${esc(r.id)}"><div class="q">Claude wil <b>${esc(r.tool_name)}</b> gebruiken${r.project && r.project !== sel ? ` in ${esc(label(r.project))}` : ""}. Het wacht op jou.</div>
    <pre>${describe(r)}</pre>
    <div class="acts"><button class="btn" data-act="deny">Weigeren</button><button class="btn primary" data-act="allow">Toestaan</button></div></div>`;
}
async function onCard(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest("button"); if (!b) return;
  const box = b.closest(".perm") as HTMLElement | null; if (!box) return;
  const r = pendingList.find(x => x.id === box.dataset.id); if (!r) return;
  if (b.dataset.label !== undefined) {
    const grp = b.parentElement!;
    if (grp.dataset.multi !== "1") grp.querySelectorAll(".btn").forEach(x => { if (x !== b) x.classList.remove("on"); });
    b.classList.toggle("on"); return;
  }
  let decision: any;
  if (b.dataset.act === "allow") decision = { behavior: "allow", updatedInput: r.input };
  else if (b.dataset.act === "deny") decision = { behavior: "deny", message: "Laurent weigerde dit in de app." };
  else if (b.dataset.act === "answer") {
    const answers: Record<string, string> = {};
    box.querySelectorAll<HTMLElement>(".opts").forEach(g => {
      const q = r.input.questions[Number(g.dataset.q)];
      const on = [...g.querySelectorAll<HTMLElement>(".btn.on")].map(x => x.dataset.label!);
      if (on.length) answers[q.question] = on.join(", ");
    });
    if (!Object.keys(answers).length) return;
    decision = { behavior: "allow", updatedInput: { ...r.input, answers } };
  } else return;
  box.querySelectorAll("button").forEach(x => { (x as HTMLButtonElement).disabled = true; });
  await invoke("answer", { id: r.id, decision });
  pendingList = pendingList.filter(x => x.id !== r.id);
  render();
}

// ---------- terminal sessions that wait (background, not started by the app)
const blockedAgents = () => agentsList.filter(a => a.kind === "background" && a.state === "blocked" && !hidden.includes(a.id));
const waitCount = () => pendingList.length + blockedAgents().length;

// ---------- rendering
const waits = (k: string) => pendingList.some(r => r.project === k);
const trailOf = (keys: string[]) => keys.some(waits) ? '<span class="dot"></span>' : keys.some(k => status[k] === "busy") ? '<span class="spin"></span>' : "";
function renderNav() {
  const q = ($("find") as HTMLInputElement).value.toLowerCase();
  const selP = projOf(sel);
  const sub = (c: Chat) => `<div class="row subrow ${sel === c.key ? "sel" : ""} ${unseen.has(c.key) ? "new" : ""}" data-k="${esc(c.key)}"><span class="nm">${esc(c.title)}</span>${trailOf([c.key])}</div>`;
  const w = waitCount();
  let h = `<div class="row ${sel === WAIT ? "sel" : ""}" data-k="${WAIT}"><span class="nm">Wacht op jou</span>${w ? `<span class="badge">${w}</span>` : ""}</div>`;
  h += `<div class="grp">ALGEMEEN<button class="add" data-add="" title="Nieuw algemeen gesprek">+</button></div>`
    + chatsOf(null).filter(c => !q || c.title.toLowerCase().includes(q)).map(c => sub(c).replace("subrow", "")).join("");
  for (const ctx of ["Antenna", "Meersman", "Personal"]) {
    const all = snap.projects.filter((p: any) => p.context === ctx && p.name.toLowerCase().includes(q));
    const shown = q ? all : all.filter((p: any) => ["Active", "Blocked"].includes(p.state) || chatsOf(p.name).length || p.name === selP);
    if (!shown.length) continue;
    h += `<div class="grp">${ctx.toUpperCase()}</div>`;
    for (const p of shown) {
      const cs = chatsOf(p.name), keys = cs.map(c => c.key);
      const on = p.name === selP && !chats[sel]?.draft ? "" : p.name === selP ? "sel" : "";
      h += `<div class="row prow ${on} ${keys.some(k => unseen.has(k)) ? "new" : ""}" data-p="${esc(p.name)}"><span class="nm">${esc(p.name)}</span>${trailOf(keys)}<button class="add" data-add="${esc(p.name)}" title="Nieuw gesprek over ${esc(p.name)}">+</button></div>`
        + cs.slice(0, 5).map(sub).join("") + (cs.length > 5 ? `<div class="row subrow fold" data-p="${esc(p.name)}"><span class="nm">nog ${cs.length - 5}</span></div>` : "");
    }
  }
  $("nav").innerHTML = h;
}

function renderChat() {
  const msgs = $("msgs"), log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (sel === WAIT) {
    $("t").textContent = "Wacht op jou"; $("ts").textContent = `${waitCount()}`;
    $("composer").style.display = "none"; $("movebar").style.display = "none";
    $("new").style.display = $("term").style.display = "none";
    const byK: Record<string, any[]> = {};
    for (const r of pendingList) (byK[r.project] ||= []).push(r);
    const head = (k: string) => `${projOf(k) ? `${esc(projOf(k))} · ` : ""}${esc(label(k))}`;
    msgs.innerHTML = waitCount() ? `<div class="waitlist">${Object.entries(byK).map(([k, rs]) => `<div class="proj">${head(k)}</div>${rs.map(card).join("")}`).join("")}
      ${blockedAgents().map(a => `<div class="proj">${esc(a.name)}</div><div class="perm"><div class="q">Achtergrondsessie in de terminal, geblokkeerd, gestart ${new Date(a.startedAt).toLocaleDateString("nl-BE")}.</div>
        <div class="acts"><button class="btn" data-bg="hide" data-id="${esc(a.id)}">Verbergen</button><button class="btn" data-bg="stop" data-id="${esc(a.id)}">Stoppen</button>
        <button class="btn primary" data-bg="attach" data-id="${esc(a.id)}">Openen in Terminal</button></div></div>`).join("")}</div>`
      : '<div class="note">Niets wacht op jou.</div>';
    return;
  }
  $("composer").style.display = ""; $("new").style.display = $("term").style.display = "";
  const pn = projOf(sel), P = project(pn);
  $("t").textContent = pn || "Algemeen";
  const stateNl: Record<string, string> = { Active: "Actief", Blocked: "Wacht op iemand", Quiet: "Stil", Paused: "Gepauzeerd" };
  $("ts").textContent = P ? `${stateNl[P.state] || P.state}${P.open != null ? ` · ${P.open} open` : ""}` : "";
  const items = convo[sel] || [];
  msgs.innerHTML = (items.length ? items.map(it => {
    if (it.kind === "me") return `<div class="me">${esc(it.text).replace(/\n/g, "<br>")}</div>`;
    if (it.kind === "ai") return `<div class="ai">${md(it.text)}</div>`;
    if (it.kind === "tool") return `<div class="tool ${it.state === "run" ? "run" : it.state === "err" ? "err" : ""}">${it.text}</div>`;
    if (it.kind === "err") return `<div class="err">${esc(it.text)}</div>`;
    return `<div class="note">${esc(it.text)}</div>`;
  }).join("") : `<div class="note">${P ? `Nieuw gesprek over ${esc(pn)}. Claude leest eerst de projectnote.` : "Algemeen gesprek. Noem je een project, dan komt het gesprek onder dat project."}</div>`)
    + (routeChoice && routeChoice.key === sel ? `<div class="perm"><div class="q">Over welk project gaat dit?</div><div class="opts">${routeChoice.hits.map(h =>
        `<button class="btn" data-route-to="${esc(h)}">${esc(h)}</button>`).join("")}<button class="btn" data-route-to="">Hier houden</button></div></div>` : "")
    + pendingList.filter(r => r.project === sel).map(card).join("");
  const about = !pn && !dismissed.has(sel) && status[sel] !== "busy" ? aboutProject(sel) : null;
  $("movebar").innerHTML = about ? `<span>Dit gesprek gaat over <b>${esc(about)}</b>.</span><span class="sp"></span>
    <button class="btn" data-move-no="1">Nee</button><button class="btn primary" data-move="${esc(about)}">Onder ${esc(about)} zetten</button>` : "";
  $("movebar").style.display = about ? "" : "none";
  const busy = status[sel] === "busy";
  $("send").classList.toggle("stop", busy);
  $("send").innerHTML = busy ? '<svg class="i" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none"/></svg>'
    : '<svg class="i" viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
  $("hint").textContent = busy ? "Claude werkt. Je kan naar een ander gesprek, dit loopt door." : "";
  ($("c") as HTMLTextAreaElement).placeholder = P ? `Vraag iets over ${pn}…` : "Vraag iets…";
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function renderInsp() {
  const P = project(projOf(sel)), box = $("insp");
  document.querySelectorAll<HTMLElement>("#seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (!P) {
    const due = snap.reminders.filter((r: any) => r.days <= 0);
    box.innerHTML = `<h2>Vandaag <span class="count">${due.length}</span></h2>${due.length ? `<ul class="todo">${due.map((r: any) =>
      `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count">${esc(r.project || "")} · ${r.days < 0 ? `${-r.days} d vervallen` : "vandaag"}</span></span></li>`).join("")}</ul>`
      : '<div class="meta">Niets vervallen, niets voor vandaag.</div>'}`;
    return;
  }
  const rem = snap.reminders.filter((r: any) => r.project === P.name);
  const when = (r: any) => r.days < 0 ? `${-r.days} d vervallen` : r.days === 0 ? "vandaag" : `over ${r.days} d`;
  const items: string[] = P.open_items || [];
  if (tab === "stand") box.innerHTML = `<h2>Stand van zaken</h2><div class="meta">Bijgewerkt ${esc(P.last)}</div><div class="stand">${md(P.stand || "Geen stand van zaken.")}</div>`;
  else if (tab === "rem") box.innerHTML = rem.length ? `<h2>Reminders</h2><ul class="todo">${rem.map((r: any) =>
    `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count">${when(r)}</span></span></li>`).join("")}</ul>` : '<div class="meta">Geen reminders voor dit project.</div>';
  else box.innerHTML = `<h2>Open <span class="count">${items.length}</span></h2>${items.length
    ? `<ul class="todo">${items.map(x => `<li><input type="checkbox" disabled><span class="tx">${md(x)}</span></li>`).join("")}</ul>`
    : '<div class="meta">Geen open lussen in de note.</div>'}`;
}

function render() { renderNav(); renderChat(); renderInsp(); }

// ---------- actions
async function select(k: string) {
  // an empty draft that is left behind disappears
  if (sel !== k && chats[sel]?.draft && !(convo[sel] || []).length) delete chats[sel];
  sel = k; unseen.delete(k); routeChoice = routeChoice?.key === k ? routeChoice : null;
  store.set("sel", chats[k]?.draft ? WAIT : k);
  if (k !== WAIT && !chats[k]?.draft) await ensureHistory(k);
  render();
  $("log").scrollTop = 1e9;
}
const openProject = (p: string) => select(chatsOf(p)[0]?.key || newChat(p));
function setProject(k: string, p: string, note: string) {
  chats[k].project = p;
  push(k, { kind: "note", text: note });
  saveChats();
}

function grow() { const ta = $("c") as HTMLTextAreaElement; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
async function sendMsg(forced?: string) {
  const ta = $("c") as HTMLTextAreaElement, text = forced ?? ta.value.trim();
  if (!text || sel === WAIT) return;
  const k = sel, c = chats[k];
  ta.value = ""; grow();
  // first message of a general conversation: if it names one project, it goes under that project
  if (c && !c.project && !forced && !(convo[k] || []).length) {
    const hits = findProjects(text);
    if (hits.length === 1) { c.project = hits[0]; push(k, { kind: "note", text: `Onder ${hits[0]} gezet` }); }
    else if (hits.length > 1) { routeChoice = { key: k, text, hits }; renderChat(); return; }
  }
  if (c) { if (c.title === NEW) c.title = text.slice(0, 48); c.draft = false; c.at = Date.now(); saveChats(); }
  push(k, { kind: "me", text }); status[k] = "busy"; render();
  $("log").scrollTop = 1e9;
  const name = `${c?.project || "Algemeen"}: ${c?.title || k}`;
  try { await invoke("send", { project: k, text, name }); }
  catch (e) { push(k, { kind: "err", text: String(e) }); status[k] = "idle"; renderChat(); }
}

$("nav").addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>("[data-add]");
  if (add) { e.stopPropagation(); select(newChat(add.dataset.add || null)); return; }
  const r = t.closest<HTMLElement>(".row"); if (!r) return;
  if (r.dataset.k) select(r.dataset.k); else if (r.dataset.p) openProject(r.dataset.p);
});
$("find").addEventListener("input", renderNav);
$("msgs").addEventListener("click", e => {
  const g = (e.target as HTMLElement).closest<HTMLElement>("[data-bg]");
  if (g) {
    const id = g.dataset.id!, act = g.dataset.bg!;
    if (act === "hide") { hidden.push(id); store.set("hiddenAgents", hidden); render(); return; }
    invoke("bg", { action: act, id }).then(() => { if (act === "stop") { agentsList = agentsList.filter(a => a.id !== id); render(); } })
      .catch(err => { g.textContent = String(err).slice(0, 60); });
    return;
  }
  const rt = (e.target as HTMLElement).closest<HTMLElement>("[data-route-to]");
  if (rt && routeChoice) {
    const r = routeChoice; routeChoice = null;
    if (rt.dataset.routeTo) { chats[r.key].project = rt.dataset.routeTo; push(r.key, { kind: "note", text: `Onder ${rt.dataset.routeTo} gezet` }); }
    sendMsg(r.text); return;
  }
  onCard(e);
});
$("c").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); } });
$("c").addEventListener("input", grow);
$("send").addEventListener("click", () => {
  if (status[sel] === "busy") { invoke("stop", { project: sel }); status[sel] = "idle"; push(sel, { kind: "note", text: "Gestopt." }); render(); }
  else sendMsg();
});
$("new").addEventListener("click", () => { if (sel !== WAIT) select(newChat(projOf(sel))); });
$("movebar").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (!b) return;
  if (b.dataset.move) { setProject(sel, b.dataset.move, `Onder ${b.dataset.move} gezet`); render(); } else { dismissed.add(sel); renderChat(); }
});
$("term").addEventListener("click", () => {
  if (sel === WAIT) return;
  invoke("open_terminal", { project: sel, session: null, name: `${projOf(sel) || "Algemeen"}: ${label(sel)}` });
  status[sel] = "idle"; render();
});
$("seg").addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (b) { tab = b.dataset.tab!; renderInsp(); } });

// ---------- polling: pending questions often, sessions and the vault now and then
async function loadSnapshot() { try { snap = await invoke("snapshot"); render(); } catch (e) { console.error(e); } }
async function pollPending() {
  const next: any[] = await invoke("pending");
  if (JSON.stringify(next.map(x => x.id)) !== JSON.stringify(pendingList.map(x => x.id))) { pendingList = next; render(); }
}
async function pollAgents() { agentsList = await invoke("agents"); renderNav(); if (sel === WAIT) renderChat(); }

// ---------- start: adopt conversations from earlier versions (general:<id>, plain project names)
listen<any>("claude", e => onEvent(e.payload.project, e.payload.event));
await loadSnapshot();
const oldGens: Record<string, { title: string; at: number }> = store.get("gens", {});
for (const k of await invoke<string[]>("chats")) {
  if (chats[k]) continue;
  if (k.startsWith("general:")) chats[k] = { key: k, project: null, title: oldGens[k]?.title || "Algemeen gesprek", at: oldGens[k]?.at || parseInt(k.slice(8), 36) || 0 };
  else if (project(k)) chats[k] = { key: k, project: k, title: "Gesprek", at: 0 };
  else chats[k] = { key: k, project: null, title: "Gesprek", at: parseInt(k.slice(2), 36) || 0 };
}
saveChats();
await Promise.all(Object.values(chats).filter(c => ["Gesprek", "Algemeen gesprek"].includes(c.title)).map(c => ensureHistory(c.key)));
if (sel !== WAIT && !chats[sel]) sel = WAIT;
await select(sel);
pollPending(); pollAgents();
setInterval(pollPending, 700);
setInterval(pollAgents, 10000);
setInterval(loadSnapshot, 60000);
