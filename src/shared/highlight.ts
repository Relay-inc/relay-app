import { esc } from "./html.ts";

// ---------- syntax colours for code in a conversation: a small tokenizer per language family, coloured by the
// --syn-* tokens (the `tok-*` classes, ui/styles/md-defaults.css). Not a parser: a regex pass that knows comments,
// strings, numbers, keywords, calls and properties, enough for a code block to read like an editor's
// ponytail: regex tokens, no nesting (template literals, heredocs, embedded languages stay one colour)

export type Tok = "kw" | "str" | "num" | "fn" | "com" | "prop";
/** A run of code and its colour, null for plain text. */
export type Span = [Tok | null, string];

type Lang = {
  kw: string;
  com: string[];
  str: string[];
  /** extra patterns tried before numbers and words, with their colour */
  extra?: [Tok, string][];
  word?: string;
  /** keywords in any case (SQL) */
  ci?: boolean;
  /** a word (or a string) followed by `:` is a key */
  keys?: "word" | "str" | "both";
  /** a word followed by `=` is an attribute (HTML) */
  attrs?: boolean;
  /** the first word of a command is a call (shells) */
  cmd?: boolean;
};

const DQ = String.raw`"(?:[^"\\\n]|\\.)*"`;
const SQ = String.raw`'(?:[^'\\\n]|\\.)*'`;
const BT = String.raw`\x60(?:[^\x60\\]|\\[\s\S])*\x60`;
const SLASH = String.raw`//.*`;
const BLOCK = String.raw`/\*[\s\S]*?(?:\*/|$)`;
const HASH = String.raw`(?<![^\s])#.*`;

