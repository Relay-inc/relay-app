import { invoke } from "@tauri-apps/api/core";
import { t, at, currentLocale } from "../core/i18n";
import { changed } from "../core/store";
import { agent, type AgentProvider, type Limits, type LimitWindow, type Tally, type Tokens } from "./agents";
import { ui, USAGE } from "./ui";
import { chat, displayTitle, terminalSessions } from "./chats/state";
import { projectLabel } from "./vault";

// Usage per switched-on agent provider: its plan or rate limits (the backend asks each provider, at most once a
// minute) and the tokens in its local logs, today and this week, then the total over all of them. Limits every
// 5 minutes, for the sidebar too. Tokens every minute while the view is open: each provider only reads what its
// logs gained since the last time.
export type ProvLimits = { provider: string; limits: Limits };
export type AllTokens = { providers: (Tokens & { provider: string })[]; today: Tally; week: Tally };

export const usage = {
  limits: null as ProvLimits[] | null,
  tokens: null as AllTokens | null,
  tokErr: "",
  tokAt: 0,
  reading: false,
};
const visible = () => ui.selected === USAGE;

async function loadLimits() {
  try {
    usage.limits = await invoke<ProvLimits[]>("usage_limits");
  } catch {
    usage.limits = [];
  }
  changed();
}
const DAY = 86400000;
// the start of today and of this week, which starts on Monday
function periodStarts() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  return { today, week: today - ((midnight.getDay() + 6) % 7) * DAY };
}
async function loadTokens() {
  if (usage.reading) return;
  usage.reading = true;
  try {
    usage.tokens = await invoke<AllTokens>("usage_tokens", periodStarts());
    usage.tokErr = "";
  } catch (e) {
    usage.tokErr = String(e);
  }
  usage.tokAt = Date.now();
  usage.reading = false;
  changed();
}
export function startUsage() {
  loadLimits();
  setInterval(loadLimits, 5 * 60000);
  setInterval(() => {
    if (visible()) loadTokens();
  }, 60000);
}
// on opening the view: tokens right away when the last read is older than a minute
export function openUsage() {
  if (Date.now() - usage.tokAt > 60000) loadTokens();
}
// after the agents changed in the settings: limits and tokens for the new set
export function reloadUsage() {
  loadLimits();
  if (visible()) loadTokens();
  else usage.tokAt = 0;
}

export const level = (pct: number): "" | "soon" | "late" => {
  if (pct >= 95) return "late";
  return pct >= 80 ? "soon" : "";
};
export const winText = (provider: AgentProvider | undefined, limitWindow: LimitWindow) =>
  provider ? at(provider, limitWindow.label, { name: limitWindow.name ?? "" }) : limitWindow.label;
export function resetWhen(iso: string | null) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (isNaN(ms)) return "";
  const minutes = Math.max(1, Math.round((ms - Date.now()) / 60000));
  const relative = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
  if (minutes < 60) return relative.format(minutes, "minute");
  if (minutes < 24 * 60) return relative.format(Math.round(minutes / 60), "hour");
  return new Intl.DateTimeFormat(currentLocale(), { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(ms);
}
type TopLimit = { limitWindow: LimitWindow; provider: AgentProvider | undefined; id: string };
// the limitWindow closest to its limit, over every provider that answered
function mostConstrained(): TopLimit | null {
  let top: TopLimit | null = null;
  for (const entry of usage.limits || [])
    if (entry.limits.ok)
      for (const limitWindow of entry.limits.windows)
        if (!top || limitWindow.pct > top.limitWindow.pct)
          top = { limitWindow, provider: agent(entry.provider), id: entry.provider };
  return top;
}
// sidebar: the most constrained limit over every provider, for the Usage button's dot (in the reminders' urgency colours) and tooltip
export function usageSummary(): { pct: number; level: "" | "soon" | "late"; label: string } | null {
  const top = mostConstrained();
  if (!top) return null;
  const { limitWindow, provider } = top;
  const label = t("usage.limitTop", { name: provider?.name ?? top.id, label: winText(provider, limitWindow) });
  const pct = Math.round(limitWindow.pct);
  const when = resetWhen(limitWindow.resets);
  return {
    pct: limitWindow.pct,
    level: level(limitWindow.pct),
    label: when ? t("usage.summaryResets", { label, pct, when }) : t("usage.summary", { label, pct }),
  };
}
export const num = (count: number) =>
  new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(count);
export const usd = (amount: number) =>
  new Intl.NumberFormat(currentLocale(), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 10 ? 2 : 0,
  }).format(amount);
// the usage view names the conversations it lists and opens them on a click
export const usageSession = (chatKey: string | undefined, sessionId: string) => {
  const conversation = chatKey ? chat.chats[chatKey] : undefined;
  if (conversation)
    return {
      label: `${projectLabel(conversation.project)} › ${displayTitle(conversation.title)}`,
      key: conversation.key,
    };
  const session = terminalSessions().find(x => x.sid === sessionId);
  return session ? { label: `${projectLabel(session.project)} › ${session.title}`, key: session.key } : null;
};
