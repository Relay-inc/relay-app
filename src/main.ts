import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { renderReminders, onRemindersEvent, urgency } from "./reminders";
import "./reminders.css";

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
type Chat = { key: string; project: string | null; title: string; at: number; draft?: boolean; fork?: string; closed?: number };
const store = { get: (k: string, d: any) => { try { return JSON.parse(localStorage.getItem(k) || "") ?? d; } catch { return d; } },
  set: (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };
const convo: Record<string, Item[]> = {};
const status: Record<string, "idle" | "busy"> = {};
const busySince: Record<string, number> = {};
const unseen = new Set<string>();
const dismissed = new Set<string>();
let chats: Record<string, Chat> = store.get("chats", {});
let pendingList: any[] = [];
let agentsList: any[] = [];
let hidden: string[] = store.get("hiddenAgents", []);
let forked: string[] = store.get("forkedTerms", []); // terminal sessions continued in the app, no longer listed
let snap: any = { projects: [], reminders: [], sessions: { items: [] } };
let appSids: string[] = [];
let routeChoice: { key: string; text: string; hits: string[] } | null = null;
const WAIT = "__wait", REM = "__rem", NEW = "Nieuw gesprek";
const VIEWS = [WAIT, REM];
type Settings = { vault: string; projects: Record<string, { icon?: string; label?: string }>; overrides: Record<string, string | null> };
let settings: Settings = { vault: "", projects: {}, overrides: {} };
let settingsMsg = "";
let sel: string = store.get("sel", "") || WAIT;
let tab = "open";

const $ = (id: string) => document.getElementById(id)!;
const project = (n: string | null) => n ? snap.projects.find((p: any) => p.name === n) : undefined;
// how a project is shown: its own icon and name from the settings, else the note name
const pLabel = (n: string | null) => { if (!n) return "Algemeen"; const c = settings.projects[n] || {}; return `${c.icon ? c.icon + " " : ""}${c.label || n}`; };
async function saveSettings(next: Settings) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); settingsMsg = ""; return true; }
  catch (e) { settingsMsg = String(e); return false; }
}
const saveChats = () => store.set("chats", Object.fromEntries(Object.entries(chats).filter(([, c]) => !c.draft)));
const projOf = (key: string) => chats[key]?.project ?? null;
const label = (key: string) => chats[key]?.title || key;
const chatsOf = (p: string | null) => Object.values(chats).filter(c => c.project === p && !c.draft && !c.closed).sort((a, b) => b.at - a.at);
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
const termOffset: Record<string, number> = {};
function toItems(hist: any[]): Item[] {
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
  return items;
}
// a terminal conversation: first the whole transcript, then only what was added since the last read
async function tailTerm(k: string): Promise<boolean> {
  const r = await invoke<{ items: any[]; next: number }>("history_sid", { sid: k.slice(2), from: termOffset[k] ?? 0 });
  const fresh = termOffset[k] === undefined;
  termOffset[k] = r.next;
  const add = toItems(r.items);
  if (fresh) convo[k] = add; else if (add.length) convo[k].push(...add);
  return fresh || add.length > 0;
}
async function ensureHistory(k: string, fresh = false) {
  if (isTerm(k)) { if (!convo[k] || fresh) await tailTerm(k); return; }
  if (convo[k] && !fresh) return;
  const items = toItems(await invoke<any[]>("history", { project: k }));
  convo[k] = items;
  if (isTerm(k)) return;
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

// ---------- sessions open in the terminal (not started by the app), with the project snapshot.py read from their transcript
type Term = { key: string; sid: string; id: string; project: string | null; title: string; kind: string; status: string; state?: string; mtime: number };
const GENERIC = /^obsidian-context-management-\w+$/;
function terms(hiddenOnes = false): Term[] {
  const live = new Map(agentsList.map(a => [a.sessionId, a]));
  return (snap.sessions?.items || []).filter((x: any) => !appSids.includes(x.sessionId) && forked.includes(x.sessionId) === hiddenOnes && live.has(x.sessionId))
    .map((x: any) => { const a = live.get(x.sessionId);
      const ov = settings.overrides[x.sessionId];
      return { key: `t:${x.sessionId}`, sid: x.sessionId, id: a.id, mtime: x.last_at ? Date.parse(x.last_at) : 0, project: ov !== undefined ? ov : x.project ?? null, kind: a.kind, status: a.status, state: a.state,
        title: a.name && !GENERIC.test(a.name) ? a.name : (x.last_user || "Terminalsessie").slice(0, 48) }; })
    .filter((t: Term) => !(t.kind === "background" && t.state === "done"));
}
const termOf = (k: string) => terms().find(t => t.key === k);
const isTerm = (k: string) => k.startsWith("t:");

// ---------- terminal sessions that wait (background, not started by the app)
const blockedAgents = () => agentsList.filter(a => a.kind === "background" && a.state === "blocked" && !hidden.includes(a.id));
const waitCount = () => pendingList.length + blockedAgents().length;

// ---------- rendering
const waits = (k: string) => pendingList.some(r => r.project === k);
const trailOf = (keys: string[]) => keys.some(waits) ? '<span class="dot"></span>' : keys.some(k => status[k] === "busy") ? '<span class="spin"></span>' : "";
// sidebar glyphs, the way Mail and Finder put one in front of each row
const G: Record<string, string> = {
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3L4 11ZM6.5 14h3"/>',
  list: '<path d="M6 4.5h7M6 8h7M6 11.5h7M3 4.5h.5M3 8h.5M3 11.5h.5"/>',
  chat: '<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5"/>',
  term: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 6.5 7 8l-2 1.5M8.5 10h2.5"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 2.5v1.5M8 12v1.5M2.5 8H4M12 8h1.5M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M4.1 11.9l1.1-1.1M10.8 5.2l1.1-1.1"/>',
  folder: '<path d="M2.5 5V4a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5Z"/>',
};
const glyph = (n: string) => `<svg class="g" viewBox="0 0 16 16">${G[n]}</svg>`;
const CTX: Record<string, string> = { Antenna: "ctx-a", Meersman: "ctx-m", Personal: "ctx-p" };
let collapsed: Record<string, boolean> = store.get("collapsed", {});
// order Laurent dragged: sections, and projects within a section
let secOrder: string[] = store.get("secOrder", ["Algemeen", "Antenna", "Meersman", "Personal"]);
let projOrder: Record<string, string[]> = store.get("projOrder", {});
let convOrder: Record<string, string[]> = store.get("convOrder", {}); // per project (or "" for Algemeen): conversation keys
const lead = (p: string) => settings.projects[p]?.icon ? `<span class="emo">${esc(settings.projects[p].icon)}</span>` : glyph("folder");

function renderNav() {
  const q = ($("find") as HTMLInputElement).value.toLowerCase();
  const selP = projOf(sel), T = terms();
  const x = (k: string) => `<button class="x" data-close="${esc(k)}" title="Sluiten">×</button>`;
  const sub = (c: Chat, indent = true) => `<div class="row conv ${indent ? "subrow" : ""} ${sel === c.key ? "sel" : ""} ${unseen.has(c.key) ? "new" : ""}" data-k="${esc(c.key)}" data-parent="${esc(c.project ?? "")}">${glyph("chat")}<span class="nm">${esc(c.title)}</span>${trailOf([c.key])}${x(c.key)}</div>`;
  const tsub = (t: Term, indent = true) => `<div class="row conv ${indent ? "subrow" : ""} term ${sel === t.key ? "sel" : ""}" data-k="${esc(t.key)}" data-parent="${esc(t.project ?? "")}" title="Staat open in de terminal">${glyph("term")}<span class="nm">${esc(t.title)}</span>${t.status === "busy" ? '<span class="spin"></span>' : t.state === "blocked" ? '<span class="dot"></span>' : ""}${x(t.key)}</div>`;
  const head = (id: string, labelTxt: string, n: number, cls = "", add?: string) =>
    `<div class="grp ${cls} ${collapsed[id] ? "shut" : ""}" data-sec="${esc(id)}"><span class="chev"></span><span class="gl">${labelTxt}</span>${collapsed[id] && n ? `<span class="gn">${n}</span>` : ""}${add !== undefined ? `<button class="add" data-add="${esc(add)}" title="Nieuw gesprek">+</button>` : ""}</div>`;

  const w = waitCount(), due = snap.reminders.filter((r: any) => r.days <= 0).length;
  let h = `<div class="row ${sel === WAIT ? "sel" : ""}" data-k="${WAIT}">${glyph("bell")}<span class="nm">Wacht op jou</span>${w ? `<span class="badge">${w}</span>` : ""}</div>`
    + `<div class="row ${sel === REM ? "sel" : ""}" data-k="${REM}">${glyph("list")}<span class="nm">Reminders</span>${due ? `<span class="count ${snap.reminders.some((r: any) => r.days < 0) ? "due-late" : "due-soon"}">${due}</span>` : ""}</div>`;

  const gc = chatsOf(null).filter(c => !q || c.title.toLowerCase().includes(q)), gt = T.filter(t => !t.project && (!q || t.title.toLowerCase().includes(q)));
  // conversations in the order Laurent dragged, the rest after them in their default order
  const byConv = (parent: string, rows: { key: string; html: string }[]) => { const o = convOrder[parent] || [];
    return rows.map((r, i) => ({ ...r, i })).sort((a, b) => { const ia = o.indexOf(a.key), ib = o.indexOf(b.key);
      return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : a.i - b.i; }).map(r => r.html).join(""); };
  const general = `<div class="sec" data-drop="Algemeen">${head("Algemeen", "ALGEMEEN", gc.length + gt.length, "", "")}`
    + (collapsed.Algemeen && !q ? "" : byConv("", [...gc.map(c => ({ key: c.key, html: sub(c, false) })), ...gt.map(t => ({ key: t.key, html: tsub(t, false) }))])) + `</div>`;

  // an app conversation stays until Laurent closes it, a terminal session as long as it is open
  const open = (p: any) => T.some(t => t.project === p.name) || chatsOf(p.name).length > 0;
  const lastAt = (n: string) => Math.max(0, ...chatsOf(n).map(c => c.at), ...T.filter(t => t.project === n).map(t => t.mtime));
  const match = (p: any) => p.name.toLowerCase().includes(q) || pLabel(p.name).toLowerCase().includes(q);
  const byRecent = (a: any, b: any) => lastAt(b.name) - lastAt(a.name);
  // manual order from dragging comes first, the rest follows by recency
  const ordered = (ctx: string, list: any[]) => { const o: string[] = projOrder[ctx] || [];
    return [...list].sort((a, b) => { const ia = o.indexOf(a.name), ib = o.indexOf(b.name);
      return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : byRecent(a, b); }); };
  const projRows = (list: any[]) => { let body = ""; for (const p of list) {
      const cs = chatsOf(p.name), ts = T.filter(t => t.project === p.name), keys = [...cs.map(c => c.key), ...ts.map(t => t.key)];
      const on = p.name === selP && chats[sel]?.draft ? "sel" : "";
      body += `<div class="row prow ${on} ${keys.some(k => unseen.has(k)) ? "new" : ""}" data-p="${esc(p.name)}" data-ctx="${esc(p.context)}">${lead(p.name)}<span class="nm">${esc(pLabel(p.name).replace(/^\S+ (?=.)/, s => settings.projects[p.name]?.icon ? "" : s))}</span>${trailOf(keys)}<button class="add" data-add="${esc(p.name)}" title="Nieuw gesprek over ${esc(p.name)}">+</button></div>`
        + byConv(p.name, [...ts.map(t => ({ key: t.key, html: tsub(t) })), ...cs.slice(0, 5).map(c => ({ key: c.key, html: sub(c) }))])
        + (cs.length > 5 ? `<div class="row subrow fold" data-p="${esc(p.name)}"><span class="nm">nog ${cs.length - 5}</span></div>` : "");
  } return body; };
  const secs: Record<string, string> = { Algemeen: general };
  for (const ctx of ["Antenna", "Meersman", "Personal"]) {
    const shown = ordered(ctx, snap.projects.filter((p: any) => p.context === ctx && match(p) && (q || open(p) || p.name === selP)));
    if (shown.length) secs[ctx] = `<div class="sec ${CTX[ctx]}" data-drop="${ctx}">${head(ctx, ctx.toUpperCase(), shown.length)}${collapsed[ctx] && !q ? "" : projRows(shown)}</div>`;
  }
  h += secOrder.filter(k => secs[k]).map(k => secs[k]).join("");
  $("nav").innerHTML = h;
}

function renderChat() {
  const msgs = $("msgs"), log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  $("t").classList.remove("editable"); $("t").title = "";
  if (sel === REM) {
    $("composer").style.display = "none"; $("movebar").style.display = "none";
    $("new").style.display = $("term").style.display = $("close").style.display = "none";
    $("ts").textContent = "";
    $("t").textContent = "Reminders"; msgs.innerHTML = renderReminders(snap.reminders, { esc, md, projectLabel: pLabel });
    return;
  }
  if (sel === WAIT) {
    $("t").textContent = "Wacht op jou"; $("ts").textContent = `${waitCount()}`;
    $("composer").style.display = "none"; $("movebar").style.display = "none";
    $("new").style.display = $("term").style.display = $("close").style.display = "none";
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
  const T = isTerm(sel) ? termOf(sel) : undefined;
  $("composer").style.display = ""; $("new").style.display = ""; $("close").style.display = chats[sel]?.draft ? "none" : "";
  $("term").style.display = T && T.kind !== "background" ? "none" : "";
  const pn = T ? T.project : projOf(sel), P = project(pn);
  $("t").textContent = pLabel(pn);
  $("t").classList.add("editable"); $("t").title = "Project aanpassen: icoon, naam, of dit gesprek naar een ander project";
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
    + pendingList.filter(r => r.project === sel).map(card).join("")
    + (status[sel] === "busy" && !pendingList.some(r => r.project === sel) ? workingHtml(sel) : "");
  const about = !T && !pn && !dismissed.has(sel) && status[sel] !== "busy" ? aboutProject(sel) : null;
  $("movebar").innerHTML = T ? `<span>Dit gesprek staat open in de terminal${T.status === "busy" ? " en werkt nog" : ""}. Typ je hier, dan gaat het verder als kopie in de app. De terminal blijft zoals hij is.</span>`
    : about ? `<span>Dit gesprek gaat over <b>${esc(about)}</b>.</span><span class="sp"></span>
    <button class="btn" data-move-no="1">Nee</button><button class="btn primary" data-move="${esc(about)}">Onder ${esc(about)} zetten</button>` : "";
  $("movebar").style.display = T || about ? "" : "none";
  const busy = status[sel] === "busy";
  $("send").classList.toggle("stop", busy);
  $("send").innerHTML = busy ? '<svg class="i" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none"/></svg>'
    : '<svg class="i" viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
  $("hint").textContent = busy ? "Claude werkt. Je kan naar een ander gesprek, dit loopt door." : "";
  ($("c") as HTMLTextAreaElement).placeholder = T ? "Verder in de app…" : P ? `Vraag iets over ${pn}…` : "Vraag iets…";
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// the title opens a small panel: which project this conversation belongs to, and the project's icon and name
function openPop() {
  if (VIEWS.includes(sel)) return;
  const T = isTerm(sel) ? termOf(sel) : undefined, cur = T ? T.project : projOf(sel), c = cur ? settings.projects[cur] || {} : {};
  const names = snap.projects.map((p: any) => p.name).sort((a: string, b: string) => a.localeCompare(b));
  $("pop").innerHTML = `<label class="plab">Project van dit gesprek
      <select id="popproj"><option value="">Algemeen</option>${names.map((n: string) => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
    ${cur ? `<div class="plab">${esc(cur)} in de zijbalk
      <div class="setrow"><input class="field ico" id="popicon" maxlength="4" placeholder="Icoon" value="${esc(c.icon || "")}"><input class="field" id="poplabel" placeholder="${esc(cur)}" value="${esc(c.label || "")}"></div></div>` : ""}
    <div class="acts"><button class="btn" data-pop="cancel">Annuleren</button><button class="btn primary" data-pop="save">Bewaren</button></div>`;
  $("pop").hidden = false;
  ($("popproj") as HTMLSelectElement).focus();
}
async function onPop(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pop]"); if (!b) return;
  if (b.dataset.pop === "save") {
    const proj = ($("popproj") as HTMLSelectElement).value || null;
    const next = structuredClone(settings);
    const T0 = isTerm(sel) ? termOf(sel) : undefined, cur = T0 ? T0.project : projOf(sel); // the project the icon fields belong to
    if (isTerm(sel)) next.overrides[sel.slice(2)] = proj;
    else if (chats[sel]) { chats[sel].project = proj; saveChats(); }
    const icon = (document.getElementById("popicon") as HTMLInputElement | null)?.value.trim();
    const lab = (document.getElementById("poplabel") as HTMLInputElement | null)?.value.trim();
    if (cur && icon !== undefined) next.projects[cur] = { ...(icon ? { icon } : {}), ...(lab ? { label: lab } : {}) };
    if (!(await saveSettings(next))) { alertMsg(settingsMsg); return; }
  }
  $("pop").hidden = true; render();
}
function alertMsg(m: string) { const p = $("pop"); p.insertAdjacentHTML("afterbegin", `<div class="err">${esc(m)}</div>`); }

// visible while Claude works: pulsing dots, the step it is on, and the seconds since the question
function workingHtml(k: string): string {
  // the running step already has its own line with a spinner, so this only says that Claude is at it
  const running = (convo[k] || []).some(i => i.kind === "tool" && i.state === "run");
  const since = busySince[k] || Date.now(), sec = Math.round((Date.now() - since) / 1000);
  return `<div class="working" aria-live="polite"><span class="pulse"><i></i><i></i><i></i></span><span class="wt">${running ? "Claude werkt" : "Claude denkt na"}</span><span class="mono ws" data-since="${since}">${sec} s</span></div>`;
}
setInterval(() => document.querySelectorAll<HTMLElement>(".ws").forEach(e => {
  const s = Math.round((Date.now() - Number(e.dataset.since)) / 1000); e.textContent = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}), 1000);

function renderInsp() {
  const P = project(isTerm(sel) ? termOf(sel)?.project ?? null : projOf(sel)), box = $("insp");
  document.querySelectorAll<HTMLElement>("#seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (!P) {
    const due = snap.reminders.filter((r: any) => r.days <= 0);
    box.innerHTML = `<h2>Vandaag <span class="count">${due.length}</span></h2>${due.length ? `<ul class="todo">${due.map((r: any) =>
      `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count">${esc(r.project || "")} · <span class="${urgency(r.days)}">${r.days < 0 ? `${-r.days} d vervallen` : "vandaag"}</span></span></span></li>`).join("")}</ul>`
      : '<div class="meta">Niets vervallen, niets voor vandaag.</div>'}`;
    return;
  }
  const rem = snap.reminders.filter((r: any) => r.project === P.name);
  const when = (r: any) => r.days < 0 ? `${-r.days} d vervallen` : r.days === 0 ? "vandaag" : `over ${r.days} d`;
  const items: string[] = P.open_items || [];
  if (tab === "stand") box.innerHTML = `<h2>Stand van zaken</h2><div class="meta">Bijgewerkt ${esc(P.last)}</div><div class="stand">${md(P.stand || "Geen stand van zaken.")}</div>`;
  else if (tab === "rem") box.innerHTML = rem.length ? `<h2>Reminders</h2><ul class="todo">${rem.map((r: any) =>
    `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count ${urgency(r.days)}">${when(r)}</span></span></li>`).join("")}</ul>` : '<div class="meta">Geen reminders voor dit project.</div>';
  else box.innerHTML = `<h2>Open <span class="count">${items.length}</span></h2>${items.length
    ? `<ul class="todo">${items.map(x => `<li><input type="checkbox" disabled><span class="tx">${md(x)}</span></li>`).join("")}</ul>`
    : '<div class="meta">Geen open lussen in de note.</div>'}`;
}

function render() { renderNav(); renderChat(); renderInsp(); }

// ---------- actions
async function select(k: string) {
  // an empty draft that is left behind disappears
  if (sel !== k && chats[sel]?.draft && !(convo[sel] || []).length) delete chats[sel];
  $("pop").hidden = true;
  sel = k; unseen.delete(k); routeChoice = routeChoice?.key === k ? routeChoice : null;
  store.set("sel", chats[k]?.draft ? WAIT : k);
  if (!VIEWS.includes(k) && !chats[k]?.draft) await ensureHistory(k, isTerm(k));
  render();
  $("log").scrollTop = VIEWS.includes(k) ? 0 : 1e9;
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
  if (isTerm(sel)) {
    // typing in a terminal conversation: fork it into an app conversation under the same project
    const t = termOf(sel); if (!t) return;
    const k = newChat(t.project);
    Object.assign(chats[k], { title: t.title, fork: t.sid, draft: false });
    forked.push(t.sid); store.set("forkedTerms", forked);
    convo[k] = [...(convo[sel] || []), { kind: "note", text: "Verder in de app. De terminal blijft zoals hij is." }];
    await select(k);
    return sendMsg(text);
  }
  const k = sel, c = chats[k];
  ta.value = ""; grow();
  // first message of a general conversation: if it names one project, it goes under that project
  if (c && !c.project && !forced && !(convo[k] || []).length) {
    const hits = findProjects(text);
    if (hits.length === 1) { c.project = hits[0]; push(k, { kind: "note", text: `Onder ${hits[0]} gezet` }); }
    else if (hits.length > 1) { routeChoice = { key: k, text, hits }; renderChat(); return; }
  }
  if (c) { if (c.title === NEW) c.title = text.slice(0, 48); c.draft = false; c.at = Date.now(); saveChats(); }
  push(k, { kind: "me", text }); status[k] = "busy"; busySince[k] = Date.now(); render();
  $("log").scrollTop = 1e9;
  const name = `${c?.project || "Algemeen"}: ${c?.title || k}`;
  try { await invoke("send", { project: k, text, name, fork: c?.fork ?? null }); }
  catch (e) { push(k, { kind: "err", text: String(e) }); status[k] = "idle"; renderChat(); }
}

// closing hides a conversation from the sidebar. An app conversation stops but keeps its session, a
// terminal session keeps running in iTerm. Both come back via the undo bar or right-click > Heropen.
async function closeChat(k: string) {
  const title = isTerm(k) ? termOf(k)?.title : label(k);
  if (isTerm(k)) { forked.push(k.slice(2)); store.set("forkedTerms", forked); }
  else if (chats[k]) { await invoke("stop", { project: k }); chats[k].closed = Date.now(); delete status[k]; saveChats(); }
  toast(`Gesloten: ${title}`, () => reopen(k));
  if (sel === k) { const p = isTerm(k) ? null : projOf(k); await select(p && chatsOf(p)[0] ? chatsOf(p)[0].key : WAIT); }
  else render();
}
async function reopen(k: string) {
  if (isTerm(k)) { forked = forked.filter(x => x !== k.slice(2)); store.set("forkedTerms", forked); }
  else if (chats[k]) { delete chats[k].closed; saveChats(); }
  $("toast").hidden = true;
  await select(k);
}
let toastTimer = 0;
function toast(text: string, undo: () => void) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span><span class="sp"></span><button class="btn" id="undo">Ongedaan maken</button>`;
  t.hidden = false;
  $("undo").onclick = undo;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 8000);
}
// what was closed under a project (or under Algemeen when p is null), newest first
function closedOf(p: string | null): { key: string; title: string }[] {
  const cs = Object.values(chats).filter(c => c.closed && c.project === p).sort((a, b) => b.closed! - a.closed!).map(c => ({ key: c.key, title: c.title }));
  const ts = terms(true).filter(t => t.project === p).map(t => ({ key: t.key, title: t.title }));
  return [...cs, ...ts].slice(0, 8);
}

$("nav").addEventListener("click", e => {
  if (justDragged) return;
  const t = e.target as HTMLElement;
  const sec = t.closest<HTMLElement>(".grp");
  if (sec && !t.closest("[data-add]")) { const id = sec.dataset.sec!; collapsed[id] = !collapsed[id]; store.set("collapsed", collapsed); renderNav(); return; }
  const x = t.closest<HTMLElement>("[data-close]");
  if (x) { e.stopPropagation(); closeChat(x.dataset.close!); return; }
  const add = t.closest<HTMLElement>("[data-add]");
  if (add) { e.stopPropagation(); select(newChat(add.dataset.add || null)); return; }
  const r = t.closest<HTMLElement>(".row"); if (!r) return;
  if (r.dataset.k) select(r.dataset.k); else if (r.dataset.p) openProject(r.dataset.p);
});
$("find").addEventListener("input", renderNav);
// reorder by pressing and moving: a section header among headers, a project among the projects of its
// section. Pointer events instead of HTML drag and drop, which the Mac webview does not deliver reliably.
let drag: { kind: "sec" | "proj" | "conv"; id: string; ctx?: string; y: number; on: boolean; target?: HTMLElement; after?: boolean } | null = null;
let justDragged = false;
$("nav").addEventListener("pointerdown", e => {
  const t = e.target as HTMLElement;
  if (e.button !== 0 || t.closest("button")) return;
  const g = t.closest<HTMLElement>(".grp"), pr = t.closest<HTMLElement>(".prow"), cv = t.closest<HTMLElement>(".row.conv");
  if (g || pr || cv) e.preventDefault(); // no text selection starting from a row that can be dragged
  drag = cv ? { kind: "conv", id: cv.dataset.k!, ctx: cv.dataset.parent, y: e.clientY, on: false }
    : pr ? { kind: "proj", id: pr.dataset.p!, ctx: pr.dataset.ctx, y: e.clientY, on: false } : g ? { kind: "sec", id: g.dataset.sec!, y: e.clientY, on: false } : null;
});
window.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.on) { if (Math.abs(e.clientY - drag.y) < 5) return; drag.on = true; document.body.classList.add("reordering");
    (drag.kind === "conv" ? document.querySelector(`.row.conv[data-k="${CSS.escape(drag.id)}"]`) : drag.kind === "proj" ? document.querySelector(`.prow[data-p="${CSS.escape(drag.id)}"]`) : document.querySelector(`.grp[data-sec="${CSS.escape(drag.id)}"]`))?.classList.add("dragging"); }
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  const tgt = drag.kind === "sec" ? under?.closest<HTMLElement>(".sec[data-drop]")
    : drag.kind === "conv" ? under?.closest<HTMLElement>(`.row.conv[data-parent="${CSS.escape(drag.ctx ?? "")}"]`)
    : under?.closest<HTMLElement>(`.prow[data-ctx="${drag.ctx}"]`);
  document.querySelectorAll(".dropbefore,.dropafter").forEach(x => x.classList.remove("dropbefore", "dropafter"));
  if (!tgt) { drag.target = undefined; return; }
  const box = (drag.kind === "sec" ? tgt.querySelector(".grp")! : tgt).getBoundingClientRect();
  drag.after = drag.kind === "sec" ? e.clientY > tgt.getBoundingClientRect().top + tgt.getBoundingClientRect().height / 2 : e.clientY > box.top + box.height / 2;
  drag.target = tgt; tgt.classList.add(drag.after ? "dropafter" : "dropbefore");
});
window.addEventListener("pointerup", () => {
  const d = drag; drag = null;
  document.body.classList.remove("reordering");
  document.querySelectorAll(".dropbefore,.dropafter,.dragging").forEach(x => x.classList.remove("dropbefore", "dropafter", "dragging"));
  if (!d?.on) return;
  justDragged = true; setTimeout(() => { justDragged = false; }, 0);
  if (!d.target) return;
  const place = (list: string[], id: string, ref: string, after: boolean) => {
    const l = list.filter(x => x !== id), i = l.indexOf(ref); l.splice(i < 0 ? l.length : i + (after ? 1 : 0), 0, id); return l; };
  if (d.kind === "sec") { secOrder = place(secOrder, d.id, d.target.dataset.drop!, !!d.after); store.set("secOrder", secOrder); }
  else if (d.kind === "conv") {
    const visible = [...document.querySelectorAll<HTMLElement>(`.row.conv[data-parent="${CSS.escape(d.ctx ?? "")}"]`)].map(r => r.dataset.k!);
    convOrder[d.ctx ?? ""] = place(visible, d.id, d.target.dataset.k!, !!d.after); store.set("convOrder", convOrder);
  }
  else {
    const visible = [...document.querySelectorAll<HTMLElement>(`.prow[data-ctx="${d.ctx}"]`)].map(r => r.dataset.p!);
    projOrder[d.ctx!] = place(visible, d.id, d.target.dataset.p!, !!d.after); store.set("projOrder", projOrder);
  }
  renderNav();
});
listen<Settings>("settings-changed", e => { settings = { ...settings, ...e.payload }; loadSnapshot(); });
$("t").addEventListener("click", openPop);
// right-click on a conversation in the sidebar: the Mac context menu
$("nav").addEventListener("contextmenu", e => {
  const t = e.target as HTMLElement, m = $("ctx");
  const r = t.closest<HTMLElement>(".row[data-k]"), pr = t.closest<HTMLElement>(".prow"), gh = t.closest<HTMLElement>('.grp[data-sec="Algemeen"]');
  if (r && !VIEWS.includes(r.dataset.k!)) {
    m.dataset.k = r.dataset.k!;
    m.innerHTML = `<button data-ctx="assign">Wijzig project…</button><button data-ctx="close">Sluiten</button>`;
  } else if (pr || gh) {
    const p = pr ? pr.dataset.p! : null, closed = closedOf(p);
    m.dataset.k = ""; m.dataset.p = p ?? "";
    m.innerHTML = `<button data-ctx="new">Nieuw gesprek</button>${closed.length ? `<div class="ctxh">Onlangs gesloten</div>${closed.map(c =>
      `<button data-ctx="reopen" data-k="${esc(c.key)}">${esc(c.title)}</button>`).join("")}` : '<div class="ctxh">Niets gesloten</div>'}`;
  } else return;
  e.preventDefault();
  m.style.left = `${e.clientX}px`; m.style.top = `${e.clientY}px`; m.hidden = false;
});
$("ctx").addEventListener("click", async e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ctx]"); const k = $("ctx").dataset.k!, p = $("ctx").dataset.p || null; $("ctx").hidden = true;
  if (!b) return;
  if (b.dataset.ctx === "close") closeChat(k);
  else if (b.dataset.ctx === "reopen") reopen(b.dataset.k!);
  else if (b.dataset.ctx === "new") select(newChat(p));
  else { await select(k); openPop(); }
});
window.addEventListener("click", e => { if (!(e.target as HTMLElement).closest("#ctx")) $("ctx").hidden = true; });
$("pop").addEventListener("click", onPop);
$("msgs").addEventListener("change", e => { onRemindersEvent(e, remAct); });
async function remAct(action: "done" | "push", id: string, date?: string) {
  try { await invoke("reminder", { action, id, date: date ?? null }); } catch (err) { console.error(err); }
  await loadSnapshot();
}
$("msgs").addEventListener("click", e => {
  if (sel === REM && onRemindersEvent(e, remAct)) return;
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
$("close").addEventListener("click", () => { if (sel !== WAIT) closeChat(sel); });
$("new").addEventListener("click", () => { if (sel !== WAIT) select(newChat(isTerm(sel) ? termOf(sel)?.project ?? null : projOf(sel))); });
$("movebar").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (!b) return;
  if (b.dataset.move) { setProject(sel, b.dataset.move, `Onder ${b.dataset.move} gezet`); render(); } else { dismissed.add(sel); renderChat(); }
});
$("term").addEventListener("click", () => {
  if (sel === WAIT) return;
  if (isTerm(sel)) { const t = termOf(sel); if (t) invoke("bg", { action: "attach", id: t.id }); return; }
  invoke("open_terminal", { project: sel, session: null, name: `${projOf(sel) || "Algemeen"}: ${label(sel)}` });
  status[sel] = "idle"; render();
});
// the right panel can be folded away, the choice is remembered
const setInsp = (hide: boolean) => { document.body.classList.toggle("noinsp", hide); store.set("noinsp", hide); };
setInsp(store.get("noinsp", false));
$("toggleinsp").addEventListener("click", () => setInsp(!document.body.classList.contains("noinsp")));
window.addEventListener("keydown", e => { if (e.metaKey && e.altKey && e.code === "KeyI") { e.preventDefault(); setInsp(!document.body.classList.contains("noinsp")); } });
$("seg").addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (b) { tab = b.dataset.tab!; renderInsp(); } });

// ---------- polling: pending questions often, sessions and the vault now and then
async function loadSnapshot() { try { snap = await invoke("snapshot"); render(); } catch (e) { console.error(e); } }
async function pollPending() {
  const next: any[] = await invoke("pending");
  if (JSON.stringify(next.map(x => x.id)) !== JSON.stringify(pendingList.map(x => x.id))) { pendingList = next; render(); }
}
async function pollAgents() {
  [agentsList, appSids] = await Promise.all([invoke<any[]>("agents"), invoke<string[]>("app_sids")]);
  renderNav(); if (sel === WAIT || isTerm(sel)) renderChat();
}

// ---------- start: adopt conversations from earlier versions (general:<id>, plain project names)
listen<any>("claude", e => onEvent(e.payload.project, e.payload.event));
try { settings = { ...settings, ...(await invoke<Settings>("get_settings")) }; } catch { /* older backend */ }
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
await pollAgents();
if (!VIEWS.includes(sel) && !chats[sel] && !termOf(sel)) sel = WAIT;
await select(sel);
pollPending();
setInterval(pollPending, 700);
setInterval(pollAgents, 10000);
setInterval(async () => { if (isTerm(sel) && await tailTerm(sel)) renderChat(); }, 2000);
setInterval(loadSnapshot, 30000);
