// Collections: a saved query over the notes' frontmatter, shown as a table or a board. The rows are the index's
// (related.rs `collection`: every note with its keys' values); this is the query on them. Nothing is written here: an
// edit goes through the note's own frontmatter (domain/workspace/properties.ts).
import { noteName } from "../navigation/pages.ts";
import { isoDate } from "../reminders/rules.ts";

/** A note as the index lists it: where it is, its title and `type:` ("" without one), the file's mtime (seconds), the
 *  `date:` (or the date its name starts with), the stage of a meeting (derived from its text), and every frontmatter
 *  key with its values (a link by the name it links to). */
export type Row = {
  p: string;
  t: string;
  k: string;
  at: number;
  date: string;
  stage: "" | "planned" | "briefed" | "wrapped";
  props: Record<string, string[]>;
};

export type CollectionId = "meetings" | "documents" | "people" | "projects" | "threads";
export const COLLECTIONS: CollectionId[] = ["meetings", "documents", "people", "projects", "threads"];

/** How a column draws its cells: the note's title (opens it), a date, a meeting's stage, links as chips, people as
 *  chips with initials, a status as a pill, plain text, or the file's mtime. */
export type ColumnKind = "followed" | "title" | "date" | "stage" | "links" | "people" | "status" | "text" | "time";
export type Column = { key: string; kind: ColumnKind };
export type Sort = { key: string; dir: "asc" | "desc" };
type Def = {
  /** the `type:` values it lists (lower case); "rest" is every typed note the others do not take */
  kinds: string[] | "rest";
  columns: Column[];
  sort: Sort;
  /** the key a board groups by until one is picked */
  board: string;
  /** keys whose value is worked out from the note, not stored: shown, never written */
  derived: string[];
};
const col = (key: string, kind: ColumnKind): Column => ({ key, kind });
export const DEFS: Record<CollectionId, Def> = {
  meetings: {
    kinds: ["meeting"],
    columns: [
      col("date", "date"),
      col("title", "title"),
      col("stage", "stage"),
      col("about", "links"),
      col("with", "people"),
      col("language", "text"),
      col("followed-up", "followed"),
    ],
    sort: { key: "date", dir: "desc" },
    board: "stage",
    derived: ["stage", "followed-up"],
  },
  documents: {
    kinds: "rest",
    columns: [
      col("title", "title"),
      col("type", "text"),
      col("about", "links"),
      col("status", "status"),
      col("updated", "time"),
    ],
    sort: { key: "updated", dir: "desc" },
    board: "status",
    derived: ["type", "updated"],
  },
  people: {
    kinds: ["person"],
    columns: [col("title", "title"), col("role", "text"), col("context", "links"), col("about", "links")],
    sort: { key: "title", dir: "asc" },
    board: "role",
    derived: [],
  },
  projects: {
    kinds: ["project", "product", "platform", "initiative", "feature"],
    columns: [
      col("title", "title"),
      col("type", "text"),
      col("status", "status"),
      col("context", "links"),
      col("updated", "time"),
    ],
    sort: { key: "title", dir: "asc" },
    board: "status",
    derived: ["type", "updated"],
  },
  threads: {
    kinds: ["thread"],
    columns: [
      col("date", "date"),
      col("title", "title"),
      col("about", "links"),
      col("with", "people"),
      col("status", "status"),
    ],
    sort: { key: "date", dir: "desc" },
    board: "status",
    derived: [],
  },
};
const TAKEN = new Set(Object.values(DEFS).flatMap(def => (def.kinds === "rest" ? [] : def.kinds)));
/** The stages a meeting board has lanes for, in the order of a meeting's life. */
export const STAGES = ["planned", "briefed", "wrapped"];
/** The values `status:` is offered with before the notes teach others. */
const STATUSES = ["Active", "Blocked", "Quiet", "Paused"];

/** One condition: a key is a value (any of its values), or a date key within a range (ISO dates, either end open). */
export type Filter = { key: string; is?: string; from?: string; to?: string; outside?: string; apart?: boolean };
/** The filter "Show all" opens a group of the Pages tree with: the group's own rule (domain/workspace/linked.ts) as one
 *  condition. A note is in when its `about:` or `context:` names `is`, outside the folder `outside` (whose notes the tree
 *  shows already) and not that note itself (`apart`: a context's group Projects is its own, so Documents has none of
 *  them); a person is also in when a note that is in names them in `with:`. */
export const LINKED = "linked";
/** Whether a collection can be shown as a calendar: it has a date column. */
export const hasCalendar = (collection: CollectionId) => DEFS[collection].columns.some(c => c.kind === "date");
/** A collection as it is shown: which, in which context (""= any), table, board or calendar, what narrows and orders
 *  it. */
