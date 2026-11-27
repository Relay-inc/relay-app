import type { ActionEntry, ActionMeta, Policy } from "./types";

/** What an action does for the user's choices: its own policy, the extension's `*`, else the action's default (the
 *  backend's `policy` in actions.rs). */
export const policyOf = (action: ActionMeta, entry: ActionEntry | undefined): Policy => {
  const pick = (value: unknown) => (value === "auto" || value === "ask" || value === "deny" ? value : undefined);
  return pick(entry?.[action.id]) ?? pick(entry?.["*"]) ?? action.default;
};

/** How many of an extension's actions run, ask first and never run ("3 run · 1 asks first · 1 never"). */
export const policyCounts = (actions: ActionMeta[], entry: ActionEntry | undefined): Record<Policy, number> => {
  const counts: Record<Policy, number> = { auto: 0, ask: 0, deny: 0 };
  for (const action of actions) counts[policyOf(action, entry)]++;
  return counts;
};
