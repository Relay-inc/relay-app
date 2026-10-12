import { useEffect, type MouseEvent } from "react";
import { agent } from "../../../shared/plugins";
import { markdownHtml } from "../../../shared/markdown";
import { clockTime, dayMonth } from "../../../shared/format";
import { AGENT_CHANGELOG, agentBehind, releasesSince, type AgentUpdate } from "../../../domain/settings/updates";
import { useSettingsStore } from "../../../application/settings/store";
import { openLink } from "../../../application/settings/window";
import {
  checkAgentUpdates,
  checkUpdates,
  installUpdate,
  updateAgent,
} from "../../../application/settings/updates-page";
import { Glyph } from "../../components/Glyph";
import { useT } from "../../hooks/useT";
import { buttonClass, CODE, EMPTY_LIST, ERROR_MESSAGE, HINT_IN_ROW, OK_MESSAGE, TILE } from "./blocks";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

// the release notes are CHANGELOG.md sections: ### groups, bullets with a bold lead
const NOTES = `grid gap-1.5 text-xs leading-normal text-s-fg [&_h3]:mt-1.5 [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:tracking-wide [&_h3]:text-s-muted [&_h3]:uppercase [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1 [&_ul]:pl-4 [&_a]:underline ${CODE}`;
const ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3 [&+&]:border-t [&+&]:border-s-border";

/** A link in the notes opens in the browser: the settings window never navigates. */
const openNoteLink = (e: MouseEvent) => {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  openLink(a.href);
};

/** Updates: Relay's own (the releases since this version, Install and restart with the download's progress) and the
 *  agent CLIs (installed against npm's latest, Update runs npm, brew or the CLI's own command). Both look again when
 *  the page first shows. */
export function UpdatesPage({ active }: { active: boolean }) {
  const { t, lang, locale } = useT();
  const status = useSettingsStore(s => s.updatesPage.status);
  const checking = useSettingsStore(s => s.updatesPage.checking);
  const progress = useSettingsStore(s => s.updatesPage.progress);
  const message = useSettingsStore(s => s.updatesPage.message);
  const agents = useSettingsStore(s => s.updatesPage.agents);
  useEffect(() => {
    if (!active) return;
    void checkUpdates();
    void checkAgentUpdates();
  }, [active]);
  if (!status) return null;

  const releases = releasesSince(status);
  const checked = status.checked
    ? t("upd.checked", {
        when: `${dayMonth(new Date(status.checked).toISOString(), locale)} ${clockTime(new Date(status.checked).toISOString(), locale)}`,
      })
    : "";
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : null;
  const installed = (agents ?? []).filter(a => a.installed !== null);

  return (
    <>
      <Section
        title="Relay"
        desc={[t("upd.version", { version: status.version }), checked].filter(Boolean).join(" · ")}
        action={
          <button className={buttonClass()} disabled={checking || !!progress} onClick={() => checkUpdates()}>
            {checking ? t("upd.checking") : t("upd.check")}
          </button>
        }
        list
      >
        <div className={ROW}>
          {status.error ? (
            <span className={ERROR_MESSAGE}>{t("upd.failed", { error: status.error })}</span>
          ) : status.latest ? (
            <StatusLine level="warn">{t("upd.available", { version: status.latest })}</StatusLine>
          ) : status.checked ? (
            <StatusLine level="ok">{t("upd.latest", { version: status.version })}</StatusLine>
          ) : (
            <StatusLine level="off">{t("upd.checking")}</StatusLine>
          )}
          <span className="flex-1"></span>
          {status.latest ? (
            progress ? (
              <span className="flex w-48 items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-s-mutedbg">
                  <span className="block h-full bg-s-primary transition-[width]" style={{ width: `${pct ?? 0}%` }} />
                </span>
                <span className={OK_MESSAGE}>{pct === null ? t("upd.downloading") : `${pct}%`}</span>
              </span>
            ) : (
              <button className={buttonClass("primary")} onClick={() => installUpdate()}>
                {t("upd.install")}
              </button>
            )
          ) : null}
          {message ? <span className={`basis-full ${ERROR_MESSAGE}`}>{message.text}</span> : null}
        </div>
        {releases.map(release => (
          <div key={release.version} className="grid gap-2 border-t border-s-border px-3.5 py-3">
            <span className="text-[13px] font-semibold text-s-fg">
              {release.version}
              {release.date ? (
                <span className={`ml-2 font-normal ${OK_MESSAGE}`}>{dayMonth(release.date, locale)}</span>
              ) : null}
            </span>
            {/* CHANGELOG.md of this repo, through the app's safe markdown (raw HTML escaped, web links only) */}
            <div
              className={NOTES}
              onClick={openNoteLink}
              dangerouslySetInnerHTML={{ __html: markdownHtml(release.notes || t("upd.noNotes"), 0, lang) }}
            />
          </div>
        ))}
      </Section>
      <Section
        title={t("set.tab.agents")}
        desc={t("upd.agentsHelp")}
        action={
          <button className={buttonClass()} disabled={!agents} onClick={() => checkAgentUpdates()}>
            {t("upd.check")}
          </button>
        }
        list
      >
        {!agents ? (
          <div className={`${ROW} ${EMPTY_LIST}`}>{t("upd.checking")}</div>
        ) : installed.length ? (
          installed.map(a => <AgentRow key={a.id} update={a} />)
        ) : (
          <div className={`${ROW} ${EMPTY_LIST}`}>{t("upd.noAgents")}</div>
        )}
      </Section>
    </>
  );
}

function AgentRow({ update: a }: { update: AgentUpdate }) {
  const { t } = useT();
  const updating = useSettingsStore(s => s.updatesPage.updating);
  const message = useSettingsStore(s => s.updatesPage.agentMessages[a.id]);
  const provider = agent(a.id);
  const behind = agentBehind(a);
  const version = a.installed || t("upd.noVersion");
  const line = behind
    ? t("upd.agentBehind", { installed: version, latest: a.latest! })
    : a.latest
      ? t("upd.agentLatest", { version })
      : version;
  return (
    <div className={`${ROW} ${a.on ? "" : "opacity-60"}`}>
      {provider ? <Glyph svg={provider.glyph} className={TILE} /> : null}
      <span className="text-[13px] font-semibold text-s-fg">{a.name}</span>
      <StatusLine level={behind ? "warn" : a.latest ? "ok" : "off"}>{line}</StatusLine>
      <span className="flex-1"></span>
      {AGENT_CHANGELOG[a.id] ? (
        <button className={buttonClass("ghost")} onClick={() => openLink(AGENT_CHANGELOG[a.id])}>
          {t("upd.changelog")}
        </button>
      ) : null}
      {behind && a.command ? (
        <button
          className={buttonClass("primary")}
          disabled={!!updating}
          title={a.command}
          onClick={() => updateAgent(a.id)}
        >
          {updating === a.id ? t("upd.updating") : t("upd.update")}
        </button>
      ) : null}
      {behind && !a.command ? <span className={`basis-full ${HINT_IN_ROW}`}>{t("upd.agentManual")}</span> : null}
      {message ? (
        <span className={`basis-full whitespace-pre-wrap ${message.ok ? OK_MESSAGE : ERROR_MESSAGE}`}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
