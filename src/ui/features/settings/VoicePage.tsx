import { useEffect } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import {
  askAccess,
  downloadModel,
  loadAccess,
  loadModels,
  pickModel,
  removeModel,
  saveVoice,
  useVoicePageStore,
} from "../../../application/settings/voice-page";
import { MODEL_NAMES, shortcutLabel, voiceOf, type ShortcutKey, type VoiceMode } from "../../../domain/settings/voice";
import type { Key } from "../../../shared/i18n";
import { isMac } from "../../../shared/platform";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { go } from "../../../application/settings/window";
import { buttonClass, DEFAULT_PILL, ERROR_MESSAGE, HINT_IN_ROW, KBD, OK_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

// in the two side-by-side cards the select goes under its label
const STACK = "lg:flex-col lg:items-stretch lg:gap-2";

/** Voice: each way to dictate on or off (its key shown, changed in Shortcuts) and how it records, the speech model to
 *  use (downloaded or removed here), its language and the meetings'. The models are asked for each time the page shows. */
export function VoicePage({ active }: { active: boolean }) {
  const { t, tn, locale } = useT();
  const cfg = useSettingsStore(s => s.settings.voice);
  const voice = voiceOf(cfg);
  const models = useVoicePageStore(s => s.models);
  const progress = useVoicePageStore(s => s.progress);
  const errors = useVoicePageStore(s => s.errors);
  const access = useVoicePageStore(s => s.access);
  useEffect(() => {
    if (active) loadModels();
  }, [active]);
  // Accessibility is switched in System Settings: asked again every 2 s while the page shows and it is not allowed
  useEffect(() => {
    if (!active || access) return;
    loadAccess();
    const timer = setInterval(loadAccess, 2000);
    return () => clearInterval(timer);
  }, [active, access]);

  // a model this build lacks (Parakeet on an Intel Mac) is the first one listed, as in src-tauri/src/dictation.rs
  const picked = models.find(model => model.id === voice.model) ?? models[0];
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const languages = [
    { id: "auto", name: t(picked?.auto === false ? "voice.langMac" : "voice.langAuto") },
    ...(picked?.langs ?? [])
      .map(id => ({ id, name: names.of(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
  ];
  const modes = (["both", "hold", "tap"] as const).map(id => [id, t(`voice.mode.${id}`)] as const);
  // a way's key, read-only: Shortcuts owns changing it
  const key = (way: ShortcutKey) => <kbd className={KBD}>{shortcutLabel(voice[way])}</kbd>;
  // the model in use first, the rest in the order the backend lists them
  const ordered = [...models].sort((a, b) => Number(b.id === picked?.id) - Number(a.id === picked?.id));
  return (
    <div className="grid gap-7">
      {/* each way to dictate: its switch with its key beside it */}
      <Section title={t("voice.sec.dictation")} rows>
        <Field label={t("voice.on")} id="voiceon" hint={t("voice.onHelp")}>
          {key("shortcut")}
          <Switch id="voiceon" on={voice.on} onToggle={on => saveVoice({ on })} />
        </Field>
        <Field label={t("voice.chat")} id="voicechat" hint={t("voice.chatHelp")}>
          {key("chatShortcut")}
          <Switch id="voicechat" on={voice.chatOn} onToggle={chatOn => saveVoice({ chatOn })} />
        </Field>
        <Field label={t("voice.paste")} id="voicepaste" hint={t("voice.pasteHelp")}>
          {key("pasteShortcut")}
          <Switch id="voicepaste" on={voice.pasteOn} onToggle={pasteOn => saveVoice({ pasteOn })} />
        </Field>
        {/* Windows lets any app send Ctrl+V, there is nothing to allow */}
        {voice.pasteOn && isMac() ? (
          <Field label={t("voice.access")} className="pl-6" hint={t(access ? "voice.accessOk" : "voice.accessHelp")}>
            {access ? (
              <span className={OK_MESSAGE}>{t("voice.accessAllowed")}</span>
            ) : (
              <button className={buttonClass()} onClick={askAccess}>
                {t("voice.accessAsk")}
              </button>
            )}
          </Field>
        ) : null}
        {voice.on || voice.chatOn || voice.pasteOn ? (
          <Field label={t("voice.mode")} hint={t("voice.modeHelp")}>
            <Segmented<VoiceMode>
              label={t("voice.mode")}
              options={modes}
              value={voice.mode}
              onPick={mode => saveVoice({ mode })}
            />
          </Field>
        ) : null}
        <Field label={<span className="text-xs text-s-muted">{t("voice.keysElsewhere")}</span>}>
          <button className="text-xs text-accent-text hover:underline" onClick={() => go("shortcuts")}>
            {t("voice.keysLink")}
          </button>
        </Field>
      </Section>
      <Section title={t("voice.sec.model")} desc={t("voice.modelHelp")} list>
        {ordered.map(model => {
          const pct = progress[model.id];
          const downloading = pct !== undefined || model.downloading;
          return (
            <div key={model.id} className="flex items-start gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-s-border">
              <input
                type="radio"
                name="voicemodel"
                id={`vm-${model.id}`}
                className="mt-1 accent-(--color-accent)"
                checked={picked?.id === model.id}
                onChange={() => pickModel(model.id)}
              />
              <label htmlFor={`vm-${model.id}`} className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-[13px] text-s-fg">
                  {MODEL_NAMES[model.id] ?? model.id}
                  {picked?.id === model.id && model.installed ? (
                    <span className={`ml-2 ${DEFAULT_PILL}`}>{t("voice.inUse")}</span>
                  ) : null}
                </span>
                <span className={HINT_IN_ROW}>
                  {t(
                    model.id === "whisper-turbo" && !isMac()
                      ? "voice.desc.whisper-turboWin"
                      : (`voice.desc.${model.id}` as Key),
                  )}
                </span>
                <span className={HINT_IN_ROW}>
                  {t("voice.size", { mb: model.mb })} · {tn("voice.langs", model.langs.length)}
                </span>
                {errors[model.id] ? <span className={ERROR_MESSAGE}>{errors[model.id]}</span> : null}
              </label>
              {downloading ? (
                <span className={OK_MESSAGE}>{t("voice.downloading", { pct: Math.round((pct ?? 0) * 100) })}</span>
              ) : model.installed ? (
                <button className={buttonClass("ghost")} onClick={() => removeModel(model.id)}>
                  {t("voice.remove")}
                </button>
              ) : (
                <button className={buttonClass()} onClick={() => downloadModel(model.id)}>
                  {t("voice.download")}
                </button>
              )}
            </div>
          );
        })}
      </Section>
      <div className="grid items-start gap-7 lg:grid-cols-2 lg:gap-4">
        <Section title={t("voice.sec.language")} rows>
          <Field label={t("voice.language")} id="voicelang" hint={t("voice.languageHelp")} className={STACK}>
            <Select
              className={`${SELECT} lg:w-full`}
              id="voicelang"
              options={languages}
              value={voice.language}
              onChange={language => saveVoice({ language })}
            />
          </Field>
        </Section>
        <Section title={t("voice.sec.meetings")} desc={t("voice.meetingsHelp")} rows>
          <Field label={t("voice.meetingModel")} id="voicemeet" hint={t("voice.meetingModelHelp")} className={STACK}>
            <Select
              className={`${SELECT} lg:w-full`}
              id="voicemeet"
              options={[
                { id: "", name: t("voice.sameModel") },
                ...models
                  .filter(model => model.installed || model.id === voice.meetingModel)
                  .map(model => ({ id: model.id, name: MODEL_NAMES[model.id] ?? model.id })),
              ]}
              value={voice.meetingModel}
              onChange={meetingModel => saveVoice({ meetingModel })}
            />
          </Field>
          <Field
            label={t("voice.keepAudio")}
            id="voiceaudio"
            hint={t(isMac() ? "voice.keepAudioHelp" : "voice.keepAudioHelpWin")}
          >
            <Switch id="voiceaudio" on={voice.keepAudio} onToggle={keepAudio => saveVoice({ keepAudio })} />
          </Field>
          <Field label={t("voice.summarize")} id="voicesum" hint={t("voice.summarizeHelp")}>
            <Switch id="voicesum" on={voice.summarize} onToggle={summarize => saveVoice({ summarize })} />
          </Field>
        </Section>
      </div>
    </div>
  );
}
