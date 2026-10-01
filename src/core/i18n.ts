import { invoke } from "@tauri-apps/api/core";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import en, { type Key } from "./locales/en";
import nl from "./locales/nl";
import fr from "./locales/fr";
import de from "./locales/de";
import { LANGS, bindHost, type Lang } from "@relay/board-core";
import { PROVIDERS, type BoardProvider } from "../domain/providers";
import { bindAgentHost } from "@relay/agent-core";
import { AGENTS, type AgentProvider } from "../domain/agents";

// UI strings: one dictionary per locale, English is the reference. nl, fr and de are typed against
// it, so a missing or extra key fails tsc. Strings may hold HTML (<b>, <code>, &lt;): `t` gives the raw string for
// attributes and plain text, `th` gives what a template shows, markup and all, with every parameter escaped.
// Each integration brings its own strings (packages/integration-*/src/locales.ts, typed the same way),
// merged in here as <id>.<key>, and so are the agent providers' (packages/agent-*/src/locales.ts).
export { LANGS, type Lang };
const app: Record<Lang, Record<Key, string>> = { en, nl, fr, de };
const dicts = {} as Record<Lang, Record<string, string>>;
for (const l of LANGS)
  dicts[l] = {
    ...app[l],
    ...Object.fromEntries(
      [...PROVIDERS, ...AGENTS].flatMap(p =>
        Object.entries(p.strings[l] as Record<string, string>).map(([k, v]) => [`${p.id}.${k}`, v]),
      ),
    ),
  };
let lang: Lang = "en",
  locale = "en";
export const currentLang = () => lang;
// for dates and sorting: the macOS locale in the UI language (nl-BE for nl), so 30/9 stays 30/9
export const currentLocale = () => locale;

type Params = Record<string, string | number>;
const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : s);
export const t = (key: Key, p?: Params) => fill(dicts[lang][key] ?? en[key], p);

/** Markup to pass as a parameter of `th` as it is, not escaped. Only for markup the app builds itself. */
export class Raw {
  constructor(readonly html: string) {}
}
export const raw = (html: string) => new Raw(html);
type HParams = Record<string, string | number | Raw>;
const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// a string without markup stays text (Lit escapes it), one with markup is rendered as the trusted HTML it is
function markup(s: string, p?: HParams) {
  const vals = Object.values(p ?? {}),
    rawParam = vals.some(v => v instanceof Raw);
  if (!/[<&]/.test(s) && !rawParam) return fill(s, p as Params);
  return unsafeHTML(
    fill(
      s,
      Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, v instanceof Raw ? v.html : escHtml(String(v))])),
    ),
  );
}
/** A UI string for a template: markup in the string renders, parameters are escaped unless wrapped in `raw()`. */
export const th = (key: Key, p?: HParams) => markup(dicts[lang][key] ?? en[key], p);
// an integration's own key (a settings label, its help), and its `t` for everything else
const any = (key: string, p?: Params) => fill(dicts[lang][key] ?? dicts.en[key] ?? key, p);
export const pt = (bp: BoardProvider, key: string, p?: Params) => any(`${bp.id}.${key}`, p);
export const pth = (bp: BoardProvider, key: string, p?: HParams) =>
  markup(dicts[lang][`${bp.id}.${key}`] ?? dicts.en[`${bp.id}.${key}`] ?? `${bp.id}.${key}`, p);
bindHost({ t: any, locale: () => locale });
bindAgentHost({ t: any, locale: () => locale });
/** An agent provider's own key. */
export const at = (ap: AgentProvider, key: string, p?: Params) => any(`${ap.id}.${key}`, p);
export const ath = (ap: AgentProvider, key: string, p?: HParams) =>
  markup(dicts[lang][`${ap.id}.${key}`] ?? dicts.en[`${ap.id}.${key}`] ?? `${ap.id}.${key}`, p);
// plural: `${base}_one` or `${base}_other`, picked by the locale's rules, with {n} filled in
type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];
export const tn = (base: PluralBase, n: number, p?: Params) =>
  t(`${base}_${new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other"}` as Key, { n, ...p });
export const tnh = (base: PluralBase, n: number, p?: HParams) =>
  th(`${base}_${new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other"}` as Key, { n, ...p });

// The language from the settings ("system" or a code), resolved by the backend: the first macOS
// preferred language the app has, else English. Not navigator.language: WKWebView derives it from the
// app bundle's localizations, which need not match the macOS language list.
export async function initI18n(): Promise<Lang> {
  const l = await invoke<string>("ui_lang").catch(() => navigator.language.slice(0, 2));
  lang = (LANGS as readonly string[]).includes(l) ? (l as Lang) : "en";
  const loc = await invoke<string>("ui_locale").catch(() => lang);
  locale = Intl.DateTimeFormat.supportedLocalesOf([loc]).length ? loc : lang;
  document.documentElement.lang = lang;
  return lang;
}