export type View = {
  collection: CollectionId;
  context: string;
  layout: "table" | "board" | "calendar";
  filters: Filter[];
  sort: Sort | null;
  group: string;
};
export const newView = (collection: CollectionId, context = "", filters: Filter[] = []): View => ({
  collection,
  context,
  layout: "table",
  filters,
  sort: null,
  group: "",
});
export type SavedView = { name: string; view: View };

const same = (a: string, b: string) => noteName(a).trim().toLowerCase() === noteName(b).trim().toLowerCase();

/** The values a row has for a key. Derived keys come from the note's text or the file, the rest from the frontmatter;
 *  `date` falls back to what the file name starts with, `title` is the note's name. */
export function valuesOf(row: Row, key: string): string[] {
  if (key === "title") return [row.t];
  if (key === "type") return row.k ? [row.k] : [];
  if (key === "updated") return [new Date(row.at * 1000).toISOString().slice(0, 10)];
  if (key === "stage" && row.stage) return [row.stage];
  if (key === LINKED) return [...(row.props.about ?? []), ...(row.props.context ?? [])];
  if (key === "date") return row.props.date ?? (row.date ? [row.date] : []);
  return row.props[key] ?? [];
}
/** A key whose value the collection works out itself: its cells and cards do not edit or move. */
export const isDerived = (collection: CollectionId, key: string) => DEFS[collection].derived.includes(key);

/** The kind a column of `key` has in this collection (a key it does not list is plain text). */
export const columnOf = (collection: CollectionId, key: string): Column =>
  DEFS[collection].columns.find(c => c.key === key) ?? col(key, key === "date" ? "date" : "text");

/** Whether a row belongs to a collection by its `type:`. */
export function inCollection(row: Row, collection: CollectionId, grouped = false, apart = false) {
  const kinds = DEFS[collection].kinds;
  const kind = row.k.toLowerCase();
  // a tree group's documents are every note that is no meeting, thread or person (an untyped one too)
  if (grouped && collection === "documents")
    return apart ? !TAKEN.has(kind) : !["meeting", "thread", "person"].includes(kind);
  return kinds === "rest" ? !!kind && !TAKEN.has(kind) : kinds.includes(kind);
}
const matches = (row: Row, f: Filter) => {
  const values = valuesOf(row, f.key);
  if (f.is !== undefined) return values.some(v => same(v, f.is!));
  return values.some(v => (!f.from || v >= f.from) && (!f.to || v <= f.to));
};

function linkedTest(rows: Row[], f: Filter, collection: CollectionId) {
  const name = f.is ?? "";
  const out = (row: Row) => (f.outside && row.p.startsWith(`${f.outside}/`)) || same(row.t, name);
  const points = (row: Row) => !out(row) && valuesOf(row, LINKED).some(v => same(v, name));
  const named = new Set(
    rows.filter(points).flatMap(row => (row.props.with ?? []).map(v => noteName(v).trim().toLowerCase())),
  );
  return (row: Row) => points(row) || (collection === "people" && !out(row) && named.has(row.t.trim().toLowerCase()));
}

/** The rows of a collection in a context (its `context:` names it; "" for any), the base the filters narrow. */
export const scoped = (rows: Row[], view: Pick<View, "collection" | "context"> & { filters?: Filter[] }) =>
  rows.filter(
    row =>
      inCollection(
        row,
        view.collection,
        !!view.filters?.some(f => f.key === LINKED),
        !!view.filters?.some(f => f.key === LINKED && f.apart),
      ) &&
      (!view.context || (row.props.context ?? []).some(c => same(c, view.context))),
  );

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
/** What a view lists: its scope, then every filter, ordered by its sort (the collection's own until one is picked). A row
 *  without a value for the sort key goes last, whichever way it runs. */
export function evaluate(rows: Row[], view: View): Row[] {
  const sort = view.sort ?? DEFS[view.collection].sort;
  const test = view.filters.map(f =>
    f.key === LINKED ? linkedTest(rows, f, view.collection) : (row: Row) => matches(row, f),
  );
  const kept = scoped(rows, view).filter(row => test.every(f => f(row)));
  const first = (row: Row) => valuesOf(row, sort.key)[0] ?? "";
  return kept.sort((a, b) => {
    const [x, y] = [first(a), first(b)];
    if (!x !== !y) return x ? -1 : 1;
    const order = sort.key === "updated" ? a.at - b.at : compare(x, y);
    return (sort.dir === "asc" ? order : -order) || compare(a.t, b.t);
  });
}

/** The key a board groups by: the picked one, else the collection's own. */
export const boardKey = (view: View) => view.group || DEFS[view.collection].board;

