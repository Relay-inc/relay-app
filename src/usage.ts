import { invoke } from "@tauri-apps/api/core";
import { t, at, currentLocale } from "./i18n";
import { agent, type AgentProvider, type Limits, type LimitWindow, type Tally, type Tokens } from "./agents";
import "./usage.css";

// The usage view: per switched-on agent provider its plan or rate limits (the backend asks each provider, at
// most once a minute) and the tokens in its local logs, today and this week, then the total over all of them.
// Limits every 5 minutes, for the sidebar too. Tokens every minute while the view is open: each provider only
// reads what its logs gained since the last time.
type ProvLimits = { provider: string; limits: Limits };
type AllTokens = { providers: (Tokens & { provider: string })[]; today: Tally; week: Tally };

let limits: ProvLimits[] | null = null, tokens: AllTokens | null = null, tokErr = "", tokAt = 0, reading = false;

export type UsageHelpers = { esc: (s: string) => string;
  // the switched-on providers, in the order of the settings
  agents: () => { id: string; limits: boolean }[];
  // an app conversation (by key) or a terminal session (by sid): its label, and the key to open it
  session: (key: string | undefined, sid: string) => { label: string; key: string } | null };

async function loadLimits(changed: () => void) {
  try { limits = await invoke<ProvLimits[]>("usage_limits"); } catch { limits = []; }
  changed();
}
async function loadTokens(changed: () => void) {
  if (reading) return;
  reading = true;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const today = d.getTime(), week = today - ((d.getDay() + 6) % 7) * 86400000; // the week starts on Monday
  try { tokens = await invoke<AllTokens>("usage_tokens", { today, week }); tokErr = ""; } catch (e) { tokErr = String(e); }
  tokAt = Date.now(); reading = false; changed();
}

// visible: whether the view is open. changed: redraw the sidebar and, when open, the view
export function startUsage(visible: () => boolean, changed: () => void) {
  loadLimits(changed);
  setInterval(() => loadLimits(changed), 5 * 60000);
  setInterval(() => { if (visible()) loadTokens(changed); }, 60000);
}
// on opening the view: tokens right away when the last read is older than a minute
export function openUsage(changed: () => void) { if (Date.now() - tokAt > 60000) loadTokens(changed); }
// after the agents changed in the settings: limits and tokens for the new set
export function reloadUsage(changed: () => void, visible: boolean) { loadLimits(changed); if (visible) loadTokens(changed); else tokAt = 0; }

const level = (p: number): "" | "soon" | "late" => p >= 95 ? "late" : p >= 80 ? "soon" : "";
const winLabel = (p: AgentProvider | undefined, w: LimitWindow, esc: (s: string) => string) =>
  p ? at(p, w.label, { name: esc(w.name ?? "") }) : esc(w.label);
// sidebar: the most constrained limit over every provider, for the Usage button's dot (in the reminders' urgency colours) and tooltip
export function usageSummary(): { pct: number; level: "" | "soon" | "late"; label: string } | null {
  let top: { w: LimitWindow; p: AgentProvider | undefined; id: string } | null = null;
  for (const l of limits || []) if (l.limits.ok) for (const w of l.limits.windows)
    if (!top || w.pct > top.w.pct) top = { w, p: agent(l.provider), id: l.provider };
  if (!top) return null;
  const { w, p } = top, label = t("usage.limitTop", { name: p?.name ?? top.id, label: winLabel(p, w, s => s) }), pct = Math.round(w.pct), when = resetWhen(w.resets);
  return { pct: w.pct, level: level(w.pct), label: when ? t("usage.summaryResets", { label, pct, when }) : t("usage.summary", { label, pct }) };
}

