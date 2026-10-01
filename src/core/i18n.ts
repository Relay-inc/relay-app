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
for (const language of LANGS)
  dicts[language] = {
    ...app[language],
    ...Object.fromEntries(
      [...PROVIDERS, ...AGENTS].flatMap(source =>
        Object.entries(source.strings[language] as Record<string, string>).map(([key, text]) => [
          `${source.id}.${key}`,
          text,
        ]),
      ),
    ),
  };
let lang: Lang = "en";
let locale = "en";
export const currentLang = () => lang;
// for dates and sorting: the macOS locale in the UI language (nl-BE for nl), so 30/9 stays 30/9
export const currentLocale = () => locale;

type Params = Record<string, string | number>;
const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
export const t = (key: Key, params?: Params) => fill(dicts[lang][key] ?? en[key], params);

/** Markup to pass as a parameter of `th` as it is, not escaped. Only for markup the app builds itself. */
export class Raw {
  constructor(readonly html: string) {}
}
export const raw = (html: string) => new Raw(html);
type HParams = Record<string, string | number | Raw>;
const escHtml = (text: string) =>
  text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
// a parameter as it goes into markup: `raw()` as it is, anything else escaped
const htmlParams = (params: HParams = {}): Params =>
  Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, value instanceof Raw ? value.html : escHtml(String(value))]),
  );
// a string without markup stays text (Lit escapes it), one with markup is rendered as the trusted HTML it is
function markup(text: string, params?: HParams) {
  const hasRawParam = Object.values(params ?? {}).some(value => value instanceof Raw);
  if (!/[<&]/.test(text) && !hasRawParam) return fill(text, params as Params);
  return unsafeHTML(fill(text, htmlParams(params)));
}
/** A UI string for a template: markup in the string renders, parameters are escaped unless wrapped in `raw()`. */
export const th = (key: Key, params?: HParams) => markup(dicts[lang][key] ?? en[key], params);
// an integration's own key (a settings label, its help), and its `t` for everything else
const any = (key: string, params?: Params) => fill(dicts[lang][key] ?? dicts.en[key] ?? key, params);
// a provider's own key: its id in front, the text from the current language, else English, else the key itself
const providerText = (id: string, key: string) => {
  const full = `${id}.${key}`;
  return dicts[lang][full] ?? dicts.en[full] ?? full;
};
export const pt = (boardProvider: BoardProvider, key: string, params?: Params) =>
  any(`${boardProvider.id}.${key}`, params);
export const pth = (boardProvider: BoardProvider, key: string, params?: HParams) =>
  markup(providerText(boardProvider.id, key), params);
bindHost({ t: any, locale: () => locale });
bindAgentHost({ t: any, locale: () => locale });
/** An agent provider's own key. */
export const at = (agentProvider: AgentProvider, key: string, params?: Params) =>
  any(`${agentProvider.id}.${key}`, params);
export const ath = (agentProvider: AgentProvider, key: string, params?: HParams) =>
  markup(providerText(agentProvider.id, key), params);
// plural: `${base}_one` or `${base}_other`, picked by the locale's rules, with {n} filled in
type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];
const pluralKey = (base: PluralBase, count: number) =>
  `${base}_${new Intl.PluralRules(lang).select(count) === "one" ? "one" : "other"}` as Key;
export const tn = (base: PluralBase, count: number, params?: Params) =>
  t(pluralKey(base, count), { n: count, ...params });
export const tnh = (base: PluralBase, count: number, params?: HParams) =>
  th(pluralKey(base, count), { n: count, ...params });

// The language from the settings ("system" or a code), resolved by the backend: the first macOS
// preferred language the app has, else English. Not navigator.language: WKWebView derives it from the
// app bundle's localizations, which need not match the macOS language list.
export async function initI18n(): Promise<Lang> {
  const code = await invoke<string>("ui_lang").catch(() => navigator.language.slice(0, 2));
  lang = (LANGS as readonly string[]).includes(code) ? (code as Lang) : "en";
  const macLocale = await invoke<string>("ui_locale").catch(() => lang);
  locale = Intl.DateTimeFormat.supportedLocalesOf([macLocale]).length ? macLocale : lang;
  document.documentElement.lang = lang;
  return lang;
}
