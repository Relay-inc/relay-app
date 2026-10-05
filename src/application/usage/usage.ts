import { t, at, currentLocale } from "../../shared/i18n";
import { dateFormat, numberFormat, relativeFormat } from "../../shared/format";
import { agent } from "../../shared/plugins";
import type { AgentProvider, LimitWindow } from "../../domain/agents/types";
import { USAGE } from "../../domain/navigation/views";
import { level, mostConstrained, periodStarts } from "../../domain/usage/rules";
import * as backend from "../../infrastructure/backend";
import { useNavigationStore } from "../navigation/store";
import { useConversationsStore } from "../conversations/store";
import { displayTitle, terminalSessions } from "../conversations/selectors";
import { projectLabel } from "../workspace/vault";
import { useUsageStore } from "./store";

// Usage: plan limits every 5 minutes (the sidebar shows the tightest), tokens every minute while the view is open:
// each provider only reads what its logs gained since the last time.
const us = () => useUsageStore.getState();
const set = useUsageStore.setState;
const visible = () => useNavigationStore.getState().selected === USAGE;

async function loadLimits() {
  const limits = await backend.usageLimits().catch(() => []);
  set(draft => {
    draft.limits = limits;
  });
}
async function loadTokens() {
  if (us().reading) return;
  set(draft => {
    draft.reading = true;
  });
  try {
    const tokens = await backend.usageTokens(periodStarts(new Date()));
    set(draft => {
      draft.tokens = tokens;
      draft.tokensError = "";
    });
  } catch (e) {
    set(draft => {
      draft.tokensError = String(e);
    });
  }
  set(draft => {
    draft.tokensAt = Date.now();
    draft.reading = false;
  });
}
/** Started once at boot. */
export function startUsage() {
  loadLimits();
  setInterval(loadLimits, 5 * 60000);
  setInterval(() => {
    if (visible()) loadTokens();
  }, 60000);
}
/** On opening the view: tokens right away when the last read is older than a minute. */
export function openUsage() {
  if (Date.now() - us().tokensAt > 60000) loadTokens();
}
/** The bar's refresh button: limits and tokens now. */
export function refreshUsage() {
  loadLimits();
  loadTokens();
}
/** After the agents changed in the settings: limits and tokens for the new set. */
export function reloadUsage() {
  loadLimits();
  if (visible()) loadTokens();
  else
    set(draft => {
      draft.tokensAt = 0;
    });
}

const winText = (provider: AgentProvider | undefined, limitWindow: LimitWindow) =>
  provider ? at(provider, limitWindow.label, { name: limitWindow.name ?? "" }) : limitWindow.label;
/** When a limit resets: in minutes or hours, else the weekday and time. A component passes its `locale`, so a
 *  language switch formats again (the same for num and usd). */
export function resetWhen(iso: string | null, locale = currentLocale()) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (isNaN(ms)) return "";
  const minutes = Math.max(1, Math.round((ms - Date.now()) / 60000));
  const relative = relativeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return relative.format(minutes, "minute");
  if (minutes < 24 * 60) return relative.format(Math.round(minutes / 60), "hour");
  return dateFormat(locale, { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(ms);
}
/** The sidebar's Usage button: the most constrained limit over every provider, for its dot (in the reminders'
 *  urgency colours) and tooltip. */
export function usageSummary(): { pct: number; level: "" | "soon" | "late"; label: string } | null {
  const top = mostConstrained(us().limits);
  if (!top) return null;
  const { limitWindow } = top;
  const provider = agent(top.id);
  const label = t("usage.limitTop", { name: provider?.name ?? top.id, label: winText(provider, limitWindow) });
  const pct = Math.round(limitWindow.pct);
  const when = resetWhen(limitWindow.resets);
  return {
    pct: limitWindow.pct,
    level: level(limitWindow.pct),
    label: when ? t("usage.summaryResets", { label, pct, when }) : t("usage.summary", { label, pct }),
  };
}
export const num = (count: number, locale = currentLocale()) =>
  numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(count);
export const usd = (amount: number, locale = currentLocale()) =>
  numberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 10 ? 2 : 0,
  }).format(amount);
/** The usage view names the conversations it lists and opens them on a click. */
export const usageSession = (chatKey: string | undefined, sessionId: string) => {
  const conversation = chatKey ? useConversationsStore.getState().chats[chatKey] : undefined;
  if (conversation)
    return {
      label: `${projectLabel(conversation.project)} › ${displayTitle(conversation.title)}`,
      key: conversation.key,
    };
  const session = terminalSessions().find(x => x.sid === sessionId);
  return session ? { label: `${projectLabel(session.project)} › ${session.title}`, key: session.key } : null;
};
