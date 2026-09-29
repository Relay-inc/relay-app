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
type Item = { kind: "me" | "ai" | "tool" | "err" | "note"; text: string; id?: string; state?: "run" | "ok" | "err" };
type Status = "idle" | "busy";
const convo: Record<string, Item[]> = {};
const status: Record<string, Status> = {};
const unseen = new Set<string>();
let pendingList: any[] = [];
let agentsList: any[] = [];
let snap: any = { projects: [], reminders: [] };
const WAIT = "__wait", GENERAL = "Algemeen";
let sel = (() => { try { return localStorage.getItem("sel") || GENERAL; } catch { return GENERAL; } })();
let tab = "open";

const $ = (id: string) => document.getElementById(id)!;
const project = (n: string) => snap.projects.find((p: any) => p.name === n);

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
function push(p: string, it: Item) { (convo[p] ||= []).push(it); }
function onEvent(p: string, ev: any) {
  if (ev.type === "assistant") {
    for (const c of ev.message?.content || []) {
      if (c.type === "text" && c.text.trim()) push(p, { kind: "ai", text: c.text });
      if (c.type === "tool_use") push(p, { kind: "tool", id: c.id, text: toolLine(c.name, c.input), state: "run" });
    }
  } else if (ev.type === "user") {
    for (const c of ev.message?.content || []) {
      if (c.type !== "tool_result") continue;
      const t = convo[p]?.find(x => x.id === c.tool_use_id);
      if (t) t.state = c.is_error ? "err" : "ok";
    }
  } else if (ev.type === "result") {
    status[p] = "idle";
    if (ev.is_error || ev.subtype !== "success") push(p, { kind: "err", text: ev.result || ev.subtype || "Onbekende fout" });
    if (p !== sel) unseen.add(p);
    loadSnapshot();
  } else if (ev.type === "stderr") {
    if (ev.text.trim()) push(p, { kind: "err", text: ev.text.slice(0, 2000) });
  } else if (ev.type === "exit") {
    status[p] = "idle";
  } else return;
  if (p === sel) renderChat(); else renderNav();
}

