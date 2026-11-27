import { pipelineProjects, pipelinesRun } from "../../../domain/pipeline/rules";
import { useSettingsStore } from "../../../application/settings/store";
import {
  saveAutoKeepChanges,
  saveAutoRetry,
  saveCaptureOnClose,
  saveKeepAwake,
  saveTimeFromSessions,
} from "../../../application/settings/general-page";
import { setPipelinesRun } from "../../../application/settings/pipeline";
import { go } from "../../../application/settings/window";
import { useT } from "../../hooks/useT";
import { HINT } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Switch } from "./Switch";

/** Automation: what Relay does on its own, by when it happens: while conversations run, after one, the board
 *  pipelines (the one switch for all of them, shown as Run pipelines: the stored setting is the pause) and the time
 *  Today proposes. */
export function AutomationPage() {
  const { t } = useT();
  const keepAwake = useSettingsStore(s => s.settings.keepAwake !== false);
  const autoRetry = useSettingsStore(s => s.settings.autoRetry === true);
  const autoKeep = useSettingsStore(s => s.settings.autoKeepChanges === true);
  const captureOnClose = useSettingsStore(s => s.settings.captureOnClose !== false);
  const timeFromSessions = useSettingsStore(s => s.settings.timeFromSessions !== false);
  const run = useSettingsStore(s => pipelinesRun(s.settings.pipelinesPaused));
  const pipelines = useSettingsStore(s => s.settings.pipelines);
  const projects = pipelineProjects(pipelines);
  return (
    <>
      <p className={`${HINT} -mt-4`}>{t("auto.help")}</p>
      <Section title={t("auto.sec.running")} rows>
        <Field label={t("set.keepAwake")} id="awake" hint={t("set.keepAwakeHelp")}>
          <Switch id="awake" on={keepAwake} onToggle={saveKeepAwake} />
        </Field>
        <Field label={t("set.autoRetry")} id="retry" hint={t("set.autoRetryHelp")} info={t("set.autoRetryInfo")}>
          <Switch id="retry" on={autoRetry} onToggle={saveAutoRetry} />
        </Field>
      </Section>
      <Section title={t("auto.sec.after")} rows>
        <Field
          label={t("set.captureOnClose")}
          id="capture"
          hint={t("set.captureOnCloseHelp")}
          info={t("set.captureOnCloseInfo")}
        >
          <Switch id="capture" on={captureOnClose} onToggle={saveCaptureOnClose} />
        </Field>
        {/* only about what that capture writes */}
        <Field
          className="pl-8!"
          label={t("set.autoKeepChanges")}
          id="autokeep"
          hint={t("set.autoKeepChangesHelp")}
          info={t("set.autoKeepChangesInfo")}
        >
          <Switch id="autokeep" on={autoKeep} onToggle={saveAutoKeepChanges} />
        </Field>
      </Section>
      <Section title={t("auto.sec.pipelines")} rows>
        <Field label={t("auto.runPipelines")} id="pipes" hint={t("auto.runPipelinesHelp")} info={t("pp.pauseHelp")}>
          <Switch id="pipes" on={run} onToggle={setPipelinesRun} />
        </Field>
        <Field
          label={
            <span className="text-xs text-s-muted">
              {projects.length ? t("auto.pipesOn", { projects: projects.join(" · ") }) : t("auto.pipesNone")}
            </span>
          }
        >
          <button className="text-xs text-accent-text underline" onClick={() => go("projects")}>
            {t("auto.pipesLink")}
          </button>
        </Field>
      </Section>
      <Section title={t("auto.sec.time")} rows>
        <Field
          label={t("set.timeFromSessions")}
          id="time"
          hint={t("set.timeFromSessionsHelp")}
          info={t("set.timeFromSessionsInfo")}
        >
          <Switch id="time" on={timeFromSessions} onToggle={saveTimeFromSessions} />
        </Field>
      </Section>
    </>
  );
}
