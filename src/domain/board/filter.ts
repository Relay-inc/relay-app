import type { Card, State } from "./types";

// Which cards a board shows: the search text and the facet filters (several values of one facet are alternatives,
// different facets all have to hold). Pure, so it runs in plain Node (filter.test.ts).

export const NOBODY = "\u0001"; // the assignee facet's "unassigned"
export const NO_LABEL = "\u0002"; // the labels facet's "no labels"
export const FACETS = ["state", "status", "who", "folder", "list", "label"] as const;
export type Facet = (typeof FACETS)[number];
export type Filters = Partial<Record<Facet, string[]>>;
export type Preset = { name: string; filters: Filters };

/** The values a card has in a facet: no value at all is a value for assignee and labels, so "unassigned" can be asked for. */
function valuesOf(card: Card, facet: Facet): string[] {
  switch (facet) {
    case "state":
      return card.state ? [card.state] : [];
    case "status":
      return card.status ? [card.status] : [];
    case "who":
      return [card.who || NOBODY];
    case "folder":
      return card.folder ? [card.folder] : [];
    case "list":
      return card.list ? [card.list] : [];
    case "label":
      return card.labels?.length ? card.labels : [NO_LABEL];
  }
}

/** The facets a board offers: those at least one of its cards has a value in. */
export const facetsOf = (cards: Card[]) =>
  FACETS.filter(facet => cards.some(card => valuesOf(card, facet).some(v => v !== NOBODY && v !== NO_LABEL)));

export const matchesQuery = (card: Card, q: string) =>
  !q || `${card.title} ${card.number}`.toLowerCase().includes(q.toLowerCase());
const matchesFacet = (card: Card, facet: Facet, filters: Filters) =>
  !filters[facet]?.length || valuesOf(card, facet).some(v => filters[facet]!.includes(v));

/** Whether the card passes the search and the filters; `skip` leaves one facet out (to count its options). */
export const matches = (card: Card, q: string, filters: Filters, skip?: Facet) =>
  matchesQuery(card, q) && FACETS.every(facet => facet === skip || matchesFacet(card, facet, filters));

/** The options of a facet with how many cards each would show, given the search and the other facets. */
export function options(cards: Card[], q: string, filters: Filters, facet: Facet) {
  const counts = new Map<string, number>();
  for (const card of cards)
    if (matches(card, q, filters, facet))
      for (const v of new Set(valuesOf(card, facet))) counts.set(v, (counts.get(v) ?? 0) + 1);
  // a value chosen that no card has any more stays listed, so it can be switched off
  for (const v of filters[facet] ?? []) if (!counts.has(v)) counts.set(v, 0);
  const rank = (v: string) => (v === NOBODY || v === NO_LABEL ? 1 : 0);
  return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

/** Drop the empty facets, and the values that are not on the board (a filter on someone no longer there would hide every card). */
export function tidy(filters: Filters, cards: Card[]): Filters {
  const out: Filters = {};
  for (const facet of FACETS) {
    const have = new Set(cards.flatMap(card => valuesOf(card, facet)));
    const kept = (filters[facet] ?? []).filter(v => have.has(v));
    if (kept.length) out[facet] = kept;
  }
  return out;
}

export const activeCount = (filters: Filters) => FACETS.filter(facet => filters[facet]?.length).length;
const norm = (filters: Filters) => JSON.stringify(FACETS.map(facet => [...(filters[facet] ?? [])].sort()));
export const sameFilters = (a: Filters, b: Filters) => norm(a) === norm(b);

/** Presets from storage: anything that is not a name with filters is dropped. */
export function parsePresets(raw: string | null): Preset[] {
  try {
    const list: unknown = JSON.parse(raw || "[]");
    return (Array.isArray(list) ? list : []).flatMap((p: { name?: unknown; filters?: unknown } | null) =>
      typeof p?.name === "string" && p.name && p.filters && typeof p.filters === "object"
        ? [{ name: p.name, filters: cleanFilters(p.filters as Record<string, unknown>) }]
        : [],
    );
  } catch {
    return [];
  }
}
const cleanFilters = (raw: Record<string, unknown>): Filters =>
  Object.fromEntries(
    FACETS.flatMap(facet => {
      const v = raw[facet];
      const values = Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
      return values.length ? [[facet, values]] : [];
    }),
  );

/** Save under a name: the same name replaces. */
export const savePreset = (presets: Preset[], name: string, filters: Filters): Preset[] => [
  ...presets.filter(p => p.name !== name),
  { name, filters: cleanFilters(filters as Record<string, unknown>) },
];

export const STATES: State[] = ["todo", "doing", "done"];
