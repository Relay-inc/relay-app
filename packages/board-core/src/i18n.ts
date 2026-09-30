// The strings bridge between an integration and the app. An integration keeps its own UI strings (locales.ts,
// typed with Locales so a missing key fails tsc) and translates with `translator(id)`; the app merges every
// integration's strings into its dictionaries as <id>.<key> and binds the lookup once (src/i18n.ts).

export const LANGS = ["en", "nl", "fr", "de"] as const;
export type Lang = (typeof LANGS)[number];
/** An integration's strings: for every language exactly the keys `K` of its English reference. */
export type Locales<K extends string> = Record<Lang, Record<K, string>>;
export type Params = Record<string, string | number>;

type Host = { t(key: string, p?: Params): string; locale(): string };
let host: Host = { t: k => k, locale: () => "en" };
/** Called once by the app: a namespaced key in the UI language, and the locale for dates and sorting. */
export const bindHost = (h: Host) => { host = h; };
/** An integration's `t` over its own keys. Strings may hold HTML: callers escape what they pass in. */
export const translator = <K extends string>(id: string) => (key: K, p?: Params) => host.t(`${id}.${key}`, p);
/** For dates and sorting: the macOS locale in the UI language (nl-BE for nl). */
export const currentLocale = () => host.locale();
