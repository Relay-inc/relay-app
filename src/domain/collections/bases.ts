// Views inside a page are Obsidian Bases (issue 421): a `.base` file embedded as `![[x.base]]` or a fenced `base` block,
// so Obsidian shows the same view. Relay reads a subset of the syntax (obsidian.md/help/bases/syntax) and draws it from
// the collections' rows; whatever falls outside the subset is `unsupported` (the page shows "Open in Obsidian"), never
// a wrong result. Pure: text in, rows out. The block's text is never rewritten here.
import { parse } from "yaml";
import { noteName } from "../navigation/pages.ts";
import type { Row } from "./rules.ts";

/** A filter as written: a statement, or `and`/`or`/`not` over a list of filters. */
export type BaseFilter = string | { and: BaseFilter[] } | { or: BaseFilter[] } | { not: BaseFilter[] };
type Direction = "ASC" | "DESC";
export type BaseView = {
  type: string;
  name: string;
  filters?: BaseFilter;
  order: string[];
  sort: { property: string; direction: Direction }[];
  groupBy?: { property: string; direction: Direction };
  limit?: number;
};
export type Base = { filters?: BaseFilter; views: BaseView[]; names: Record<string, string> };
/** A base Relay can draw, or why it can't. */
export type Read = { base: Base } | { unsupported: string };

// ---- statements: a comparison or one of the functions of the subset ---------------------------------------------------

type Operand =
  | { t: "lit"; v: string; num: boolean }
  | { t: "this"; field: string } // `this` (the page as a link), `this.file.<x>`, `this.<property>`
  | { t: "link"; name: string } // link("Name")
  | { t: "file"; field: string } // file.name, file.path, …; "file" for the file itself
  | { t: "prop"; key: string };
type Statement =
  | { t: "cmp"; op: string; a: Operand; b: Operand; neg: boolean }
  | { t: "call"; fn: "inFolder" | "hasLink" | "hasTag" | "contains"; on?: Operand; args: Operand[]; neg: boolean };

const FILE_FIELDS = ["name", "basename", "path", "folder", "ext"];
const TOKEN =
  /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(-?\d+(?:\.\d+)?)|(==|!=|>=|<=|[<>!(),])|([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*))/y;

/** One statement of a filter, or an Error naming what is outside the subset. */
export function parseStatement(text: string): Statement {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  const src = text.trim();
  while (TOKEN.lastIndex < src.length) {
    const m = TOKEN.exec(src);
    if (!m) throw new Error(text);
    tokens.push(m[0].trim());
  }
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(text);
  };
  const args = () => {
    expect("(");
    const out: Operand[] = [];
    while (peek() !== ")") {
      out.push(operand());
      if (peek() === ",") next();
      else if (peek() !== ")") throw new Error(text);
    }
    next();
    return out;
  };
  const operand = (): Operand => {
    const tok = next();
    if (tok === undefined) throw new Error(text);
    if (/^["']/.test(tok)) return { t: "lit", v: tok.slice(1, -1).replace(/\\(.)/g, "$1"), num: false };
    if (/^-?\d/.test(tok)) return { t: "lit", v: tok, num: true };
    if (tok === "true" || tok === "false") return { t: "lit", v: tok, num: false };
    if (tok === "link" && peek() === "(") {
      const [arg] = args();
      if (arg?.t !== "lit") throw new Error(text);
      return { t: "link", name: arg.v };
    }
    if (tok === "this") return { t: "this", field: "" };
    if (tok === "this.file") return { t: "this", field: "file" };
    if (tok.startsWith("this.file.") && FILE_FIELDS.includes(tok.slice(10))) return { t: "this", field: tok.slice(5) };
    if (/^this\.(note\.)?[\w-]+$/.test(tok)) return { t: "this", field: tok.replace(/^this\.(note\.)?/, "") };
    if (tok === "file" || tok === "file.file") return { t: "file", field: "file" };
    if (tok.startsWith("file.") && FILE_FIELDS.includes(tok.slice(5))) return { t: "file", field: tok.slice(5) };
    if (/^(note\.)?[\w-]+$/.test(tok) && peek() !== "(") return { t: "prop", key: tok.replace(/^note\./, "") };
    throw new Error(text);
  };
  let neg = false;
  if (peek() === "!") {
    next();
    neg = true;
  }
  let out: Statement;
  const head = peek() ?? "";
  const call = /^(?:file\.(inFolder|hasLink|hasTag)|((?:note\.)?[\w-]+)\.contains)$/.exec(head);
  if (call && tokens[i + 1] === "(") {
    next();
    const fn = (call[1] ?? "contains") as "inFolder" | "hasLink" | "hasTag" | "contains";
    out = {
      t: "call",
      fn,
      on: call[2] ? { t: "prop", key: call[2].replace(/^note\./, "") } : undefined,
      args: args(),
      neg,
    };
    if (!out.args.length) throw new Error(text);
  } else {
    if (neg) throw new Error(text); // `!prop`: truthiness is outside the subset
    const a = operand();
    const op = next();
    if (!op || !["==", "!=", ">", "<", ">=", "<="].includes(op)) throw new Error(text);
    out = { t: "cmp", op, a, b: operand(), neg: false };
  }
  if (i !== tokens.length) throw new Error(text);
  return out;
}

// ---- the file --------------------------------------------------------------------------------------------------------

const COLUMN = new RegExp(`^(?:file\\.(?:${[...FILE_FIELDS, "mtime"].join("|")})|(?:note\\.)?[\\w-]+)$`);
const asList = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]);

