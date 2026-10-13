import { useState } from "react";
import type { Machine } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import { connectGithub, disconnectGithub } from "../../../application/settings/machines-page";
import { openLink } from "../../../application/settings/window";
import { dayMonth } from "../../../shared/format";
import { copyText } from "../../components/copy";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW } from "./blocks";
import { CommandBlock } from "./MachineSetup";
import { StatusLine } from "./StatusLine";

/** GitHub on a machine that is online: connecting it with a code typed on GitHub, as whom it is connected and its
 *  commits, Disconnect. `hasRepos`: false for a relay-server from before GitHub there, which only says to update it. */
export function MachineGithub({ machine, hasRepos }: { machine: Machine; hasRepos: boolean }) {
  const { t, locale } = useT();
  const github = useSettingsStore(s => s.machinesPage.github[machine.id]);
  const device = useSettingsStore(s => s.machinesPage.device[machine.id]);
  const message = useSettingsStore(s => s.machinesPage.githubMessages[machine.id]);
  const [confirming, setConfirming] = useState(false);
  const state = github?.state;
  const token = state === "on" || state === "locked";

  const statusLine = !hasRepos ? (
    <StatusLine level="warn">{t("mc.ghOutdated")}</StatusLine>
  ) : !github ? (
    <StatusLine level="off">{t("mc.checking")}</StatusLine>
  ) : state === "on" ? (
    <StatusLine level="ok">
      {github.since
        ? t("mc.ghOnSince", { login: github.login, date: dayMonth(github.since, locale) })
        : t("mc.ghOn", { login: github.login })}
    </StatusLine>
  ) : state === "locked" ? (
    <StatusLine level="warn">{t("mc.ghLocked")}</StatusLine>
  ) : (
    <StatusLine level="off">{t("mc.ghOff")}</StatusLine>
  );
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-s-fg">{t("mc.github")}</span>
      <p className={HINT_IN_ROW}>{t("mc.ghHelp")}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {statusLine}
        <span className="flex-1"></span>
        {hasRepos && github && !token && !device ? (
          <button
            className={buttonClass("primary")}
            onClick={async () => {
              const code = await connectGithub(machine.id);
              if (code) copyText(code.user_code);
            }}
          >
            {t("mc.ghConnect")}
          </button>
        ) : null}
        {token ? (
          confirming ? (
            <>
              <span className="text-xs text-s-muted">{t("mc.ghDisconnectSure")}</span>
              <button
                className={buttonClass("dangerSolid")}
                onClick={() => {
                  setConfirming(false);
                  disconnectGithub(machine.id);
                }}
              >
                {t("mc.ghDisconnect")}
              </button>
              <button className={buttonClass("ghost")} onClick={() => setConfirming(false)}>
                {t("mc.cancel")}
              </button>
            </>
          ) : (
            <button className={buttonClass("danger")} onClick={() => setConfirming(true)}>
              {t("mc.ghDisconnect")}
            </button>
          )
        ) : null}
      </div>
      {state === "on" && github?.name ? (
        <span className={HINT_IN_ROW}>{t("mc.ghCommits", { name: github.name })}</span>
      ) : null}
      {device ? (
        <div className="grid gap-1.5">
          <CommandBlock hint={t("mc.ghCode")} command={device.user_code} />
          <div className="flex flex-wrap items-center gap-3">
            <button className={buttonClass()} onClick={() => openLink(device.verification_uri)}>
              {t("mc.ghOpen")}
            </button>
            <StatusLine level="off">{t("mc.ghWaiting")}</StatusLine>
          </div>
        </div>
      ) : null}
      {message ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
    </div>
  );
}
