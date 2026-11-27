import { t } from "../../shared/i18n";
import { PROVIDERS } from "../../shared/plugins";
import type { ActionEntry, ActionConfig } from "../../domain/settings/types";
import { policyCounts } from "../../domain/settings/actions";
import * as backend from "../../infrastructure/backend";
import { isBoardOn } from "./integrations";
import { useSettingsStore } from "./store";
import { go } from "./window";

// Agent access per extension: whether agents may use it through `relay` at all, and per action whether it runs, asks
// first or never runs. The backend reads and writes the vault's .relay/config.json itself (actions.rs).
const set = useSettingsStore.setState;

/** A plain "auto" in the file means every action: as an entry, that is `*`. */
const entryOf = (entry: ActionEntry | string | undefined): ActionEntry =>
  typeof entry === "string" ? { "*": entry } : { ...(entry || {}) };
const entriesOf = (config: ActionConfig["config"]) =>
  Object.fromEntries(Object.entries(config).map(([ext, entry]) => [ext, entryOf(entry)]));

/** Every action and the entries, read again whenever an extension's section shows. */
export async function loadActions() {
  try {
    const { actions, config } = await backend.actionConfig();
    set(draft => {
      draft.actions.list = actions;
      draft.actions.entries = entriesOf(config);
      delete draft.actions.errors[""];
    });
  } catch (error) {
    set(draft => {
      draft.actions.errors[""] = String(error);
    });
  }
}

/** One setting of an extension's entry. Default values stay out of the file: access on, a policy left to its
 *  default (""). */
export async function setAction(ext: string, key: string, value: string | boolean) {
  const next = { ...useSettingsStore.getState().actions.entries[ext], [key]: value };
  if (value === "" || (key === "access" && value === true)) delete next[key];
  try {
    const config = await backend.setActionConfig(ext, next);
    set(draft => {
      draft.actions.entries = entriesOf(config);
      delete draft.actions.errors[ext];
    });
  } catch (error) {
    set(draft => {
      draft.actions.errors[ext] = String(error);
    });
  }
}

/** A tool's row on Privacy & access folds open, or shut when it is the open one; one is open at a time. */
export const toggleTool = (ext: string) =>
  set(draft => {
    draft.actions.open = draft.actions.open === ext ? "" : ext;
  });
/** Privacy & access with `ext`'s row unfolded (from an integration's Agent access card). */
export function showAccess(ext: string) {
  set(draft => {
    draft.actions.open = ext;
  });
  go("access");
}

/** A tool that has actions for the agent: Reminders, Knowledge workspaces, Mail, Calendar and each board provider.
 *  `connected`: in use (Reminders and Knowledge always are), so its policies can be set. */
export type AccessTool = { ext: string; name: string; connected: boolean };
export function accessTools(): AccessTool[] {
  const { actions, settings } = useSettingsStore.getState();
  const known = new Set(actions.list.map(action => action.ext));
  const all: AccessTool[] = [
    { ext: "reminders", name: t("act.reminders"), connected: true },
    { ext: "knowledge", name: t("act.knowledge"), connected: true },
    { ext: "mail", name: "Mail", connected: !!settings.mail?.on },
    { ext: "calendar", name: t("cal.name"), connected: !!settings.calendar?.on },
    ...PROVIDERS.map(provider => ({ ext: provider.id, name: provider.name, connected: isBoardOn(provider) })),
  ];
  return all.filter(tool => known.has(tool.ext));
}

const SUMMARY = { auto: "act.sumAuto", ask: "act.sumAsk", deny: "act.sumDeny" } as const;
/** "3 run · 1 ask first · 1 never" for a tool, "Off" while agents may not use it, "" before the actions are read. */
export function accessSummary(ext: string): string {
  const { actions } = useSettingsStore.getState();
  const own = actions.list.filter(action => action.ext === ext);
  if (!own.length) return "";
  const entry = actions.entries[ext];
  if (entry?.access === false) return t("act.sumOff");
  const counts = policyCounts(own, entry);
  return (["auto", "ask", "deny"] as const)
    .filter(policy => counts[policy])
    .map(policy => t(SUMMARY[policy], { n: counts[policy] }))
    .join(" · ");
}
