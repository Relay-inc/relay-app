import type { AgentsStatus, PickKind } from "./types";

/** The last pick per provider; Claude's under the keys from before the providers. */
export const pickKey = (kind: PickKind, id: string) => (id === "claude" ? kind : `${kind}.${id}`);
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