// ---------- history from the transcript, when a project opens for the first time
async function ensureHistory(p: string) {
  if (convo[p]) return;
  const hist: any[] = await invoke("history", { project: p });
  const items: Item[] = [];
  for (const e of hist) {
    const c = e.message?.content;
    if (e.type === "user") {
      if (typeof c === "string" && !c.startsWith("<")) items.push({ kind: "me", text: c });
      else if (Array.isArray(c)) for (const x of c) if (x.type === "text" && !x.text.startsWith("<")) items.push({ kind: "me", text: x.text });
    } else for (const x of c || []) {
      if (x.type === "text" && x.text.trim()) items.push({ kind: "ai", text: x.text });
      if (x.type === "tool_use") items.push({ kind: "tool", id: x.id, text: toolLine(x.name, x.input), state: "ok" });
    }
  }
  convo[p] = items;
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
  return `<div class="perm" data-id="${esc(r.id)}"><div class="q">Claude wil <b>${esc(r.tool_name)}</b> gebruiken${r.project && r.project !== sel ? ` in ${esc(r.project)}` : ""}. Het wacht op jou.</div>
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
const blockedAgents = () => agentsList.filter(a => a.kind === "background" && a.state === "blocked");
const waitCount = () => pendingList.length + blockedAgents().length;

// ---------- rendering
function renderNav() {
  const q = ($("find") as HTMLInputElement).value.toLowerCase();
  const row = (name: string, label: string, trail: string, cls = "") =>
    `<div class="row ${cls} ${sel === name ? "sel" : ""}" data-p="${esc(name)}"><span class="nm">${esc(label)}</span>${trail}</div>`;
  const trail = (n: string) => pendingList.some(r => (r.project || GENERAL) === n) ? '<span class="dot"></span>'
    : status[n] === "busy" ? '<span class="spin"></span>' : "";
  const w = waitCount();
  let h = row(WAIT, "Wacht op jou", w ? `<span class="badge">${w}</span>` : "") + row(GENERAL, "Algemeen", trail(GENERAL), unseen.has(GENERAL) ? "new" : "");
  for (const c of ["Antenna", "Meersman", "Personal"]) {
    const all = snap.projects.filter((p: any) => p.context === c && p.name.toLowerCase().includes(q));
    const shown = q ? all : all.filter((p: any) => ["Active", "Blocked"].includes(p.state) || status[p.name] || p.name === sel);
    if (!shown.length) continue;
    h += `<div class="grp">${c.toUpperCase()}</div>` + shown.map((p: any) => row(p.name, p.name, trail(p.name), unseen.has(p.name) ? "new" : "")).join("");
  }
  $("nav").innerHTML = h;
}

function renderChat() {
  const msgs = $("msgs"), log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  if (sel === WAIT) {
    $("t").textContent = "Wacht op jou"; $("ts").textContent = `${waitCount()}`;
    $("composer").style.display = "none";
    const byP: Record<string, any[]> = {};
    for (const r of pendingList) (byP[r.project || GENERAL] ||= []).push(r);
    msgs.innerHTML = waitCount() ? `<div class="waitlist">${Object.entries(byP).map(([p, rs]) => `<div class="proj">${esc(p)}</div>${rs.map(card).join("")}`).join("")}
      ${blockedAgents().map(a => `<div class="proj">${esc(a.name)}</div><div class="perm"><div class="q">Achtergrondsessie in de terminal, geblokkeerd, gestart ${new Date(a.startedAt).toLocaleDateString("nl-BE")}.</div>
        <div class="acts"><button class="btn primary" data-term="${esc(a.sessionId)}" data-name="${esc(a.name)}">Openen in Terminal</button></div></div>`).join("")}</div>`
      : '<div class="note">Niets wacht op jou.</div>';
    return;
  }
  $("composer").style.display = "";
  const P = project(sel);
  $("t").textContent = sel;
  const stateNl: Record<string, string> = { Active: "Actief", Blocked: "Wacht op iemand", Quiet: "Stil", Paused: "Gepauzeerd" };
  $("ts").textContent = P ? `${stateNl[P.state] || P.state}${P.open != null ? ` · ${P.open} open` : ""}` : "";
  const items = convo[sel] || [];
  msgs.innerHTML = (items.length ? items.map(it => {
    if (it.kind === "me") return `<div class="me">${esc(it.text).replace(/\n/g, "<br>")}</div>`;
    if (it.kind === "ai") return `<div class="ai">${md(it.text)}</div>`;
    if (it.kind === "tool") return `<div class="tool ${it.state === "run" ? "run" : it.state === "err" ? "err" : ""}">${it.text}</div>`;
    if (it.kind === "err") return `<div class="err">${esc(it.text)}</div>`;
    return `<div class="note">${esc(it.text)}</div>`;
  }).join("") : `<div class="note">${P ? `Vraag iets over ${esc(sel)}. Claude leest eerst de projectnote.` : "Algemeen gesprek, niet aan een project gebonden."}</div>`)
    + pendingList.filter(r => (r.project || GENERAL) === sel).map(card).join("");
  const busy = status[sel] === "busy";
  $("send").classList.toggle("stop", busy);
  $("send").innerHTML = busy ? '<svg class="i" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none"/></svg>'
    : '<svg class="i" viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
  $("hint").textContent = busy ? "Claude werkt. Je kan naar een ander project, dit loopt door." : "";
  ($("c") as HTMLTextAreaElement).placeholder = P ? `Vraag iets over ${sel}…` : "Vraag iets…";
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function renderInsp() {
  const P = project(sel), box = $("insp");
  document.querySelectorAll<HTMLElement>("#seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (!P) { box.innerHTML = sel === WAIT ? "" : '<div class="meta">Geen projectnote.</div>'; return; }
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
async function select(p: string) {
  sel = p; unseen.delete(p);
  try { localStorage.setItem("sel", p); } catch { /* storage unavailable */ }
  if (p !== WAIT) await ensureHistory(p);
  render();
  $("log").scrollTop = 1e9;
}
function grow() { const ta = $("c") as HTMLTextAreaElement; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
async function sendMsg() {
  const ta = $("c") as HTMLTextAreaElement, text = ta.value.trim();
  if (!text || sel === WAIT) return;
  const p = sel;
  ta.value = ""; grow();
  push(p, { kind: "me", text }); status[p] = "busy"; renderChat(); renderNav();
  $("log").scrollTop = 1e9;
  try { await invoke("send", { project: p, text }); }
  catch (e) { push(p, { kind: "err", text: String(e) }); status[p] = "idle"; renderChat(); }
}

$("nav").addEventListener("click", e => { const r = (e.target as HTMLElement).closest<HTMLElement>(".row"); if (r) select(r.dataset.p!); });
$("find").addEventListener("input", renderNav);
$("msgs").addEventListener("click", e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-term]");
  if (t) { invoke("open_terminal", { project: t.dataset.name, session: t.dataset.term }); return; }
  onCard(e);
});
$("c").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); } });
$("c").addEventListener("input", grow);
$("send").addEventListener("click", () => {
  if (status[sel] === "busy") { invoke("stop", { project: sel }); status[sel] = "idle"; push(sel, { kind: "note", text: "Gestopt." }); renderChat(); renderNav(); }
  else sendMsg();
});
$("new").addEventListener("click", async () => { if (sel === WAIT) return; await invoke("reset", { project: sel }); convo[sel] = []; status[sel] = "idle"; render(); });
$("term").addEventListener("click", () => { if (sel !== WAIT) { invoke("open_terminal", { project: sel, session: null }); status[sel] = "idle"; render(); } });
$("seg").addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (b) { tab = b.dataset.tab!; renderInsp(); } });

// ---------- polling: pending questions often, sessions and the vault now and then
async function loadSnapshot() { try { snap = await invoke("snapshot"); render(); } catch (e) { console.error(e); } }
async function pollPending() {
  const next: any[] = await invoke("pending");
  if (JSON.stringify(next.map(x => x.id)) !== JSON.stringify(pendingList.map(x => x.id))) { pendingList = next; render(); }
}
async function pollAgents() { agentsList = await invoke("agents"); renderNav(); if (sel === WAIT) renderChat(); }

listen<any>("claude", e => onEvent(e.payload.project, e.payload.event));
await loadSnapshot();
await select(sel);
pollPending(); pollAgents();
setInterval(pollPending, 700);
setInterval(pollAgents, 10000);
setInterval(loadSnapshot, 60000);