const num = (n: number) => new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const usd = (n: number) => new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
function resetWhen(iso: string | null) {
  const at = iso ? Date.parse(iso) : NaN;
  if (isNaN(at)) return "";
  const min = Math.max(1, Math.round((at - Date.now()) / 60000)), rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  return min < 60 ? rtf.format(min, "minute") : min < 24 * 60 ? rtf.format(Math.round(min / 60), "hour")
    : new Intl.DateTimeFormat(currentLocale(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(at);
}
const resets = (iso: string | null) => { const when = resetWhen(iso); return when ? t("usage.resets", { when }) : ""; };

function meter(label: string, w: LimitWindow) {
  const p = Math.min(100, Math.max(0, w.pct));
  return `<div class="u-lim"><div class="u-row"><span class="u-nm">${label}</span><span class="u-v">${t("usage.used", { pct: Math.round(w.pct) })}</span></div>`
    + `<div class="u-bar ${level(w.pct)}"><span style="width:${p}%"></span></div><div class="u-sub">${resets(w.resets)}</div></div>`;
}
const cost = (x: Tally) => x.cost > 0 ? usd(x.cost) : x.total ? "–" : "";
const pair = (label: string, a: Tally, b: Tally, title = "") =>
  `<div class="u-row u-tok"${title ? ` title="${title}"` : ""}><span class="u-nm">${label}</span><span class="u-v">${a.total ? num(a.total) : "–"}</span><span class="u-c">${cost(a)}</span><span class="u-v">${b.total ? num(b.total) : "–"}</span><span class="u-c">${cost(b)}</span></div>`;
const split = (x: Tally) => t("usage.split", { input: num(x.input), output: num(x.output), read: num(x.cacheRead), write: num(x.cacheWrite) });
const headRow = (label: string) => `<div class="u-row u-tok u-head"><span class="u-nm">${label}</span><span class="u-v">${t("usage.today")}</span><span class="u-c"></span><span class="u-v">${t("usage.week")}</span><span class="u-c"></span></div>`;
const plan = (l: Limits | undefined, esc: (s: string) => string) => l?.ok && l.plan ? `<span class="u-plan">${esc(l.plan[0].toUpperCase() + l.plan.slice(1))}</span>` : "";

// one provider's limits and tokens. `h`: the heading level, h2 alone (as before the providers), h3 under its name
function section(id: string, hasLimits: boolean, hd: "h2" | "h3", h: UsageHelpers) {
  const p = agent(id), lim = limits?.find(l => l.provider === id)?.limits, tok = tokens?.providers.find(x => x.provider === id);
  const name = h.esc(p?.name ?? id), pt = (k: string, x?: Record<string, string | number>) => p ? at(p, k, x) : k;
  let s = "";
  // plan limits, or why there are none: never guessed
  if (hasLimits) {
    s += `<${hd}>${t("usage.limits")}${hd === "h2" ? plan(lim, h.esc) : ""}</${hd}>`;
    if (!limits) s += `<p class="u-note">${pt("limits.loading")}</p>`;
    else if (!lim) s += `<p class="u-note">${pt("off.unavailable")}</p>`;
    else if (!lim.ok) s += `<p class="u-note">${pt(`off.${lim.reason}`)}</p>`;
    else for (const w of lim.windows) s += meter(winLabel(p, w, h.esc), w);
  }
  s += `<${hd}>${t("usage.tokens")}</${hd}>`;
  if (!tok) return s + `<p class="u-note">${tokErr ? h.esc(tokErr) : pt("tokens.reading")}</p>`;
  s += headRow("") + pair(t("usage.all", { name }), tok.today, tok.week, split(tok.week)) + pair(t("usage.vault"), tok.vaultToday, tok.vaultWeek, split(tok.vaultWeek));
  const mn = (m: string) => p?.modelName ? p.modelName(m) : m;
  if (tok.models.length) s += `<h3>${t("usage.byModel")}</h3>` + tok.models.map(m => pair(h.esc(mn(m.model)), m.today, m.week, split(m.week))).join("");
  const conv = tok.sessions.filter(x => x.week.total).slice(0, 12);
  if (conv.length) s += `<h3>${t("usage.byConversation")}</h3>` + conv.map(x => {
    const c = h.session(x.key, x.sid);
    const label = c ? h.esc(c.label) : t("usage.otherSession", { id: h.esc(x.sid.slice(0, 8)) });
    return pair(c ? `<a class="u-open" data-usage-open="${h.esc(c.key)}">${label}</a>` : label, x.today, x.week, split(x.week));
  }).join("");
  return s;
}

export function renderUsage(h: UsageHelpers) {
  const on = h.agents();
  let s = `<div class="usage">`;
  if (!on.length) return s + `<p class="u-note">${t("usage.none")}</p></div>`;
  // one provider: the view as it always was; several: a section per provider, then the total
  if (on.length === 1) s += section(on[0].id, on[0].limits, "h2", h);
  else {
    for (const a of on) {
      const p = agent(a.id), lim = limits?.find(l => l.provider === a.id)?.limits;
      s += `<h2>${p ? `<svg class="g" viewBox="0 0 16 16">${p.glyph}</svg>` : ""}${h.esc(p?.name ?? a.id)}${plan(lim, h.esc)}</h2>` + section(a.id, a.limits, "h3", h);
    }
    if (tokens) s += `<h2>${t("usage.combined")}</h2>` + headRow("") + pair(t("usage.combined"), tokens.today, tokens.week, split(tokens.week));
  }
  if (tokens) {
    const unpricedN = tokens.week.unpriced, unpriced = unpricedN ? " " + t("usage.unpriced", { n: num(unpricedN) }) : "";
    s += `<p class="u-note">${t("usage.estimate")}${unpriced}</p>`;
  }
  return s + `</div>`;
}