function readFilter(v: unknown, statements: string[]): BaseFilter {
  if (typeof v === "string") {
    statements.push(v);
    return v;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v);
    const key = keys[0] as "and" | "or" | "not";
    if (keys.length === 1 && ["and", "or", "not"].includes(key)) {
      const list = asList((v as Record<string, unknown>)[key]).map(x => readFilter(x, statements));
      return { [key]: list } as BaseFilter;
    }
  }
  throw new Error(JSON.stringify(v));
}
const direction = (v: unknown): Direction => (String(v).toUpperCase() === "DESC" ? "DESC" : "ASC");
const propertyOf = (v: unknown) => {
  const p = (v as { property?: unknown } | null)?.property;
  if (typeof p !== "string" || !COLUMN.test(p)) throw new Error(String(p));
  return p;
};

/** A base's text read as far as Relay draws it: its global filters, its views (table only), the display names. Anything
 *  else it uses (formulas, summaries, other view types, functions outside the subset) makes it `unsupported`. */
export function readBase(text: string): Read {
  let doc: Record<string, unknown>;
  try {
    doc = (parse(text) ?? {}) as Record<string, unknown>;
    if (typeof doc !== "object" || Array.isArray(doc)) return { unsupported: "not a base" };
  } catch {
    return { unsupported: "not valid YAML" };
  }
  for (const key of Object.keys(doc))
    if (!["filters", "views", "properties"].includes(key)) return { unsupported: key };
  const statements: string[] = [];
  try {
    const filters = doc.filters == null ? undefined : readFilter(doc.filters, statements);
    const names: Record<string, string> = {};
    for (const [id, conf] of Object.entries((doc.properties ?? {}) as Record<string, { displayName?: unknown }>))
      if (typeof conf?.displayName === "string") names[id] = conf.displayName;
    const views = asList(doc.views).map((raw, n): BaseView => {
      const v = raw as Record<string, unknown>;
      if (v.type !== "table") throw new Error(`view type ${String(v.type)}`);
      for (const key of Object.keys(v))
        if (!["type", "name", "filters", "order", "sort", "groupBy", "limit"].includes(key)) throw new Error(key);
      const order = asList(v.order).map(String);
      const bad = order.find(id => !COLUMN.test(id));
      if (bad) throw new Error(bad);
      const limit = Number(v.limit);
      return {
        type: "table",
        name: typeof v.name === "string" ? v.name : `View ${n + 1}`,
        filters: v.filters == null ? undefined : readFilter(v.filters, statements),
        order: order.length ? order : ["file.name"],
        sort: asList(v.sort).map(s => ({
          property: propertyOf(s),
          direction: direction((s as { direction?: unknown }).direction),
        })),
        groupBy: v.groupBy
          ? { property: propertyOf(v.groupBy), direction: direction((v.groupBy as { direction?: unknown }).direction) }
          : undefined,
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      };
    });
    if (!views.length) throw new Error("no view");
    for (const s of statements) parseStatement(s);
    return { base: { filters, views, names } };
  } catch (e) {
    return { unsupported: (e as Error).message };
  }
}

