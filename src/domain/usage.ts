import { invoke } from "@tauri-apps/api/core";
import { t, at, currentLocale } from "../core/i18n";
import { changed } from "../core/store";
import { agent, type AgentProvider, type Limits, type LimitWindow, type Tally, type Tokens } from "./agents";
import { ui, USAGE } from "./ui";
import { chat, shownTitle, terms } from "./chats/state";
import { pLabel } from "./vault";

// Usage per switched-on agent provider: its plan or rate limits (the backend asks each provider, at most once a
// minute) and the tokens in its local logs, today and this week, then the total over all of them. Limits every
// 5 minutes, for the sidebar too. Tokens every minute while the view is open: each provider only reads what its
// logs gained since the last time.
export type ProvLimits = { provider: string; limits: Limits };
export type AllTokens = { providers: (Tokens & { provider: string })[]; today: Tally; week: Tally };

export const usage = { limits: null as ProvLimits[] | null, tokens: null as AllTokens | null, tokErr: "", tokAt: 0, reading: false };
const visible = () => ui.sel === USAGE;

async function loadLimits() {
  try { usage.limits = await invoke<ProvLimits[]>("usage_limits"); } catch { usage.limits = []; }
  changed();
}
async function loadTokens() {
  if (usage.reading) return;
  usage.reading = true;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const today = d.getTime(), week = today - ((d.getDay() + 6) % 7) * 86400000; // the week starts on Monday
  try { usage.tokens = await invoke<AllTokens>("usage_tokens", { today, week }); usage.tokErr = ""; } catch (e) { usage.tokErr = String(e); }
  usage.tokAt = Date.now(); usage.reading = false; changed();
}
export function startUsage() {
  loadLimits();
  setInterval(loadLimits, 5 * 60000);
  setInterval(() => { if (visible()) loadTokens(); }, 60000);
}
// on opening the view: tokens right away when the last read is older than a minute
export function openUsage() { if (Date.now() - usage.tokAt > 60000) loadTokens(); }
// after the agents changed in the settings: limits and tokens for the new set
export function reloadUsage() { loadLimits(); if (visible()) loadTokens(); else usage.tokAt = 0; }

export const level = (p: number): "" | "soon" | "late" => p >= 95 ? "late" : p >= 80 ? "soon" : "";
export const winText = (p: AgentProvider | undefined, w: LimitWindow) => p ? at(p, w.label, { name: w.name ?? "" }) : w.label;
export function resetWhen(iso: string | null) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (isNaN(ms)) return "";
  const min = Math.max(1, Math.round((ms - Date.now()) / 60000)), rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  return min < 60 ? rtf.format(min, "minute") : min < 24 * 60 ? rtf.format(Math.round(min / 60), "hour")
    : new Intl.DateTimeFormat(currentLocale(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(ms);
}
// sidebar: the most constrained limit over every provider, for the Usage button's dot (in the reminders' urgency colours) and tooltip
export function usageSummary(): { pct: number; level: "" | "soon" | "late"; label: string } | null {
  let top: { w: LimitWindow; p: AgentProvider | undefined; id: string } | null = null;
  for (const l of usage.limits || []) if (l.limits.ok) for (const w of l.limits.windows)
    if (!top || w.pct > top.w.pct) top = { w, p: agent(l.provider), id: l.provider };
  if (!top) return null;
  const { w, p } = top, label = t("usage.limitTop", { name: p?.name ?? top.id, label: winText(p, w) }), pct = Math.round(w.pct), when = resetWhen(w.resets);
  return { pct: w.pct, level: level(w.pct), label: when ? t("usage.summaryResets", { label, pct, when }) : t("usage.summary", { label, pct }) };
}
export const num = (n: number) => new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const usd = (n: number) => new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
// the usage view names the conversations it lists and opens them on a click
export const usageSession = (k: string | undefined, sid: string) => {
  const c = k ? chat.chats[k] : undefined;
  if (c) return { label: `${pLabel(c.project)} › ${shownTitle(c.title)}`, key: c.key };
  const tm = terms().find(x => x.sid === sid);
  return tm ? { label: `${pLabel(tm.project)} › ${tm.title}`, key: tm.key } : null;
};
