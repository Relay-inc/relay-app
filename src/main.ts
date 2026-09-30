import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import { renderReminders, onRemindersEvent, urgency } from "./reminders";
import "./reminders.css";
import { initI18n, applyStatic, t, tn, currentLang } from "./i18n";
import type { Key } from "./locales/en";

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

// ---------- images: pasted or dropped on the composer, sent as base64 blocks, shown via blob URLs
// (short strings, so re-rendering the log does not re-parse megabytes of base64)
type Img = { mt: string; data: string; url: string };
const IMG_OK = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIDE = 2000, MAX_BYTES = 4e6;
let attached: Img[] = []; // waiting in the composer until the next send
const toImg = (mt: string, data: string): Img =>
  ({ mt, data, url: URL.createObjectURL(new Blob([Uint8Array.from(atob(data), ch => ch.charCodeAt(0))], { type: mt })) });
const readUrl = (f: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });
// small enough as is, or redrawn on a canvas: long side at most 2000 px, png stays png unless it is still too big
async function prepImage(f: File): Promise<Img | null> {
  const src = await readUrl(f), img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const w = img.naturalWidth, h = img.naturalHeight, long = Math.max(w, h);
  let out = src;
  if (!IMG_OK.includes(f.type) || long > MAX_SIDE || f.size > MAX_BYTES) {
    const s = Math.min(1, MAX_SIDE / long), cv = document.createElement("canvas"), cx = cv.getContext("2d")!;
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    out = f.type === "image/png" || !IMG_OK.includes(f.type) ? cv.toDataURL("image/png") : "";
    if (!out || out.length > MAX_BYTES * 4 / 3) { // jpeg has no transparency: white behind it
      cx.globalCompositeOperation = "destination-over"; cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      out = cv.toDataURL("image/jpeg", 0.85);
    }
  }
  const m = out.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  return m && IMG_OK.includes(m[1]) ? toImg(m[1], m[2]) : null;
}
async function attach(files: File[]) {
  const imgs = (await Promise.all(files.filter(f => f.type.startsWith("image/")).map(f => prepImage(f).catch(() => null)))).filter((x): x is Img => !!x);
  if (!imgs.length) return;
  attached.push(...imgs); renderAtts();
}
const thumbs = (urls: string[], removable = false) => urls.map((u, i) => u
  ? `<span class="att"><img src="${esc(u)}" alt="" data-zoom>${removable ? `<button class="rm" data-rm="${i}" title="${t("img.remove")}" aria-label="${t("img.removeLabel")}">×</button>` : ""}</span>`
  : `<span class="imgph">${t("img.placeholder")}</span>`).join("");
function renderAtts() {
  const box = $("atts");
  box.hidden = !attached.length;
  box.innerHTML = thumbs(attached.map(a => a.url), true);
}

// ---------- state
// A conversation has its own key and hangs under a project (or under Algemeen when project is null).
// The key never changes, so moving a conversation to a project is only a label: the running
// process and its session are untouched. Metadata is kept locally, the session lives in Claude Code.
type Item = { kind: "me" | "ai" | "tool" | "err" | "note"; text: string; id?: string; state?: "run" | "ok" | "err"; path?: string; imgs?: string[] };
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
// subagents a session spawned (Agent tool, background agents), per conversation key, polled every 2 s
type Sub = { id: string; description: string; agentType?: string; model?: string; running: boolean; started_at: string; last_at: string; tool?: string; input?: any; text?: string };
let subs: Record<string, Sub[]> = {};
const subsOpen = new Set<string>(); // conversations whose finished agents are unfolded
const subLog: Record<string, string[]> = {}; // agent id: its last messages, while unfolded
const runningSubs = (k: string) => (subs[k] || []).filter(a => a.running).length;
const subBadge = (k: string) => { const n = runningSubs(k); return n ? `<span class="acount" title="${tn("nav.agentsWorking", n)}">${n}</span>` : ""; };
let routeChoice: { key: string; text: string; hits: string[] } | null = null;
const WAIT = "__wait", REM = "__rem", NEW = "Nieuw gesprek";
// placeholder titles are stored as they always were (Dutch) and shown in the UI language
const PLACEHOLDER: Record<string, Key> = { [NEW]: "nav.newChat", Gesprek: "chat.untitled", "Algemeen gesprek": "chat.general" };
const shownTitle = (title: string) => PLACEHOLDER[title] ? t(PLACEHOLDER[title]) : title;
const VIEWS = [WAIT, REM];
type Settings = { vault: string; projects: Record<string, { icon?: string; label?: string }>; overrides: Record<string, string | null>; language?: string };
let settings: Settings = { vault: "", projects: {}, overrides: {} };
let settingsMsg = "";
let sel: string = store.get("sel", "") || WAIT;
let tab = "open";