/** The view an embed names (`![[x.base#View]]`), the first one when it names none or one that isn't there. */
export const viewOf = (base: Base, name = "") => base.views.find(v => v.name === name) ?? base.views[0];

// ---- evaluation ------------------------------------------------------------------------------------------------------

/** The page the view is in: `this` (obsidian.md/help/bases/syntax › Access properties with `this`). */
export type Here = { path: string; row?: Row };
const stem = (path: string) => noteName(path);
const fileField = (path: string, field: string): string => {
  const name = path.split("/").pop() ?? path;
  if (field === "name") return name;
  if (field === "basename") return name.replace(/\.[^.]*$/, "");
  if (field === "path") return path;
  if (field === "folder") return path.split("/").slice(0, -1).join("/");
  if (field === "ext") return name.includes(".") ? name.split(".").pop()! : "";
  return stem(path); // the file itself, as a link
};
const same = (a: string, b: string) => stem(a).trim().toLowerCase() === stem(b).trim().toLowerCase();

/** An operand's values for a row; `link` when they name notes (compared by the note they link to). */
function valuesFor(o: Operand, row: Row, here: Here): { values: string[]; link: boolean; num: boolean } {
  if (o.t === "lit") return { values: [o.v], link: false, num: o.num };
  if (o.t === "link") return { values: [o.name], link: true, num: false };
  if (o.t === "file") return { values: [fileField(row.p, o.field)], link: o.field === "file", num: false };
  if (o.t === "prop") return { values: row.props[o.key] ?? [], link: false, num: false };
  if (!o.field || o.field === "file") return { values: [stem(here.path)], link: true, num: false };
  if (o.field.startsWith("file.")) return { values: [fileField(here.path, o.field.slice(5))], link: false, num: false };
  return { values: here.row?.props[o.field] ?? [], link: false, num: false };
}
const compare = (a: string, b: string, num: boolean) =>
  num && !isNaN(Number(a)) && !isNaN(Number(b)) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;

