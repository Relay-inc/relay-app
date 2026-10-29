import { isLang, setLanguage } from "../../shared/i18n";
import {
  ghOn as githubOn,
  mailOn as mailIsOn,
  mailExperimental as mailIsExperimental,
  filesOn as filesAreOn,
  type Settings,
} from "../../domain/settings/types";
import { pickedDigit, pressed, type CommandId } from "../../domain/settings/shortcuts";
import * as backend from "../../infrastructure/backend";
import { navigatorLang, setPageLang } from "../../infrastructure/window";
import { useSettingsStore } from "./store";

// The settings as both windows read them, and the UI language.
export const settings = () => useSettingsStore.getState().settings;
export const ghOn = () => githubOn(settings());
export const mailOn = () => mailIsOn(settings());
export const mailExperimental = () => mailIsExperimental(settings());
export const filesOn = () => filesAreOn(settings());
/** Whether a key press runs a command, as Settings › Shortcuts has them. */
export const isKey = (e: KeyboardEvent, id: CommandId) => pressed(settings(), id, e);
/** The answer on an agent's question a key press picks, 1 to 9, or 0. */
export const pickedAnswer = (e: KeyboardEvent) => pickedDigit(settings(), e);
/** Time from sessions: on unless switched off in Settings › General. */
export const timeFromSessionsOn = () => settings().timeFromSessions !== false;
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
