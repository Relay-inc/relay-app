import { useSettingsStore } from "../../../application/settings/store";
import {
  resetAll,
  resetKey,
  saveKey,
  savePick,
  useShortcutsPageStore,
} from "../../../application/settings/shortcuts-page";
import { pauseShortcuts, saveShortcut, useVoicePageStore } from "../../../application/settings/voice-page";
import {
  bindingLabel,
  bindingOf,
  bindingsOf,
  PICK_ID,
  PICK_MODS,
  pickLabel,
  pickModOf,
  type CommandId,
} from "../../../domain/settings/shortcuts";
import { mailExperimental } from "../../../domain/settings/types";
import { voiceOf, type ShortcutKey } from "../../../domain/settings/voice";
import type { Key } from "../../../shared/i18n";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, ERROR_MESSAGE } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { ShortcutField } from "./ShortcutField";

const APP: CommandId[] = [
  "app.quickAsk",
  "app.newProject",
  "app.newGeneral",
  "app.reopenChat",
  "app.newWindow",
  "app.closeChat",
  "app.settings",
  "app.escape",
  "app.stop",
];
const TODAY: CommandId[] = [
  "today.next",
  "today.prev",
  "today.primary",
  "today.secondary",
  "today.done",
  "today.snooze",
  "today.later",
  "today.doing",
  "today.reply",
  "today.replyAll",
  "today.forward",
  "today.ticket",
  "today.read",
  "today.trash",
];
const MAIL: CommandId[] = ["mail.archive", "mail.trash", "mail.selectAll", "mail.unselect"];
const DICTATION: [ShortcutKey, "on" | "chatOn" | "pasteOn", Key][] = [
  ["shortcut", "on", "voice.on"],
  ["chatShortcut", "chatOn", "voice.chat"],
  ["pasteShortcut", "pasteOn", "voice.paste"],
];

const KEY =
  "inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-[5px] border border-s-border bg-s-mutedbg/40 px-1.5 font-sans text-xs text-s-fg";

/** Shortcuts: every key the main window takes, each changed by clicking it and pressing a new one, with a reset when
 *  it differs from the default. Dictation's are the same settings as in Voice. */
export function ShortcutsPage() {
  const { t } = useT();
  const settings = useSettingsStore(s => s.settings);
  const error = useShortcutsPageStore(s => s.error);
  const voiceError = useVoicePageStore(s => s.shortcutError);
  const voice = voiceOf(settings.voice);
  const changed = (id: string) => !!settings.shortcuts?.[id];
  const resetButton = (onClick: () => void) => (
    <button className={buttonClass("ghost", true)} title={t("keys.reset")} onClick={onClick}>
      <Icon name="refresh" className={BUTTON_GLYPH} />
    </button>
  );
  const rows = (list: CommandId[]) =>
    list.map(id => (
      <Field
        key={id}
        label={t(`keys.${id}`)}
        hint={error[id] ? <span className={ERROR_MESSAGE}>{error[id]}</span> : undefined}
      >
        {changed(id) ? resetButton(() => resetKey(id)) : null}
        {bindingsOf(settings, id).map((binding, index) => (
          <ShortcutField
            key={index}
            value={binding}
            record={bindingOf}
            show={bindingLabel}
            onPick={next => saveKey(id, index, next)}
            onListening={pauseShortcuts}
          />
        ))}
      </Field>
    ));
  const send = bindingsOf(settings, "chat.send")[0];
  const pickMods = PICK_MODS.map(mod => [mod || "none", pickLabel(mod)] as const);
  const dictation = DICTATION.filter(([, on]) => voice[on]);
  return (
    <div className="grid gap-7">
      <Section
        title={t("keys.sec.app")}
        desc={t("keys.help")}
        action={
          Object.keys(settings.shortcuts ?? {}).length ? (
            <button className={buttonClass()} onClick={resetAll}>
              {t("keys.resetAll")}
            </button>
          ) : null
        }
        rows
      >
        {rows(APP)}
      </Section>
      <Section title={t("keys.sec.chat")} rows>
        {rows(["chat.send"])}
        {/* the textarea makes the new line itself, on whichever Enter does not send */}
        <Field label={t("keys.chat.newline")}>
          <kbd className={KEY}>{bindingLabel(send === "Enter" ? "shift+Enter" : "Enter")}</kbd>
        </Field>
        {rows(["card.confirm"])}
        <Field label={t("keys.card.pick")}>
          {changed(PICK_ID) ? resetButton(() => savePick("")) : null}
          <Segmented
            label={t("keys.card.pick")}
            options={pickMods}
            value={pickModOf(settings) || "none"}
            onPick={mod => savePick(mod === "none" ? "" : mod)}
          />
        </Field>
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
        {dictation.length
          ? dictation.map(([key, , label]) => (
              <Field
                key={key}
                label={t(label)}
                hint={voiceError[key] ? <span className={ERROR_MESSAGE}>{voiceError[key]}</span> : undefined}
              >
                <ShortcutField
                  value={voice[key]}
                  onPick={shortcut => saveShortcut(key, shortcut)}
                  onListening={pauseShortcuts}
                />
              </Field>
            ))
          : null}
      </Section>
    </div>
  );
}