function test(s: Statement, row: Row, here: Here): boolean {
  if (s.t === "call") {
    const arg = valuesFor(s.args[0], row, here);
    let hit: boolean;
    if (s.fn === "inFolder") hit = row.p.startsWith(`${arg.values[0]?.replace(/\/$/, "")}/`);
    else if (s.fn === "hasLink") hit = arg.values.some(v => (row.links ?? []).some(l => same(l, v)));
    else if (s.fn === "hasTag") {
      const tags = (row.tags ?? []).map(t => t.replace(/^#/, "").toLowerCase());
      hit = s.args.some(a =>
        valuesFor(a, row, here).values.some(v => tags.includes(v.replace(/^#/, "").toLowerCase())),
      );
    } else {
      const on = valuesFor(s.on!, row, here).values;
      hit = arg.values.some(v => on.some(o => (arg.link ? same(o, v) : o === v)));
    }
    return s.neg ? !hit : hit;
  }
  const a = valuesFor(s.a, row, here);
  const b = valuesFor(s.b, row, here);
  if (s.op === "==" || s.op === "!=") {
    // a link property's values are the names it links by: one side a link (`this`, link()) compares by note
    const link = a.link || b.link;
    const eq = a.values.some(x => b.values.some(y => (link ? same(x, y) : compare(x, y, a.num || b.num) === 0)));
    return s.op === "==" ? eq : !eq;
  }
  const [x, y] = [a.values[0], b.values[0]];
  if (x === undefined || y === undefined) return false;
  const c = compare(x, y, a.num || b.num);
  return s.op === ">" ? c > 0 : s.op === "<" ? c < 0 : s.op === ">=" ? c >= 0 : c <= 0;
}
function matches(f: BaseFilter, row: Row, here: Here): boolean {
  if (typeof f === "string") return test(parseStatement(f), row, here);
  if ("and" in f) return f.and.every(x => matches(x, row, here));
  if ("or" in f) return f.or.some(x => matches(x, row, here));
  return !f.not.some(x => matches(x, row, here)); // Obsidian: none of them
}

/** Whether the filters can only keep notes: a base lists every file of the vault, attachments too, and Relay's rows are
 *  the notes. Some condition every row must meet has to need a note (a property, a link, a tag, `file.ext == "md"`). */
function notesOnly(f: BaseFilter): boolean {
  if (typeof f === "object")
    return "and" in f ? f.and.some(notesOnly) : "or" in f ? f.or.length > 0 && f.or.every(notesOnly) : false;
  const s = parseStatement(f);
  if (s.neg) return false;
  if (s.t === "call") return s.fn !== "inFolder";
  if (s.op === "!=") return false;
  const sides = [s.a, s.b];
  const ext = sides.some(o => o.t === "file" && o.field === "ext") && sides.some(o => o.t === "lit" && o.v === "md");
  return ext || sides.some(o => o.t === "prop");
}

/** A row's value for a column or sort key (`file.name`, `note.status`, `status`), as the cells and the sort read it. */
export function cellValues(row: Row, id: string): string[] {
  if (id === "file.mtime") return [String(row.at)];
  if (id.startsWith("file.")) return [fileField(row.p, id.slice(5))];
  return row.props[id.replace(/^note\./, "")] ?? [];
}
const order = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export type Shown = { rows: Row[]; total: number; groups: { value: string; rows: Row[] }[] } | { unsupported: string };
/** What a view of a base lists on a page: the rows its global and own filters keep, sorted, cut at its limit, in groups
 *  when it has a groupBy. A row without a sort value goes last. */
export function showBase(base: Base, view: BaseView, rows: Row[], here: Here): Shown {
  const filters = [base.filters, view.filters].filter((f): f is BaseFilter => f !== undefined);
  if (!filters.some(notesOnly)) return { unsupported: "files that aren't notes" };
  const kept = rows.filter(row => filters.every(f => matches(f, row, here)));
  const sorts = view.sort.length ? view.sort : [{ property: "file.name", direction: "ASC" as const }];
  kept.sort((a, b) => {
    for (const s of sorts) {
      const [x, y] = [cellValues(a, s.property)[0] ?? "", cellValues(b, s.property)[0] ?? ""];
      if (!x !== !y) return x ? -1 : 1;
      const c = order(x, y) * (s.direction === "DESC" ? -1 : 1);
      if (c) return c;
    }
    return order(a.p, b.p);
  });
  const shown = view.limit ? kept.slice(0, view.limit) : kept;
  const by = view.groupBy;
  if (!by) return { rows: shown, total: kept.length, groups: [{ value: "", rows: shown }] };
  const groups = new Map<string, Row[]>();
  for (const row of shown) {
    const key = cellValues(row, by.property).join(", ");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const sorted = [...groups].sort(([a], [b]) =>
    !a !== !b ? (a ? -1 : 1) : order(a, b) * (by.direction === "DESC" ? -1 : 1),
  );
  return { rows: shown, total: kept.length, groups: sorted.map(([value, rows]) => ({ value, rows })) };
}

/** The fenced `base` blocks of a page's text: where each is (whole lines, fences included) and the YAML inside. */
export function findBaseBlocks(text: string): { from: number; to: number; source: string }[] {
  const out: { from: number; to: number; source: string }[] = [];
  const re = /^(`{3,}|~{3,})[ \t]*base[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm;
  for (const m of text.matchAll(re)) out.push({ from: m.index, to: m.index + m[0].length, source: m[2] });
  return out;
}
