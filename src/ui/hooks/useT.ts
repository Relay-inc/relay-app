import { strings } from "../../shared/i18n";
import { useSettingsStore } from "../../application/settings/store";

/** Everything that translates, in the UI language: `const { t, th, tn, locale } = useT()`. A language switch hands
 *  out a new bundle, so every component that translates redraws. */
export const useT = () =>
  strings(
    useSettingsStore(s => s.lang),
    useSettingsStore(s => s.locale),
  );
