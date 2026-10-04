import { useEffect } from "react";
import { useSettingsStore } from "../../../application/settings/store";
import {
  downloadModel,
  loadModels,
  pickModel,
  removeModel,
  saveVoice,
  useVoicePageStore,
} from "../../../application/settings/voice-page";
import { MODEL_NAMES, VOICE_SHORTCUTS, voiceOf, type VoiceMode } from "../../../domain/settings/voice";
import type { Key } from "../../../shared/i18n";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW, OK_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

/** Voice: dictation on or off, the speech model to use (downloaded or removed here), its language, and the shortcut
 *  with how it records. The models are asked for each time the page shows. */
export function VoicePage({ active }: { active: boolean }) {
  const { t, tn, locale } = useT();
  const cfg = useSettingsStore(s => s.settings.voice);
  const voice = voiceOf(cfg);
  const models = useVoicePageStore(s => s.models);
  const progress = useVoicePageStore(s => s.progress);
  const errors = useVoicePageStore(s => s.errors);
  useEffect(() => {
    if (active) loadModels();
  }, [active]);

  const picked = models.find(model => model.id === voice.model);
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const languages = [
    { id: "auto", name: t(picked?.auto === false ? "voice.langMac" : "voice.langAuto") },
    ...(picked?.langs ?? [])
      .map(id => ({ id, name: names.of(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
  ];
  const modes = (["both", "hold", "tap"] as const).map(id => [id, t(`voice.mode.${id}`)] as const);
  return (
    <div className="grid gap-7">
      <Section title={t("voice.sec.dictation")} rows>
        <Field label={t("voice.on")} id="voiceon" hint={t("voice.onHelp")}>
          <Switch id="voiceon" on={voice.on} onToggle={on => saveVoice({ on })} />
        </Field>
      </Section>
      <Section title={t("voice.sec.model")} desc={t("voice.modelHelp")} list>
        {models.map(model => {
          const pct = progress[model.id];
          const downloading = pct !== undefined || model.downloading;
          return (
            <div key={model.id} className="flex items-start gap-3 px-3.5 py-3 [&+&]:border-t [&+&]:border-s-border">
              <input
                type="radio"
                name="voicemodel"
                id={`vm-${model.id}`}
                className="mt-1 accent-(--color-accent)"
                checked={voice.model === model.id}
                onChange={() => pickModel(model.id)}
              />
              <label htmlFor={`vm-${model.id}`} className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-[13px] text-s-fg">
                  {MODEL_NAMES[model.id] ?? model.id}
                  {voice.model === model.id && model.installed ? (
                    <span className={`ml-2 ${OK_MESSAGE}`}>{t("voice.inUse")}</span>
                  ) : null}
                </span>
                <span className={HINT_IN_ROW}>{t(`voice.desc.${model.id}` as Key)}</span>
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
      <Section title={t("voice.sec.language")} rows>
        <Field label={t("voice.language")} id="voicelang" hint={t("voice.languageHelp")}>
          <Select
            className={SELECT}
            id="voicelang"
            options={languages}
            value={voice.language}
            onChange={language => saveVoice({ language })}
          />
        </Field>
      </Section>
      <Section title={t("voice.sec.meetings")} desc={t("voice.meetingsHelp")} rows>
        <Field label={t("voice.meetingModel")} id="voicemeet" hint={t("voice.meetingModelHelp")}>
          <Select
            className={SELECT}
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
        <Field label={t("voice.keepAudio")} id="voiceaudio" hint={t("voice.keepAudioHelp")}>
          <Switch id="voiceaudio" on={voice.keepAudio} onToggle={keepAudio => saveVoice({ keepAudio })} />
        </Field>
        <Field label={t("voice.summarize")} id="voicesum" hint={t("voice.summarizeHelp")}>
          <Switch id="voicesum" on={voice.summarize} onToggle={summarize => saveVoice({ summarize })} />
        </Field>
      </Section>
      <Section title={t("voice.sec.when")} rows>
        <Field label={t("voice.shortcut")} id="voicekey" hint={t("voice.shortcutHelp")}>
          <Select
            className={SELECT}
            id="voicekey"
            options={VOICE_SHORTCUTS.map(([id, name]) => ({ id, name }))}
            value={voice.shortcut}
            onChange={shortcut => saveVoice({ shortcut })}
          />
        </Field>
        <Field label={t("voice.mode")} hint={t("voice.modeHelp")}>
          <Segmented<VoiceMode>
            label={t("voice.mode")}
            options={modes}
            value={voice.mode}
            onPick={mode => saveVoice({ mode })}
          />
        </Field>
      </Section>
    </div>
  );
}
