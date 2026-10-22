import { useSettingsStore } from "../../../application/settings/store";
import { mailExperimental } from "../../../domain/settings/types";
import { shortcutLabel, voiceOf } from "../../../domain/settings/voice";
import type { Key } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { Field } from "./Field";
import { Section } from "./Section";

type Row = readonly [keys: readonly string[], label: Key];

// what the main window's handlers take (ui/app/App.tsx, the menu in src-tauri/src/lib.rs, TodayView, PermissionCard,
// the composer): keep in step when a key changes there
const APP: Row[] = [
  [["⌘K"], "keys.quickAsk"],
  [["⌘T"], "keys.newGeneral"],
  [["⌘N"], "keys.newProject"],
  [["⌘W"], "keys.closeChat"],
  [["⌘,"], "keys.settings"],
  [["Esc"], "keys.esc"],
  [["⌃C"], "keys.ctrlC"],
];
const CHAT: Row[] = [
  [["↵"], "keys.send"],
  [["⇧↵"], "keys.newline"],
  [["1–9"], "keys.pickOption"],
];
const TODAY: Row[] = [
  [["J", "K"], "keys.walk"],
  [["↵"], "keys.primary"],
  [["⌫"], "keys.secondary"],
  [["E"], "keys.done"],
  [["S"], "keys.snooze"],
  [["L"], "keys.later"],
  [["P"], "keys.doing"],
  [["R", "A", "F"], "keys.reply"],
  [["U"], "keys.read"],
];
const MAIL: Row[] = [
  [["E"], "keys.archive"],
  [["#", "⌫"], "keys.trash"],
  [["⌘A"], "keys.selectAll"],
  [["Esc"], "keys.unselect"],
];

const KEY =
  "inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-[5px] border border-s-border bg-s-mutedbg/40 px-1.5 font-sans text-xs text-s-fg";

/** Shortcuts: what the keys do in the main window, read only. Dictation shows the shortcuts set in Voice. */
export function ShortcutsPage() {
  const { t } = useT();
  const settings = useSettingsStore(s => s.settings);
  const voice = voiceOf(settings.voice);
  const rows = (list: Row[]) =>
    list.map(([keys, label]) => (
      <Field key={label} label={t(label)}>
        {keys.map(key => (
          <kbd key={key} className={KEY}>
            {key}
          </kbd>
        ))}
      </Field>
    ));
  const dictation: Row[] = [
    ...(voice.on ? [[[shortcutLabel(voice.shortcut)], "voice.on"] as const] : []),
    ...(voice.chatOn ? [[[shortcutLabel(voice.chatShortcut)], "voice.chat"] as const] : []),
    ...(voice.pasteOn ? [[[shortcutLabel(voice.pasteShortcut)], "voice.paste"] as const] : []),
  ];
  return (
    <div className="grid gap-7">
      <Section title={t("keys.sec.app")} rows>
        {rows(APP)}
      </Section>
      <Section title={t("keys.sec.chat")} rows>
        {rows(CHAT)}
      </Section>
      <Section title={t("keys.sec.today")} desc={t("keys.todayHelp")} rows>
        {rows(TODAY)}
      </Section>
      {mailExperimental(settings) ? (
        <Section title={t("keys.sec.mail")} rows>
          {rows(MAIL)}
        </Section>
      ) : null}
      <Section title={t("keys.sec.dictation")} desc={t("keys.dictationHelp")} rows>
        {dictation.length ? rows(dictation) : null}
      </Section>
    </div>
  );
}
