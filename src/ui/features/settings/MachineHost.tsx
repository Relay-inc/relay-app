import { useSettingsStore } from "../../../application/settings/store";
import { makeHostLine, setHost } from "../../../application/settings/machines-page";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW } from "./blocks";
import { Field } from "./Field";
import { CLAUDE_INSTALL, CommandBlock } from "./MachineSetup";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";
import { Switch } from "./Switch";

/** This Mac as a machine: Relay's own relay-server under a LaunchAgent, so another Mac can run conversations here.
 *  A switch, whether it runs, whether Claude Code is ready here, and a pairing line for the other Mac. */
export function MachineHost() {
  const { t } = useT();
  const host = useSettingsStore(s => s.machinesPage.host);
  const line = useSettingsStore(s => s.machinesPage.hostLine);
  const error = useSettingsStore(s => s.machinesPage.hostError);
  const claude = useSettingsStore(s => s.agentsPage.detected?.providers.find(p => p.id === "claude")?.detect);
  if (!host) return null;
  return (
    <Section title={t("mc.hostTitle")} desc={t("mc.hostHelp")}>
      <Field label={t("mc.hostSwitch")} hint={host.supported ? undefined : t("mc.hostUnsupported")} id="mchost">
        {host.supported || host.on ? <Switch id="mchost" on={host.on} onToggle={setHost} /> : null}
      </Field>
      {host.on ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLine level={host.running ? "ok" : "warn"}>
            {t(host.running ? "mc.hostRunning" : "mc.hostStopped")}
          </StatusLine>
          <StatusLine level={host.ram ? "ok" : "warn"}>{t(host.ram ? "mc.hostRam" : "mc.hostDisk")}</StatusLine>
        </div>
      ) : null}
      {claude && !claude.installed ? (
        <CommandBlock hint={t("mc.hostClaudeMissing")} command={CLAUDE_INSTALL} />
      ) : claude && claude.loggedIn === false ? (
        <span className={HINT_IN_ROW}>{t("mc.hostClaudeLogin")}</span>
      ) : null}
      {host.running ? (
        <>
          <div>
            <button className={buttonClass("primary")} onClick={makeHostLine}>
              {t("mc.hostPair")}
            </button>
          </div>
          {line ? <CommandBlock hint={t("mc.hostPairHelp")} command={line} /> : null}
        </>
      ) : null}
      {error ? <span className={ERROR_MESSAGE}>{error}</span> : null}
      {host.on ? (
        <span className={HINT_IN_ROW}>
          {host.clients.length ? `${t("mc.hostClients")} ${host.clients.join(", ")}` : t("mc.hostNoClients")}
        </span>
      ) : null}
    </Section>
  );
}
