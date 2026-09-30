import { invoke } from "@tauri-apps/api/core";
import { t, currentLocale } from "./i18n";
import "./usage.css";

// The usage view: the claude.ai plan limits (the backend asks the endpoint Claude Code's /usage reads)
// and the tokens in Claude Code's transcripts, today and this week. Limits every 5 minutes, for the
// sidebar too. Tokens every minute while the view is open: the backend only reads what the
// transcripts gained since the last time.
type Win = { pct: number; resets: string | null };
type Limits = { ok: true; plan?: string | null; session?: Win | null; weekly?: Win | null; scoped: (Win & { name: string })[] }
  | { ok: false; reason: "no-login" | "expired" | "unavailable" };
type Tally = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; unpriced: number };
type Tokens = { today: Tally; week: Tally; vaultToday: Tally; vaultWeek: Tally;
  models: { model: string; today: Tally; week: Tally }[]; sessions: { sid: string; key?: string; today: Tally; week: Tally; last: number }[] };

let limits: Limits | null = null, tokens: Tokens | null = null, tokErr = "", tokAt = 0, reading = false;

export type UsageHelpers = { esc: (s: string) => string;
  // an app conversation (by key) or a terminal session (by sid): its label, and the key to open it
  session: (key: string | undefined, sid: string) => { label: string; key: string } | null };

async function loadLimits(changed: () => void) {
  try { limits = await invoke<Limits>("usage_limits"); } catch { limits = { ok: false, reason: "unavailable" }; }
  changed();
}
async function loadTokens(changed: () => void) {
  if (reading) return;
  reading = true;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const today = d.getTime(), week = today - ((d.getDay() + 6) % 7) * 86400000; // the week starts on Monday
  try { tokens = await invoke<Tokens>("usage_tokens", { today, week }); tokErr = ""; } catch (e) { tokErr = String(e); }
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

const level = (p: number): "" | "soon" | "late" => p >= 95 ? "late" : p >= 80 ? "soon" : "";
// sidebar: the most constrained limit, for the Usage button's dot (in the reminders' urgency colours) and tooltip
export function usageSummary(): { pct: number; level: "" | "soon" | "late"; label: string } | null {
  if (!limits?.ok) return null;
  const all: [string, Win][] = [];
  if (limits.session) all.push([t("usage.session"), limits.session]);
  if (limits.weekly) all.push([t("usage.weekly"), limits.weekly]);
  for (const w of limits.scoped) all.push([t("usage.weeklyModel", { name: w.name }), w]);
  if (!all.length) return null;
  const [label, w] = all.reduce((a, b) => b[1].pct > a[1].pct ? b : a), pct = Math.round(w.pct), when = resetWhen(w.resets);
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
// claude-opus-5-5 as Opus 5.5, claude-haiku-4-5-20251001 as Haiku 4.5, anything else as it is
export const modelName = (id: string) => {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}` : id;
};

function meter(label: string, w: Win) {
  const p = Math.min(100, Math.max(0, w.pct));
  return `<div class="u-lim"><div class="u-row"><span class="u-nm">${label}</span><span class="u-v">${t("usage.used", { pct: Math.round(w.pct) })}</span></div>`
    + `<div class="u-bar ${level(w.pct)}"><span style="width:${p}%"></span></div><div class="u-sub">${resets(w.resets)}</div></div>`;
}
const cost = (x: Tally) => x.cost > 0 ? usd(x.cost) : x.total ? "–" : "";
const pair = (label: string, a: Tally, b: Tally, title = "") =>
  `<div class="u-row u-tok"${title ? ` title="${title}"` : ""}><span class="u-nm">${label}</span><span class="u-v">${a.total ? num(a.total) : "–"}</span><span class="u-c">${cost(a)}</span><span class="u-v">${b.total ? num(b.total) : "–"}</span><span class="u-c">${cost(b)}</span></div>`;
const split = (x: Tally) => t("usage.split", { input: num(x.input), output: num(x.output), read: num(x.cacheRead), write: num(x.cacheWrite) });

export function renderUsage(h: UsageHelpers) {
  let s = `<div class="usage">`;
  // plan limits, or why there are none: never guessed
  s += `<h2>${t("usage.limits")}${limits?.ok && limits.plan ? `<span class="u-plan">${h.esc(limits.plan[0].toUpperCase() + limits.plan.slice(1))}</span>` : ""}</h2>`;
  if (!limits) s += `<p class="u-note">${t("usage.loading")}</p>`;
  else if (!limits.ok) s += `<p class="u-note">${t(`usage.off.${limits.reason}`)}</p>`;
  else {
    if (limits.session) s += meter(t("usage.session"), limits.session);
    if (limits.weekly) s += meter(t("usage.weekly"), limits.weekly);
    for (const w of limits.scoped) s += meter(t("usage.weeklyModel", { name: h.esc(w.name) }), w);
  }

  s += `<h2>${t("usage.tokens")}</h2>`;
  if (!tokens) s += `<p class="u-note">${tokErr ? h.esc(tokErr) : t("usage.reading")}</p>`;
  else {
    const headRow = (label: string) => `<div class="u-row u-tok u-head"><span class="u-nm">${label}</span><span class="u-v">${t("usage.today")}</span><span class="u-c"></span><span class="u-v">${t("usage.week")}</span><span class="u-c"></span></div>`;
    s += headRow("") + pair(t("usage.all"), tokens.today, tokens.week, split(tokens.week)) + pair(t("usage.vault"), tokens.vaultToday, tokens.vaultWeek, split(tokens.vaultWeek));
    if (tokens.models.length) s += `<h3>${t("usage.byModel")}</h3>` + tokens.models.map(m => pair(h.esc(modelName(m.model)), m.today, m.week, split(m.week))).join("");
    const conv = tokens.sessions.filter(x => x.week.total).slice(0, 12);
    if (conv.length) s += `<h3>${t("usage.byConversation")}</h3>` + conv.map(x => {
      const c = h.session(x.key, x.sid);
      const label = c ? h.esc(c.label) : t("usage.otherSession", { id: h.esc(x.sid.slice(0, 8)) });
      return pair(c ? `<a class="u-open" data-usage-open="${h.esc(c.key)}">${label}</a>` : label, x.today, x.week, split(x.week));
    }).join("");
    const unpriced = tokens.week.unpriced ? " " + t("usage.unpriced", { n: num(tokens.week.unpriced) }) : "";
    s += `<p class="u-note">${t("usage.estimate")}${unpriced}</p>`;
  }
  return s + `</div>`;
}
