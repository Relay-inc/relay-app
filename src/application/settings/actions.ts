import type { ActionEntry, ActionConfig } from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { useSettingsStore } from "./store";

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
