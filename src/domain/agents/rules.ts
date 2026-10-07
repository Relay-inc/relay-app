import type { AgentEvent, AgentsStatus, Caps, PickKind, Seen } from "./types";

/** The last pick per provider; Claude's under the keys from before the providers. */
export const pickKey = (kind: PickKind, id: string) => (id === "claude" ? kind : `${kind}.${id}`);
/** What the rules read of a provider before `agents_status` has answered: what each of the built-in ones is known for. */
const KNOWN: Record<string, { caps: Pick<Caps, "picked" | "remote">; textOnly: string[] }> = {
  claude: { caps: { picked: true, remote: true }, textOnly: [] },
  codex: { caps: { picked: false, remote: false }, textOnly: ["compact", "review"] },
  pi: { caps: { picked: false, remote: false }, textOnly: ["compact"] },
};
export const knownCaps = (id: string) => KNOWN[id]?.caps;
export const knownTextOnly = (id: string) => KNOWN[id]?.textOnly ?? [];
// before the providers have answered, the composer offers Claude's models
const FALLBACK: Record<PickKind, { id: string; label: string }[]> = {
  model: [
    ["fable", "Fable"],
    ["opus", "Opus"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ].map(([id, label]) => ({ id, label })),
  effort: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra high"],
    ["max", "Max"],
  ].map(([id, label]) => ({ id, label })),
};
/** An agent's model or effort choices, and the one picked: a stale pick reads as the default (""). */
export function picksOf(status: AgentsStatus, id: string, kind: PickKind, wanted: string) {
  const own = status.providers.find(x => x.id === id);
  const list = own ? (kind === "model" ? own.models : own.efforts) : FALLBACK[kind];
  return { list, value: list.some(choice => choice.id === wanted) ? wanted : "", key: pickKey(kind, id) };
}
/** The defaults a `resolved` event names, added to what was seen before. */
export function seeDefaults(seen: Seen, e: Extract<AgentEvent, { type: "resolved" }>): Seen {
  const next = { ...seen };
  if (e.default_model) next.model = e.model;
  if (e.default_effort && e.effort) next.effort = { ...seen.effort, [e.model]: e.effort };
  return next;
}
/** The label of the choice a conversation without a pick inherits from the CLI, once one has shown it; the effort is
 *  the one seen for the picked model, else for the default model. */
export function inheritedOf(
  seen: Seen,
  kind: PickKind,
  pick: { model: string; list: { id: string; label: string }[] },
): string | undefined {
  const value = kind === "model" ? seen.model : seen.effort?.[pick.model || seen.model || ""];
  return value && (pick.list.find(choice => choice.id === value)?.label ?? value);
}