const $ = (id: string) => document.getElementById(id)!;
const project = (n: string | null) => n ? snap.projects.find((p: any) => p.name === n) : undefined;
// how a project is shown: its own icon and name from the settings, else the note name
const pLabel = (n: string | null) => { if (!n) return t("general"); const c = settings.projects[n] || {}; return `${c.icon ? c.icon + " " : ""}${c.label || n}`; };
async function saveSettings(next: Settings) {
  try { settings = await invoke<Settings>("set_settings", { settings: next }); settingsMsg = ""; return true; }
  catch (e) { settingsMsg = String(e); return false; }
}
const saveChats = () => store.set("chats", Object.fromEntries(Object.entries(chats).filter(([, c]) => !c.draft)));
const projOf = (key: string) => chats[key]?.project ?? null;
const label = (key: string) => shownTitle(chats[key]?.title || key);
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
    case "Read": return t("tool.read", { file: esc(base(i.file_path)) });
    case "Write": return t("tool.write", { file: esc(base(i.file_path)) });
    case "Edit": case "MultiEdit": return t("tool.edit", { file: esc(base(i.file_path)) });
    case "Bash": return `<code>${esc(String(i.command || "").slice(0, 90))}</code>`;
    case "Grep": return t("tool.grep", { p: `<code>${esc(i.pattern)}</code>` });
    case "Glob": return t("tool.glob", { p: `<code>${esc(i.pattern)}</code>` });
    case "WebSearch": return t("tool.webSearch", { q: esc(i.query) });
    case "WebFetch": try { return t("tool.webFetchHost", { host: esc(new URL(i.url).host) }); } catch { return t("tool.webFetch"); }
    case "Agent": case "Task": return t("tool.agent", { d: esc(i.description || i.subagent_type || "") });
    case "Skill": return t("tool.skill", { s: esc(i.skill) });
    case "TodoWrite": return t("tool.todo");
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
    if (ev.is_error || ev.subtype !== "success") push(k, { kind: "err", text: ev.result || ev.subtype || t("err.unknown") });
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
      else if (Array.isArray(c)) {
        const texts = c.filter((x: any) => x.type === "text" && !x.text.startsWith("<")).map((x: any) => x.text);
        // an image from the transcript as a thumbnail, or "" (a placeholder) when it is not inline base64
        const imgs = c.filter((x: any) => x.type === "image").map((x: any) => {
          const s = x.source || {};
          return s.type === "base64" && IMG_OK.includes(s.media_type) && typeof s.data === "string" ? toImg(s.media_type, s.data).url : "";
        });
        if (texts.length || imgs.length) items.push({ kind: "me", text: texts.join("\n\n"), ...(imgs.length ? { imgs } : {}) });
      }
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
  if (chats[k] && [NEW, "Gesprek", "Algemeen gesprek"].includes(chats[k].title) && first) { chats[k].title = (first.text || t("chat.image")).slice(0, 48); saveChats(); }
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
    return `<div class="perm" data-id="${esc(r.id)}"><div class="q">${t("card.asks")}</div>${(r.input.questions || []).map((q: any, qi: number) => `
      <div class="qh">${esc(q.question)}</div>
      <div class="opts" data-q="${qi}" data-multi="${q.multiSelect ? 1 : 0}">${(q.options || []).map((o: any) =>
        `<button class="btn" data-label="${esc(o.label)}" title="${esc(o.description || "")}">${esc(o.label)}</button>`).join("")}</div>`).join("")}
      <div class="acts"><button class="btn primary" data-act="answer">${t("card.answer")}</button></div></div>`;
  }
  return `<div class="perm" data-id="${esc(r.id)}"><div class="q">${t("card.wants", { tool: esc(r.tool_name), where: r.project && r.project !== sel ? t("card.in", { name: esc(label(r.project)) }) : "" })}</div>
    <pre>${describe(r)}</pre>
    <div class="acts"><button class="btn" data-act="deny">${t("card.deny")}</button><button class="btn primary" data-act="allow">${t("card.allow")}</button></div></div>`;
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
        title: a.name && !GENERIC.test(a.name) ? a.name : (x.last_user || t("chat.terminal")).slice(0, 48) }; })
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
  const x = (k: string) => `<button class="x" data-close="${esc(k)}" title="${t("nav.close")}">×</button>`;
  const sub = (c: Chat, indent = true) => `<div class="row conv ${indent ? "subrow" : ""} ${sel === c.key ? "sel" : ""} ${unseen.has(c.key) ? "new" : ""}" data-k="${esc(c.key)}" data-parent="${esc(c.project ?? "")}">${glyph("chat")}<span class="nm">${esc(shownTitle(c.title))}</span>${subBadge(c.key)}${trailOf([c.key])}${x(c.key)}</div>`;
  const tsub = (tm: Term, indent = true) => `<div class="row conv ${indent ? "subrow" : ""} term ${sel === tm.key ? "sel" : ""}" data-k="${esc(tm.key)}" data-parent="${esc(tm.project ?? "")}" title="${t("nav.inTerminal")}">${glyph("term")}<span class="nm">${esc(tm.title)}</span>${subBadge(tm.key)}${tm.status === "busy" ? '<span class="spin"></span>' : tm.state === "blocked" ? '<span class="dot"></span>' : ""}${x(tm.key)}</div>`;
  const head = (id: string, labelTxt: string, n: number, cls = "", add?: string) =>
    `<div class="grp ${cls} ${collapsed[id] ? "shut" : ""}" data-sec="${esc(id)}"><span class="chev"></span><span class="gl">${labelTxt}</span>${collapsed[id] && n ? `<span class="gn">${n}</span>` : ""}${add !== undefined ? `<button class="add" data-add="${esc(add)}" title="${t("nav.newChat")}">+</button>` : ""}</div>`;

  const w = waitCount(), due = snap.reminders.filter((r: any) => r.days <= 0).length;
  let h = `<div class="row ${sel === WAIT ? "sel" : ""}" data-k="${WAIT}">${glyph("bell")}<span class="nm">${t("nav.waiting")}</span>${w ? `<span class="badge">${w}</span>` : ""}</div>`
    + `<div class="row ${sel === REM ? "sel" : ""}" data-k="${REM}">${glyph("list")}<span class="nm">${t("nav.reminders")}</span>${due ? `<span class="count ${snap.reminders.some((r: any) => r.days < 0) ? "due-late" : "due-soon"}">${due}</span>` : ""}</div>`;

  const gc = chatsOf(null).filter(c => !q || c.title.toLowerCase().includes(q)), gt = T.filter(t => !t.project && (!q || t.title.toLowerCase().includes(q)));
  // conversations in the order Laurent dragged, the rest after them in their default order
  const byConv = (parent: string, rows: { key: string; html: string }[]) => { const o = convOrder[parent] || [];
    return rows.map((r, i) => ({ ...r, i })).sort((a, b) => { const ia = o.indexOf(a.key), ib = o.indexOf(b.key);
      return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : a.i - b.i; }).map(r => r.html).join(""); };
  const general = `<div class="sec" data-drop="Algemeen">${head("Algemeen", t("general").toUpperCase(), gc.length + gt.length, "", "")}`
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
      body += `<div class="row prow ${on} ${keys.some(k => unseen.has(k)) ? "new" : ""}" data-p="${esc(p.name)}" data-ctx="${esc(p.context)}">${lead(p.name)}<span class="nm">${esc(pLabel(p.name).replace(/^\S+ (?=.)/, s => settings.projects[p.name]?.icon ? "" : s))}</span>${trailOf(keys)}<button class="add" data-add="${esc(p.name)}" title="${t("nav.newChatAbout", { name: esc(p.name) })}">+</button></div>`
        + byConv(p.name, [...ts.map(t => ({ key: t.key, html: tsub(t) })), ...cs.slice(0, 5).map(c => ({ key: c.key, html: sub(c) }))])
        + (cs.length > 5 ? `<div class="row subrow fold" data-p="${esc(p.name)}"><span class="nm">${t("nav.more", { n: cs.length - 5 })}</span></div>` : "");
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
  renderSubs();
  $("t").classList.remove("editable"); $("t").title = "";
  if (sel === REM) {
    $("composer").style.display = "none"; $("movebar").style.display = "none";
    $("new").style.display = $("term").style.display = $("close").style.display = "none";
    $("ts").textContent = "";
    $("t").textContent = t("nav.reminders"); msgs.innerHTML = renderReminders(snap.reminders, { esc, md, projectLabel: pLabel });
    return;
  }
  if (sel === WAIT) {
    $("t").textContent = t("nav.waiting"); $("ts").textContent = `${waitCount()}`;
    $("composer").style.display = "none"; $("movebar").style.display = "none";
    $("new").style.display = $("term").style.display = $("close").style.display = "none";
    const byK: Record<string, any[]> = {};
    for (const r of pendingList) (byK[r.project] ||= []).push(r);
    const head = (k: string) => `${projOf(k) ? `${esc(projOf(k))} · ` : ""}${esc(label(k))}`;
    msgs.innerHTML = waitCount() ? `<div class="waitlist">${Object.entries(byK).map(([k, rs]) => `<div class="proj">${head(k)}</div>${rs.map(card).join("")}`).join("")}
      ${blockedAgents().map(a => `<div class="proj">${esc(a.name)}</div><div class="perm"><div class="q">${t("wait.bg", { date: new Date(a.startedAt).toLocaleDateString(currentLang()) })}</div>
        <div class="acts"><button class="btn" data-bg="hide" data-id="${esc(a.id)}">${t("wait.hide")}</button><button class="btn" data-bg="stop" data-id="${esc(a.id)}">${t("wait.stop")}</button>
        <button class="btn primary" data-bg="attach" data-id="${esc(a.id)}">${t("bar.openTerminal")}</button></div></div>`).join("")}</div>`
      : `<div class="note">${t("wait.none")}</div>`;
    return;
  }
  const T = isTerm(sel) ? termOf(sel) : undefined;
  $("composer").style.display = ""; $("new").style.display = ""; $("close").style.display = chats[sel]?.draft ? "none" : "";
  $("term").style.display = T && T.kind !== "background" ? "none" : "";
  const pn = T ? T.project : projOf(sel), P = project(pn);
  $("t").textContent = pLabel(pn);
  $("t").classList.add("editable"); $("t").title = t("chat.editTitle");
  // the state is the vault's own word (Active, Blocked…), shown translated when it is a known one
  const st = ["Active", "Blocked", "Quiet", "Paused"].includes(P?.state) ? t(`state.${P.state}` as Key) : P?.state;
  $("ts").textContent = P ? `${st}${P.open != null ? ` · ${t("chat.openCount", { n: P.open })}` : ""}` : "";
  const items = convo[sel] || [];
  msgs.innerHTML = (items.length ? items.map(it => {
    if (it.kind === "me") return (it.imgs?.length ? `<div class="mimgs">${thumbs(it.imgs)}</div>` : "")
      + (it.text ? `<div class="me">${esc(it.text).replace(/\n/g, "<br>")}</div>` : "");
    if (it.kind === "ai") return `<div class="ai">${md(it.text)}</div>`;
    if (it.kind === "tool") return `<div class="tool ${it.state === "run" ? "run" : it.state === "err" ? "err" : ""}">${it.text}</div>`;
    if (it.kind === "err") return `<div class="err">${esc(it.text)}</div>`;
    return `<div class="note">${esc(it.text)}</div>`;
  }).join("") : `<div class="note">${P ? t("chat.emptyProject", { name: esc(pn) }) : t("chat.emptyGeneral")}</div>`)
    + (routeChoice && routeChoice.key === sel ? `<div class="perm"><div class="q">${t("route.question")}</div><div class="opts">${routeChoice.hits.map(h =>
        `<button class="btn" data-route-to="${esc(h)}">${esc(h)}</button>`).join("")}<button class="btn" data-route-to="">${t("route.keep")}</button></div></div>` : "")
    + pendingList.filter(r => r.project === sel).map(card).join("")
    + (status[sel] === "busy" && !pendingList.some(r => r.project === sel) ? workingHtml(sel) : "")
    + (T && T.status === "busy" ? `<div class="working"><span class="pulse"><i></i><i></i><i></i></span><span class="wt">${t("term.writing")}</span></div>` : "");
  const about = !T && !pn && !dismissed.has(sel) && status[sel] !== "busy" ? aboutProject(sel) : null;
  $("movebar").innerHTML = T ? `<span>${t("move.term", { busy: T.status === "busy" ? t("move.termBusy") : "" })}</span>`
    : about ? `<span>${t("move.about", { name: esc(about) })}</span><span class="sp"></span>
    <button class="btn" data-move-no="1">${t("move.no")}</button><button class="btn primary" data-move="${esc(about)}">${t("move.yes", { name: esc(about) })}</button>` : "";
  $("movebar").style.display = T || about ? "" : "none";
  const busy = status[sel] === "busy";
  $("send").classList.toggle("stop", busy);
  $("send").innerHTML = busy ? '<svg class="i" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none"/></svg>'
    : '<svg class="i" viewBox="0 0 16 16"><path d="M8 13V3M4 7l4-4 4 4"/></svg>';
  $("hint").textContent = busy ? t("hint.busy") : "";
  ($("c") as HTMLTextAreaElement).placeholder = T ? t("ph.term") : P ? t("ph.project", { name: pn ?? "" }) : t("ph.general");
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// the agents of the open conversation above the composer, like the terminal lists them under the prompt
function renderSubs() {
  const box = $("subs"), list = VIEWS.includes(sel) ? [] : subs[sel] || [];
  box.style.display = list.length ? "" : "none";
  if (!list.length) { box.innerHTML = ""; return; }
  const run = list.filter(a => a.running), done = list.filter(a => !a.running);
  const meta = (a: Sub) => [a.agentType, a.model].filter(Boolean).map(esc).join(" · ");
  const row = (a: Sub) => `<div class="sa ${a.running ? "on" : ""}" data-agent="${esc(a.id)}" title="${t("subs.show")}"><span class="sdot"></span><span class="sd">${esc(a.description)}</span><span class="sm">${meta(a)}</span>`
    + `<span class="sl">${a.running ? (a.tool ? toolLine(a.tool, a.input) : esc(a.text || "")) : ""}</span>`
    + (a.running ? `<span class="ws" data-since="${Date.parse(a.started_at)}">${dur((Date.now() - Date.parse(a.started_at)) / 1000)}</span>` : `<span class="sm">${dur((Date.parse(a.last_at) - Date.parse(a.started_at)) / 1000)}</span>`) + `</div>`
    + (subLog[a.id] ? `<div class="slog">${subLog[a.id].length ? subLog[a.id].map(m => `<div class="ai">${md(m)}</div>`).join("") : `<div class="sm">${t("subs.nothing")}</div>`}</div>` : "");
  box.innerHTML = run.map(row).join("")
    + (done.length ? `<button class="sdone" data-subs-toggle>${tn("subs.done", done.length)}</button>${subsOpen.has(sel) ? done.map(row).join("") : ""}` : "");
}