/** Today as the local date (yyyy-mm-dd), what a collection's "today" is: at 00:30 in Brussels it is already today, while
 *  UTC is still on yesterday. */
export const localToday = (now = new Date()) => isoDate(now.getFullYear(), now.getMonth(), now.getDate());

/** A meeting's stage as the board sorts it: one that is over (its date before `today`) and not wrapped is "unwrapped". */
export const stageOf = (row: Row, today = localToday()): string =>
  row.stage && row.stage !== "wrapped" && row.date && row.date < today ? "unwrapped" : row.stage;

export type Lane = { value: string; rows: Row[] };
/** A board's lanes: the values the key has, a row with several in each of them, one lane for the rows with none last.
 *  A meeting's stage has its three lanes always; a status has the usual four before the notes' own. */
export function lanes(rows: Row[], key: string, collection: CollectionId, today = ""): Lane[] {
  const seen = new Map<string, Row[]>();
  const stage = key === "stage" && collection === "meetings";
  if (stage) for (const s of STAGES) seen.set(s, []);
  if (key === "status") for (const s of STATUSES) seen.set(s, []);
  const none: Row[] = [];
  for (const row of rows) {
    const values = stage && today ? [stageOf(row, today)].filter(Boolean) : valuesOf(row, key);
    if (!values.length) none.push(row);
    for (const value of values) {
      const lane = [...seen.keys()].find(v => same(v, value)) ?? value;
      seen.set(lane, [...(seen.get(lane) ?? []), row]);
    }
  }
  const out = [...seen].map(([value, rows]) => ({ value, rows })).filter(l => l.value !== "unwrapped" || l.rows.length);
  return none.length || !out.length ? [...out, { value: "", rows: none }] : out;
}

/** Table rows under group headers when a key is picked: [{group, rows}], one group "" without one. */
export function grouped(rows: Row[], key: string, collection: CollectionId, today = ""): Lane[] {
  if (!key) return [{ value: "", rows }];
  return lanes(rows, key, collection, today).filter(l => l.rows.length);
}

/** The folder most of a list's notes share ("Calendar/Meetings/"), "" when they share none. */
export function commonFolder(rows: Row[]) {
  if (!rows.length) return "";
  const dirs = rows.map(r => r.p.split("/").slice(0, -1));
  const first = dirs[0];
  let n = 0;
  while (n < first.length && dirs.every(d => d[n] === first[n])) n++;
  return n ? `${first.slice(0, n).join("/")}/` : "";
}

/** A view's `.relay/views` file keeps only what a view is; a file somebody edited by hand is read back as far as it fits. */
export function readView(value: unknown): View | null {
  const v = value as Partial<View> | null;
  if (!v || typeof v !== "object" || !COLLECTIONS.includes(v.collection as CollectionId)) return null;
  const filters = Array.isArray(v.filters)
    ? v.filters.filter(f => f && typeof f.key === "string").map(f => ({ ...f }))
    : [];
  const sort =
    v.sort && typeof v.sort.key === "string" ? { key: v.sort.key, dir: v.sort.dir === "asc" ? "asc" : "desc" } : null;
  return {
    collection: v.collection as CollectionId,
    context: typeof v.context === "string" ? v.context : "",
    layout:
      v.layout === "board" || (v.layout === "calendar" && hasCalendar(v.collection as CollectionId))
        ? v.layout
        : "table",
    filters,
    sort: sort as Sort | null,
    group: typeof v.group === "string" ? v.group : "",
  };
}

/** A date range that is "this quarter", "this month" or "last 30 days" from `today` (ISO), as a filter on `key`. */
export function range(key: string, preset: "month" | "quarter" | "days30", today: string): Filter {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = (yy: number, mm: number) => `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  if (preset === "month") return { key, from: `${y}-${pad(m)}-01`, to: end(y, m) };
  if (preset === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { key, from: `${y}-${pad(q)}-01`, to: end(y, q + 2) };
  }
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  return { key, from, to: today };
}

/** The names a links cell offers: the notes of the type the key points at (`about` the projects, `context` the contexts,
 *  `with` the people) and what the rows already name under it, sorted. */
export function linkOptions(rows: Row[], key: string): string[] {
  const kinds = key === "with" ? ["person"] : key === "context" ? ["context"] : DEFS.projects.kinds;
  const names = new Map<string, string>();
  const add = (name: string) => names.has(name.toLowerCase()) || names.set(name.toLowerCase(), name);
  for (const row of rows) if (kinds !== "rest" && kinds.includes(row.k.toLowerCase())) add(row.t);
  for (const row of rows) for (const value of row.props[key] ?? []) add(value);
  return [...names.values()].sort(compare);
}
