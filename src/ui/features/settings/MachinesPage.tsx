import { useEffect, useState } from "react";
import type { Machine } from "../../../domain/settings/types";
import { useSettingsStore } from "../../../application/settings/store";
import {
  checkAll,
  pairMachine,
  pollMirrors,
  setRunDefault,
  showMachinesPage,
} from "../../../application/settings/machines-page";
import { Html } from "../../components/Html";
import { useT } from "../../hooks/useT";
import { buttonClass, EMPTY_LIST, ERROR_MESSAGE, FIELD, HINT, SELECT } from "./blocks";
import { Field } from "./Field";
import { MachineRow } from "./MachineRow";
import { Section } from "./Section";

const NO_MACHINES: Machine[] = [];

/** Machines: other computers in the LAN running relay-server. Pairing, the online check and the project folders on
 *  each machine. The projects are read and every machine is checked the first time the page shows. */
export function MachinesPage({ active }: { active: boolean }) {
  const { t, th } = useT();
  const machines = useSettingsStore(s => s.settings.machines ?? NO_MACHINES);
  const pairing = useSettingsStore(s => s.machinesPage.pairing);
  const pairError = useSettingsStore(s => s.machinesPage.pairError);
  const runDefault = useSettingsStore(s => s.settings.machines_default ?? "");
  const [runDefaultError, setRunDefaultError] = useState("");
  const [line, setLine] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (active) showMachinesPage();
  }, [active]);
  // the mirror status of the machines that have it on, every second while the page shows (the progress bar)
  const mirrored = machines.some(machine => machine.mirror?.on);
  useEffect(() => {
    if (!active || !mirrored) return;
    pollMirrors();
    const timer = setInterval(pollMirrors, 1000);
    return () => clearInterval(timer);
  }, [active, mirrored]);

  // a machine that paired clears the fields; a failed pairing keeps them to fix
  const pair = async () => {
    if (!(await pairMachine(line.trim(), name.trim()))) return;
    setLine("");
    setName("");
  };
  return (
    <>
      <Html as="p" className={HINT} html={th("mc.intro")} />
      {machines.length ? (
        <Section title={t("mc.runDefaultTitle")}>
          <Field label={t("mc.runDefault")} hint={t("mc.runDefaultHelp")} id="mcdefault">
            <select
              className={SELECT}
              id="mcdefault"
              value={runDefault}
              onChange={async e => setRunDefaultError(await setRunDefault(e.target.value))}
            >
              <option value="">{t("composer.thisMac")}</option>
              {machines.map(machine => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>
          </Field>
          {runDefaultError ? <span className={ERROR_MESSAGE}>{runDefaultError}</span> : null}
        </Section>
      ) : null}
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
          machines.map(machine => <MachineRow key={machine.id} machine={machine} />)
        ) : (
          <div className={EMPTY_LIST}>{t("mc.empty")}</div>
        )}
      </Section>
    </>
  );
}