// the title opens a small panel: which project this conversation belongs to, and the project's icon and name
function openPop() {
  if (VIEWS.includes(sel)) return;
  const T = isTerm(sel) ? termOf(sel) : undefined, cur = T ? T.project : projOf(sel), c = cur ? settings.projects[cur] || {} : {};
  const names = snap.projects.map((p: any) => p.name).sort((a: string, b: string) => a.localeCompare(b));
  $("pop").innerHTML = `<label class="plab">${t("pop.project")}
      <select id="popproj"><option value="">${t("general")}</option>${names.map((n: string) => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
    ${cur ? `<div class="plab">${t("pop.sidebar", { name: esc(cur) })}
      <div class="setrow"><input class="field ico" id="popicon" maxlength="4" placeholder="${t("pop.icon")}" value="${esc(c.icon || "")}"><input class="field" id="poplabel" placeholder="${esc(cur)}" value="${esc(c.label || "")}"></div></div>` : ""}
    <div class="acts"><button class="btn" data-pop="cancel">${t("pop.cancel")}</button><button class="btn primary" data-pop="save">${t("pop.save")}</button></div>`;
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
  return `<div class="working" aria-live="polite"><span class="pulse"><i></i><i></i><i></i></span><span class="wt">${running ? t("work.working") : t("work.thinking")}</span><span class="mono ws" data-since="${since}">${sec} s</span></div>`;
}
const dur = (sec: number) => { const s = Math.max(0, Math.round(sec)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
setInterval(() => document.querySelectorAll<HTMLElement>(".ws").forEach(e => { e.textContent = dur((Date.now() - Number(e.dataset.since)) / 1000); }), 1000);

function renderInsp() {
  const P = project(isTerm(sel) ? termOf(sel)?.project ?? null : projOf(sel)), box = $("insp");
  document.querySelectorAll<HTMLElement>("#seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (!P) {
    const due = snap.reminders.filter((r: any) => r.days <= 0);
    box.innerHTML = `<h2>${t("insp.today")} <span class="count">${due.length}</span></h2>${due.length ? `<ul class="todo">${due.map((r: any) =>
      `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count">${esc(r.project || "")} · <span class="${urgency(r.days)}">${r.days < 0 ? t("due.overdue", { n: -r.days }) : t("due.today")}</span></span></span></li>`).join("")}</ul>`
      : `<div class="meta">${t("insp.nothingDue")}</div>`}`;
    return;
  }
  const rem = snap.reminders.filter((r: any) => r.project === P.name);
  const when = (r: any) => r.days < 0 ? t("due.overdue", { n: -r.days }) : r.days === 0 ? t("due.today") : t("due.in", { n: r.days });
  const items: string[] = P.open_items || [];
  if (tab === "stand") box.innerHTML = `<h2>${t("insp.stand")}</h2><div class="meta">${t("insp.updated", { date: esc(P.last) })}</div><div class="stand">${md(P.stand || t("insp.noStand"))}</div>`;
  else if (tab === "rem") box.innerHTML = rem.length ? `<h2>${t("nav.reminders")}</h2><ul class="todo">${rem.map((r: any) =>
    `<li><input type="checkbox" disabled><span><span class="tx">${md(r.title)}</span><span class="count ${urgency(r.days)}">${when(r)}</span></span></li>`).join("")}</ul>` : `<div class="meta">${t("insp.noRem")}</div>`;
  else box.innerHTML = `<h2>${t("tab.open")} <span class="count">${items.length}</span></h2>${items.length
    ? `<ul class="todo">${items.map(x => `<li><input type="checkbox" disabled><span class="tx">${md(x)}</span></li>`).join("")}</ul>`
    : `<div class="meta">${t("insp.noOpen")}</div>`}`;
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
  if ((!text && !attached.length) || sel === WAIT) return;
  if (isTerm(sel)) {
    // typing in a terminal conversation: fork it into an app conversation under the same project
    const tm = termOf(sel); if (!tm) return;
    const k = newChat(tm.project);
    Object.assign(chats[k], { title: tm.title, fork: tm.sid, draft: false });
    forked.push(tm.sid); store.set("forkedTerms", forked);
    convo[k] = [...(convo[sel] || []), { kind: "note", text: t("note.forked") }];
    await select(k);
    return sendMsg(text);
  }
  const k = sel, c = chats[k];
  ta.value = ""; grow();
  // first message of a general conversation: if it names one project, it goes under that project
  if (c && !c.project && !forced && !(convo[k] || []).length) {
    const hits = findProjects(text);
    if (hits.length === 1) { c.project = hits[0]; push(k, { kind: "note", text: t("note.moved", { name: hits[0] }) }); }
    else if (hits.length > 1) { routeChoice = { key: k, text, hits }; renderChat(); return; }
  }
  if (c) { if (c.title === NEW) c.title = (text || t("chat.image")).slice(0, 48); c.draft = false; c.at = Date.now(); saveChats(); }
  const imgs = attached; attached = []; renderAtts();
  push(k, { kind: "me", text, ...(imgs.length ? { imgs: imgs.map(i => i.url) } : {}) }); status[k] = "busy"; busySince[k] = Date.now(); render();
  $("log").scrollTop = 1e9;
  const name = `${c?.project || "Algemeen"}: ${c?.title || k}`;
  try { await invoke("send", { project: k, text, images: imgs.map(i => ({ media_type: i.mt, data: i.data })), name, fork: c?.fork ?? null }); }
  catch (e) { push(k, { kind: "err", text: String(e) }); status[k] = "idle"; renderChat(); }
}

// closing hides a conversation from the sidebar. An app conversation stops but keeps its session, a
// terminal session keeps running in iTerm. Both come back via the undo bar or right-click > Heropen.
async function closeChat(k: string) {
  const title = isTerm(k) ? termOf(k)?.title : label(k);
  if (isTerm(k)) { forked.push(k.slice(2)); store.set("forkedTerms", forked); }
  else if (chats[k]) { await invoke("stop", { project: k }); chats[k].closed = Date.now(); delete status[k]; saveChats(); }
  toast(t("toast.closed", { title: title ?? "" }), () => reopen(k));
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
  const el = $("toast");
  el.innerHTML = `<span>${esc(text)}</span><span class="sp"></span><button class="btn" id="undo">${t("toast.undo")}</button>`;
  el.hidden = false;
  $("undo").onclick = undo;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { el.hidden = true; }, 8000);
}
// what was closed under a project (or under Algemeen when p is null), newest first
function closedOf(p: string | null): { key: string; title: string }[] {
  const cs = Object.values(chats).filter(c => c.closed && c.project === p).sort((a, b) => b.closed! - a.closed!).map(c => ({ key: c.key, title: shownTitle(c.title) }));
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
listen<Settings>("settings-changed", async e => {
  const relang = e.payload.language !== settings.language;
  settings = { ...settings, ...e.payload };
  if (relang) { await initI18n(); applyStatic(); render(); } // a new language applies without a restart
  loadSnapshot();
});
$("t").addEventListener("click", openPop);
// right-click on a conversation in the sidebar: the Mac context menu
$("nav").addEventListener("contextmenu", e => {
  const el = e.target as HTMLElement, m = $("ctx");
  const r = el.closest<HTMLElement>(".row[data-k]"), pr = el.closest<HTMLElement>(".prow"), gh = el.closest<HTMLElement>('.grp[data-sec="Algemeen"]');
  if (r && !VIEWS.includes(r.dataset.k!)) {
    m.dataset.k = r.dataset.k!;
    m.innerHTML = `<button data-ctx="assign">${t("ctx.assign")}</button><button data-ctx="close">${t("nav.close")}</button>`;
  } else if (pr || gh) {
    const p = pr ? pr.dataset.p! : null, closed = closedOf(p);
    m.dataset.k = ""; m.dataset.p = p ?? "";
    m.innerHTML = `<button data-ctx="new">${t("nav.newChat")}</button>${closed.length ? `<div class="ctxh">${t("ctx.recent")}</div>${closed.map(c =>
      `<button data-ctx="reopen" data-k="${esc(c.key)}">${esc(c.title)}</button>`).join("")}` : `<div class="ctxh">${t("ctx.none")}</div>`}`;
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
    if (rt.dataset.routeTo) { chats[r.key].project = rt.dataset.routeTo; push(r.key, { kind: "note", text: t("note.moved", { name: rt.dataset.routeTo }) }); }
    sendMsg(r.text); return;
  }
  onCard(e);
});
$("subs").addEventListener("click", async e => {
  const t = e.target as HTMLElement, a = t.closest<HTMLElement>("[data-agent]");
  if (t.closest("[data-subs-toggle]")) { if (subsOpen.has(sel)) subsOpen.delete(sel); else subsOpen.add(sel); }
  else if (a) { const id = a.dataset.agent!; if (subLog[id]) delete subLog[id]; else subLog[id] = await invoke<string[]>("agent_log", { key: sel, id }); }
  else return;
  renderSubs();
});
$("c").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); } });
$("c").addEventListener("input", grow);
// an image on the clipboard becomes a thumbnail. Copied text that also carries an image rendering
// (Numbers, Word) pastes as text the way it always did, only a bare file name (a Finder copy) gives way.
$("c").addEventListener("paste", e => {
  const cd = e.clipboardData, t = cd?.getData("text/plain").trim() || "";
  if (!cd || (t && !/^[^\n/]+\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(t))) return;
  const files = [...cd.items].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter((f): f is File => !!f);
  if (!files.length) return;
  e.preventDefault(); attach(files);
});
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
$("composer").addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); $("composer").classList.add("drop"); });
$("composer").addEventListener("dragleave", () => $("composer").classList.remove("drop"));
$("composer").addEventListener("drop", e => {
  $("composer").classList.remove("drop");
  if (!hasFiles(e)) return;
  e.preventDefault(); attach([...e.dataTransfer!.files]);
});
// no stray drop outside the composer opens the file in the webview
window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("drop", e => { if (hasFiles(e)) e.preventDefault(); });
$("atts").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-rm]"); if (!b) return;
  e.stopPropagation();
  const [gone] = attached.splice(Number(b.dataset.rm), 1); if (gone) URL.revokeObjectURL(gone.url);
  renderAtts(); ($("c") as HTMLTextAreaElement).focus();
});
// a thumbnail, in the composer or the conversation, opens larger. Esc or a click closes it.
document.addEventListener("click", e => {
  const im = (e.target as HTMLElement).closest<HTMLImageElement>("img[data-zoom]"); if (!im) return;
  $("zoom").querySelector("img")!.src = im.src; $("zoom").hidden = false;
});
$("zoom").addEventListener("click", () => { $("zoom").hidden = true; });
window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("zoom").hidden) { e.preventDefault(); $("zoom").hidden = true; } });
$("send").addEventListener("click", () => {
  if (status[sel] === "busy") { invoke("stop", { project: sel }); status[sel] = "idle"; push(sel, { kind: "note", text: t("note.stopped") }); render(); }
  else sendMsg();
});
$("close").addEventListener("click", () => { if (sel !== WAIT) closeChat(sel); });
$("new").addEventListener("click", () => { if (sel !== WAIT) select(newChat(isTerm(sel) ? termOf(sel)?.project ?? null : projOf(sel))); });
$("movebar").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button"); if (!b) return;
  if (b.dataset.move) { setProject(sel, b.dataset.move, t("note.moved", { name: b.dataset.move })); render(); } else { dismissed.add(sel); renderChat(); }
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
async function pollSubs() {
  const keys = [...Object.values(chats).filter(c => !c.draft && !c.closed).map(c => c.key), ...terms().map(t => t.key)];
  const next = await invoke<Record<string, Sub[]>>("subagents", { keys }).catch(() => subs);
  if (JSON.stringify(next) === JSON.stringify(subs)) return;
  subs = next; renderNav(); renderSubs();
}
async function pollAgents() {
  [agentsList, appSids] = await Promise.all([invoke<any[]>("agents"), invoke<string[]>("app_sids")]);
  renderNav(); if (sel === WAIT || isTerm(sel)) renderChat();
}

// ---------- start: adopt conversations from earlier versions (general:<id>, plain project names)
listen<any>("claude", e => onEvent(e.payload.project, e.payload.event));
try { settings = { ...settings, ...(await invoke<Settings>("get_settings")) }; } catch { /* older backend */ }
await initI18n(); applyStatic();
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
pollSubs();
setInterval(pollSubs, 2000);
// a terminal conversation that is open in the app: new transcript lines and its busy state every 2 s
setInterval(async () => {
  if (!isTerm(sel)) return;
  const [grew] = await Promise.all([tailTerm(sel), invoke<any[]>("agents").then(a => { agentsList = a; })]);
  if (grew || termOf(sel)?.status === "busy") renderChat(); renderNav();
}, 2000);
setInterval(loadSnapshot, 30000);
