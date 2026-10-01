import { invoke } from "@tauri-apps/api/core";
import en, { type Key } from "./locales/en";
import nl from "./locales/nl";
import fr from "./locales/fr";
import de from "./locales/de";
import { LANGS, bindHost, type Lang } from "@relay/board-core";
import { PROVIDERS, type BoardProvider } from "./providers";
import { bindAgentHost } from "@relay/agent-core";
import { AGENTS, type AgentProvider } from "./agents";

// UI strings: one dictionary per locale, English is the reference. nl, fr and de are typed against
// it, so a missing or extra key fails tsc. Strings may hold HTML: callers escape what they pass in.
// Each integration brings its own strings (packages/integration-*/src/locales.ts, typed the same way),
// merged in here as <id>.<key>, and so are the agent providers' (packages/agent-*/src/locales.ts).
export { LANGS, type Lang };
const app: Record<Lang, Record<Key, string>> = { en, nl, fr, de };
const dicts = {} as Record<Lang, Record<string, string>>;
for (const l of LANGS) dicts[l] = { ...app[l], ...Object.fromEntries([...PROVIDERS, ...AGENTS].flatMap(p => Object.entries(p.strings[l] as Record<string, string>).map(([k, v]) => [`${p.id}.${k}`, v]))) };
let lang: Lang = "en", locale = "en";
export const currentLang = () => lang;
// for dates and sorting: the macOS locale in the UI language (nl-BE for nl), so 30/9 stays 30/9
export const currentLocale = () => locale;

type Params = Record<string, string | number>;
const fill = (s: string, p?: Params) => p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : s;
export const t = (key: Key, p?: Params) => fill(dicts[lang][key] ?? en[key], p);
// an integration's own key (a settings label, its help), and its `t` for everything else
const any = (key: string, p?: Params) => fill(dicts[lang][key] ?? dicts.en[key] ?? key, p);
export const pt = (bp: BoardProvider, key: string, p?: Params) => any(`${bp.id}.${key}`, p);
bindHost({ t: any, locale: () => locale });
bindAgentHost({ t: any, locale: () => locale });
/** An agent provider's own key. */
export const at = (ap: AgentProvider, key: string, p?: Params) => any(`${ap.id}.${key}`, p);
// plural: `${base}_one` or `${base}_other`, picked by the locale's rules, with {n} filled in
type PluralBase = { [K in Key]: K extends `${infer B}_one` ? B : never }[Key];
export const tn = (base: PluralBase, n: number, p?: Params) =>
  t(`${base}_${new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other"}` as Key, { n, ...p });

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
// static markup: data-i18n sets the text, data-i18n-title and data-i18n-placeholder the attributes
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(e => { e.textContent = t(e.dataset.i18n as Key); });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach(e => { e.title = t(e.dataset.i18nTitle as Key); });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach(e => e.setAttribute("aria-label", t(e.dataset.i18nAria as Key)));
  root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach(e => { e.placeholder = t(e.dataset.i18nPlaceholder as Key); });
}
