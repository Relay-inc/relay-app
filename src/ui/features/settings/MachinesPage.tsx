import { Fragment, useEffect, useState } from "react";
import type { Machine, SharedVault } from "../../../domain/settings/types";
import { vaultsByMachine } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import {
  checkAll,
  pairMachine,
  pollMachineGit,
  pollMirrors,
  setRunDefault,
  showMachinesPage,
} from "../../../application/settings/machines-page";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, EMPTY_LIST, ERROR_MESSAGE, FIELD, HINT, SELECT } from "./blocks";
import { Field } from "./Field";
import { MachineHost } from "./MachineHost";
import { MachineRow } from "./MachineRow";
import { MachineSetup } from "./MachineSetup";
import { Section } from "./Section";
import { MachineVaults, SharedVaults } from "./SharedVaults";

const NO_MACHINES: Machine[] = [];
const NO_VAULTS: SharedVault[] = [];

/** Machines: other computers in the LAN running relay-server. Pairing, the online check and the project folders on
 *  each machine, the workspaces under the machine that keeps them. Workspaces on top lists the ones on a server
 *  that is not one of these machines (joined with a link) and joins one. The projects are read and every machine is
 *  checked the first time the page shows. */
export function MachinesPage({ active }: { active: boolean }) {
  const { t, th } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const sharedVaults = useSettingsStore(s => s.settings.sharedVaults ?? NO_VAULTS);
  const vaults = vaultsByMachine(machines, sharedVaults);
  const pairing = useSettingsStore(s => s.machinesPage.pairing);
  const pairError = useSettingsStore(s => s.machinesPage.pairError);
  const runDefault = useSettingsStore(s => s.settings.machines_default ?? "");
  const [runDefaultError, setRunDefaultError] = useState("");
  const [line, setLine] = useState("");
  const [name, setName] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  // where conversations may run: not on a machine for shared vaults only
  const runners = machines.filter(machine => !machine.sharedOnly);
  useEffect(() => {
    if (active) showMachinesPage();
  }, [active]);
  // the mirror status of the machines, every second while the page shows (the progress bar), GitHub and the repos
  // there every 10 seconds
  const mirrored = machines.length > 0;
  useEffect(() => {
    if (!active || !mirrored) return;
    pollMirrors();
    const timer = setInterval(pollMirrors, 1000);
    const slow = setInterval(pollMachineGit, 10_000);
    return () => {
      clearInterval(timer);
      clearInterval(slow);
    };
  }, [active, mirrored]);

  // a machine that paired clears the fields; a failed pairing keeps them to fix
  const pair = async () => {
    if (!(await pairMachine(line.trim(), name.trim(), sharedOnly))) return;
    setLine("");
    setName("");
    setSharedOnly(false);
  };
  return (
    <>
      <Html as="p" className={HINT} html={th("mc.intro")} />
      {/* first, so an invite link that opened Relay shows its join form without scrolling */}
      <SharedVaults vaults={vaults.elsewhere} />
      {runners.length ? (
        <Section title={t("mc.runDefaultTitle")}>
          <Field label={t("mc.runDefault")} hint={t("mc.runDefaultHelp")} id="mcdefault">
            <select
              className={SELECT}
              id="mcdefault"
              value={runDefault}
              onChange={async e => setRunDefaultError(await setRunDefault(e.target.value))}
            >
              <option value="">{t("composer.thisMac")}</option>
              {runners.map(machine => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>
          </Field>
          {runDefaultError ? <span className={ERROR_MESSAGE}>{runDefaultError}</span> : null}
        </Section>
      ) : null}
      <MachineSetup open={!machines.length} />
      <MachineHost />
      <Section title={t("mc.pairTitle")}>
        <Field label={t("mc.line")} hint={<Html html={th("mc.lineHelp")} />} id="mcline">
          <input
            className={FIELD}
            id="mcline"
            placeholder="relay://192.168.1.2:47800#fp=…&code=…"
            spellCheck={false}
            value={line}
            onChange={e => setLine(e.target.value)}
          />
        </Field>
        <Field label={t("mc.name")} id="mcname">
          <input
            className={FIELD}
            id="mcname"
            placeholder={t("mc.namePh")}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </Field>
        <Field label={t("mc.sharedOnly")} id="mcshared">
          <input id="mcshared" type="checkbox" checked={sharedOnly} onChange={e => setSharedOnly(e.target.checked)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          {pairError ? <span className={ERROR_MESSAGE}>{pairError}</span> : null}
          <span className="flex-1"></span>
          <button className={buttonClass("primary")} disabled={pairing || !line.trim()} onClick={pair}>
            {pairing ? t("mc.pairing") : t("mc.pair")}
          </button>
        </div>
      </Section>
      <Section
        title={t("set.tab.machines")}
        list
        action={
          <button className={buttonClass("ghost")} onClick={checkAll}>
            {t("mc.refresh")}
          </button>
        }
      >
        {machines.length ? (
          machines.map(machine => (
            <Fragment key={machine.id}>
              <MachineRow machine={machine} />
              <MachineVaults machine={machine} vaults={vaults.on[machine.id]} />
            </Fragment>
          ))
        ) : (
          <div className={`${EMPTY_LIST} px-3.5`}>{t("mc.empty")}</div>
        )}
      </Section>
    </>
  );
}
