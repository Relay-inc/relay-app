import { isLang, setLanguage } from "../../shared/i18n";
import {
  ghOn as githubOn,
  mailOn as mailIsOn,
  mailExperimental as mailIsExperimental,
  type Settings,
} from "../../domain/settings/types";
import * as backend from "../../infrastructure/backend";
import { navigatorLang, setPageLang } from "../../infrastructure/window";
import { useSettingsStore } from "./store";

// The settings as both windows read them, and the UI language.
export const settings = () => useSettingsStore.getState().settings;
export const ghOn = () => githubOn(settings());
export const mailOn = () => mailIsOn(settings());
export const mailExperimental = () => mailIsExperimental(settings());
/** The settings as the backend sent them (merged over what is known, as an older backend may leave fields out). */
export const setSettingsState = (next: Partial<Settings>) =>
  useSettingsStore.setState(draft => {
    draft.settings = { ...draft.settings, ...next };
  });

/** The language from the settings, resolved by the backend: the first macOS preferred language the app has, else
 *  English. Every component that translates redraws (the store's `lang`). */
export async function initLanguage() {
  const code = await backend.uiLang().catch(navigatorLang);
  const lang = isLang(code) ? code : "en";
  const macLocale = await backend.uiLocale().catch(() => lang);
  const locale = Intl.DateTimeFormat.supportedLocalesOf([macLocale]).length ? macLocale : lang;
  setLanguage(lang, locale);
  setPageLang(lang);
  useSettingsStore.setState(draft => {
    draft.lang = lang;
    draft.locale = locale;
  });
  return lang;
}

/** Save from the main window. Resolves to why it failed, or null when it worked. */
export async function saveMainSettings(next: Settings): Promise<string | null> {
  try {
    const saved = await backend.setSettings(next);
    useSettingsStore.setState(draft => {
      draft.settings = saved;
    });
    return null;
  } catch (e) {
    return String(e);
  }
}
