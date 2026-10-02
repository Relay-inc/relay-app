import en, { type Key } from "./locales/en";
import nl from "./locales/nl";
import fr from "./locales/fr";
import de from "./locales/de";
import { LANGS, bindHost, type Lang } from "@relay/board-core";
import { bindAgentHost } from "@relay/agent-core";
import type { BoardProvider } from "@relay/board-core";
import type { AgentProvider } from "@relay/agent-core";
import { PROVIDERS, AGENTS } from "./plugins";
import { esc } from "./html";
import { pluralRules } from "./format";

// UI strings: one dictionary per locale, English is the reference. nl, fr and de are typed against
// it, so a missing or extra key fails tsc. Strings may hold HTML (<b>, <code>, &lt;): `t` gives the raw string for
// attributes and plain text, `th` gives the markup to render (ui/components/Html.tsx), with every parameter escaped.
// Each integration brings its own strings (packages/integration-*/src/locales.ts, typed the same way),
// merged in here as <id>.<key>, and so are the agent providers' (packages/agent-*/src/locales.ts).
// The language is part of the settings store: components translate through `useT()` (ui/hooks), which hands out the
// bundle of the current language, so a language switch redraws everything that translates. Code outside React uses
// the module-level functions below, which follow the language set last.
export { type Lang, type Key };
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

type Params = Record<string, string | number>;
const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;

/** Markup to pass as a parameter of `th` as it is, not escaped. Only for markup the app builds itself. */
class Raw {
  constructor(readonly html: string) {}
}
export const raw = (html: string) => new Raw(html);
type HParams = Record<string, string | number | Raw>;
// a parameter as it goes into markup: `raw()` as it is, anything else escaped
const htmlParams = (params: HParams = {}): Params =>
  Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, value instanceof Raw ? value.html : esc(String(value))]),
  );
// plural: `${base}_one` or `${base}_other`, picked by the locale's rules, with {n} filled in
type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];

/** Everything that translates, bound to one language. A new language is a new bundle: new function identities, so a
 *  memoised component that uses one redraws. */
type Strings = ReturnType<typeof makeBundle>;
function makeBundle(lang: Lang, locale: string) {
  const dict = dicts[lang];
  const t = (key: Key, params?: Params) => fill(dict[key] ?? en[key], params);
  /** A UI string as markup: markup in the string stays, parameters are escaped unless wrapped in `raw()`. */
  const th = (key: Key, params?: HParams) => fill(dict[key] ?? en[key], htmlParams(params));
  // an integration's own key (a settings label, its help), and its `t` for everything else
  const any = (key: string, params?: Params) => fill(dict[key] ?? dicts.en[key] ?? key, params);
  // a provider's own key: its id in front, the text from the current language, else English, else the key itself
  const providerText = (id: string, key: string) => {
    const full = `${id}.${key}`;
    return dict[full] ?? dicts.en[full] ?? full;
  };
  const pluralKey = (base: PluralBase, count: number) =>
    `${base}_${pluralRules(lang).select(count) === "one" ? "one" : "other"}` as Key;
  return {
    lang,
    locale,
    t,
    th,
    any,
    /** A board provider's own key. */
    pt: (boardProvider: BoardProvider, key: string, params?: Params) => any(`${boardProvider.id}.${key}`, params),
    pth: (boardProvider: BoardProvider, key: string, params?: HParams) =>
      fill(providerText(boardProvider.id, key), htmlParams(params)),
    /** An agent provider's own key. */
    at: (agentProvider: AgentProvider, key: string, params?: Params) => any(`${agentProvider.id}.${key}`, params),
    ath: (agentProvider: AgentProvider, key: string, params?: HParams) =>
      fill(providerText(agentProvider.id, key), htmlParams(params)),
    tn: (base: PluralBase, count: number, params?: Params) => t(pluralKey(base, count), { n: count, ...params }),
    tnh: (base: PluralBase, count: number, params?: HParams) => th(pluralKey(base, count), { n: count, ...params }),
  };
}
const bundles = new Map<string, Strings>();
/** The bundle for a language and locale, made once. */
export function strings(lang: Lang, locale: string): Strings {
  const id = `${lang}|${locale}`;
  let bundle = bundles.get(id);
  if (!bundle) bundles.set(id, (bundle = makeBundle(lang, locale)));
  return bundle;
}

let current = strings("en", "en");
/** The language and locale every module-level function below follows (the settings store keeps the same pair). */
export function setLanguage(lang: Lang, locale: string) {
  current = strings(lang, locale);
}
export const isLang = (code: string): code is Lang => (LANGS as readonly string[]).includes(code);
export const currentLang = () => current.lang;
// for dates and sorting: the macOS locale in the UI language (nl-BE for nl), so 30/9 stays 30/9
export const currentLocale = () => current.locale;
export const t: Strings["t"] = (key, params) => current.t(key, params);
export const tn: Strings["tn"] = (base, count, params) => current.tn(base, count, params);
export const pt: Strings["pt"] = (provider, key, params) => current.pt(provider, key, params);
export const at: Strings["at"] = (provider, key, params) => current.at(provider, key, params);
bindHost({ t: (key, params) => current.any(key, params), locale: () => current.locale });
bindAgentHost({ t: (key, params) => current.any(key, params), locale: () => current.locale });
