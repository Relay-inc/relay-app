import { useState } from "react";
import type { Machine } from "../../../domain/settings/types";
import { setupCommands } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { forgetMachine } from "../../../application/settings/machines-page";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW, PILL } from "./blocks";
import { MachineMirror } from "./MachineMirror";
import { CommandBlock } from "./MachineSetup";
import { StatusLine } from "./StatusLine";

/** A paired machine on Settings › Machines: its name, address, whether it is online and its fingerprint, Forget (with
 *  how to revoke it on the machine) and its mirror. */
export function MachineRow({ machine }: { machine: Machine }) {
  const { t, th } = useT();
  const status = useSettingsStore(s => s.machinesPage.status[machine.id]);
  const message = useSettingsStore(s => s.machinesPage.messages[machine.id]);
  const setup = useSettingsStore(s => s.machinesPage.setup);
  const setupFolder = useSettingsStore(s => s.machinesPage.setupFolder);
  const [confirming, setConfirming] = useState(false);

  const statusLine =
    !status || status === "checking" ? (
      <StatusLine level="off">{t("mc.checking")}</StatusLine>
    ) : status.outdated ? (
      <StatusLine level="warn">{t(status.outdated === "server" ? "mc.outdatedServer" : "mc.outdatedApp")}</StatusLine>
    ) : !status.ok ? (
      <StatusLine level="warn">{t("mc.offline")}</StatusLine>
    ) : (
      <StatusLine level="ok">{[t("mc.online"), status.version, status.os].filter(Boolean).join(" · ")}</StatusLine>
    );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 border-b border-s-border px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-s-fg">{machine.name}</span>
        <span className="font-mono text-xs text-s-muted">
          {machine.host}:{machine.port}
        </span>
        {statusLine}
        <span className={`${PILL} font-mono`} title={t("mc.fingerprint")}>
          {(machine.fp ?? "").slice(0, 16)}
        </span>
        <span className="flex-1"></span>
        {confirming ? (
          <>
            <span className="text-xs text-s-muted">{t("mc.forgetSure")}</span>
            <button
              className={buttonClass("dangerSolid")}
              onClick={() => {
                setConfirming(false);
                forgetMachine(machine.id);
              }}
            >
              {t("mc.forget")}
            </button>
            <button className={buttonClass("ghost")} onClick={() => setConfirming(false)}>
              {t("mc.cancel")}
            </button>
          </>
        ) : (
          <button className={buttonClass("danger")} onClick={() => setConfirming(true)}>
            {t("mc.forget")}
          </button>
        )}
      </div>
      {confirming ? <Html as="p" className={HINT_IN_ROW} html={th("mc.forgetHelp", { name: machine.name })} /> : null}
      {status && status !== "checking" && status.outdated === "server" && setup ? (
        <CommandBlock
          hint={t("mc.updateHelp")}
          command={setupCommands(setup.image, setup.version, setupFolder).update}
        />
      ) : null}
      {message ? <span className={ERROR_MESSAGE}>{message.text}</span> : null}
      <MachineMirror machine={machine} />
    </div>
  );
}