const LANGS: Record<string, Lang> = {
  js: {
    kw: "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while yield",
    com: [SLASH, BLOCK],
    str: [DQ, SQ, BT],
    keys: "word",
  },
  json: { kw: "true false null", com: [SLASH, BLOCK], str: [DQ], keys: "str" },
  bash: {
    kw: "if then else elif fi for in do done case esac while until function select return export local readonly declare unset source exit",
    com: [HASH],
    str: [DQ, SQ],
    extra: [
      ["prop", String.raw`(?<![^\s])--?[A-Za-z][\w-]*`],
      ["prop", String.raw`\$\{[^}\n]*\}|\$[\w@#?$!*-]`],
    ],
    word: String.raw`[A-Za-z_][\w.-]*`,
    cmd: true,
  },
  php: {
    kw: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enum extends false final finally fn for foreach function global goto if implements include instanceof interface isset list match namespace new null or print private protected public readonly require return self static switch throw trait true try unset use var while yield void int string bool float mixed never iterable object",
    com: [SLASH, BLOCK, HASH],
    str: [DQ, SQ],
    extra: [["kw", String.raw`<\?php|\?>`]],
  },
  python: {
    kw: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield match case",
    com: [HASH],
    str: [String.raw`"""[\s\S]*?(?:"""|$)`, String.raw`'''[\s\S]*?(?:'''|$)`, DQ, SQ],
    extra: [["fn", String.raw`@[A-Za-z_][\w.]*`]],
  },
  rust: {
    kw: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    com: [SLASH, BLOCK],
    str: [DQ, String.raw`'(?:\\.|[^\\'\n])'`],
    extra: [["fn", String.raw`[A-Za-z_]\w*!(?=[(\[{])`]],
  },
  css: {
    kw: "important",
    com: [BLOCK],
    str: [DQ, SQ],
    extra: [
      ["kw", String.raw`@[\w-]+`],
      ["num", String.raw`#[0-9a-fA-F]{3,8}\b`],
    ],
    word: String.raw`-?[A-Za-z_][\w-]*`,
    keys: "word",
  },
  html: {
    kw: "",
    com: [String.raw`<!--[\s\S]*?(?:-->|$)`],
    str: [DQ, SQ],
    extra: [["kw", String.raw`(?<=</?)[A-Za-z][\w:-]*`]],
    word: String.raw`[A-Za-z_][\w:-]*`,
    attrs: true,
  },
  sql: {
    kw: "add all alter and as asc begin between by case check column commit constraint create cross default delete desc distinct drop else end exists false foreign from full group having if in index inner insert into is join key left like limit not null offset on or order outer primary references returning right rollback select set table then true union unique update using values view when where with",
    com: [String.raw`--.*`, BLOCK],
    str: [SQ, DQ],
    ci: true,
  },
  yaml: {
    kw: "true false null yes no on off",
    com: [HASH],
    str: [DQ, SQ],
    word: String.raw`[A-Za-z_][\w.-]*`,
    keys: "both",
  },
};
const ALIASES: Record<string, string> = {
  ts: "js",
  tsx: "js",
  typescript: "js",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  jsonc: "json",
  json5: "json",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  shellsession: "bash",
  py: "python",
  rs: "rust",
  scss: "css",
  less: "css",
  xml: "html",
  svg: "html",
  vue: "html",
  yml: "yaml",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",
  sqlite: "sql",
};
const NUM = String.raw`\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;
const WORD = String.raw`[A-Za-z_$][\w$]*`;

type Compiled = { lang: Lang; re: RegExp; kinds: (Tok | "word" | "str")[]; kw: Set<string> };
const compiled = new Map<string, Compiled>();
function compile(name: string): Compiled | null {
  const id = ALIASES[name] ?? name;
  const lang = LANGS[id];
  if (!lang) return null;
  let done = compiled.get(id);
  if (!done) {
    const parts: [Tok | "word" | "str", string][] = [
      ...lang.com.map(source => ["com", source] as [Tok, string]),
      ...lang.str.map(source => ["str", source] as ["str", string]),
      ...(lang.extra ?? []),
      ["num", NUM],
      ["word", lang.word ?? WORD],
    ];
    const kw = lang.kw.split(" ").filter(Boolean);
    done = {
      lang,
      re: new RegExp(parts.map(([, source]) => `(${source})`).join("|"), "g"),
      kinds: parts.map(([kind]) => kind),
      kw: new Set(kw),
    };
    compiled.set(id, done);
  }
  return done;
}

/** `code` as runs of colour, for `lang` (a fence's language: ts, json, bash, …). Unknown languages are one plain run. */
export function tokenize(code: string, lang: string): Span[] {
  const c = compile(lang.toLowerCase());
  if (!c) return [[null, code]];
  const { lang: l, re, kinds, kw } = c;
  const out: Span[] = [];
  const push = (kind: Tok | null, text: string) => {
    const last = out[out.length - 1];
    if (last && last[0] === kind) last[1] += text;
    else out.push([kind, text]);
  };
  let at = 0;
  re.lastIndex = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    if (m.index > at) push(null, code.slice(at, m.index));
    at = m.index + m[0].length;
    const kind = kinds[m.slice(1).findIndex(group => group !== undefined)];
    // the characters around the match on its line, past spaces
    let p = m.index - 1;
    while (code[p] === " " || code[p] === "\t") p--;
    let n = at;
    while (code[n] === " " || code[n] === "\t") n++;
    const prev = p < 0 ? "\n" : code[p];
    const isKey = code[n] === ":" && code[n + 1] !== ":";
    if (kind === "str") push(isKey && (l.keys === "str" || l.keys === "both") ? "prop" : "str", m[0]);
    else if (kind !== "word") push(kind, m[0]);
    else if (isKey && l.keys === "both") push("prop", m[0]);
    else if (kw.has(l.ci ? m[0].toLowerCase() : m[0])) push("kw", m[0]);
    else if (l.cmd) push("\n|&;(`".includes(prev) ? "fn" : null, m[0]);
    else if (code[n] === "(") push("fn", m[0]);
    else if (prev === "." || (prev === ">" && code[p - 1] === "-")) push("prop", m[0]);
    else if (isKey && (l.keys === "word" || l.keys === "both")) push("prop", m[0]);
    else if (l.attrs && code[n] === "=" && code[n + 1] !== "=") push("prop", m[0]);
    else push(null, m[0]);
  }
  if (at < code.length) push(null, code.slice(at));
  return out;
}

// a streaming answer parses its finished code blocks again on every frame: the same block colours once
// ponytail: cleared at 200 blocks, an LRU if long sessions show it
const cache = new Map<string, string>();
/** `code` as escaped HTML with a `tok-*` span per coloured run. */
export function highlightHtml(code: string, lang: string) {
  const id = `${lang}\n${code}`;
  let html = cache.get(id);
  if (html === undefined) {
    if (cache.size > 200) cache.clear();
    html = tokenize(code, lang)
      .map(([kind, text]) => (kind ? `<span class="tok-${kind}">${esc(text)}</span>` : esc(text)))
      .join("");
    cache.set(id, html);
  }
  return html;
}
