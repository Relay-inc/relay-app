import { useState } from "react";
import { setupCommands } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { setSetupFolder } from "../../../application/settings/machines-page";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { FIELD, HINT_IN_ROW } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";

/** Commands to run on a machine, with a button that copies them. */
export function CommandBlock({ hint, command }: { hint: string; command: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    // the block scrolls sideways itself: a long command never widens the page
    <div className="grid min-w-0 grid-cols-1 gap-1">
      <span className={HINT_IN_ROW}>{hint}</span>
      <div className="relative min-w-0">
        <pre className="overflow-x-auto rounded-lg bg-fill px-3 py-2 pr-10 font-mono text-xs leading-relaxed text-s-fg">
          {command}
        </pre>
        <button
          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md hover:bg-fill-2"
          aria-label={copied ? t("mc.copied") : t("mc.copy")}
          title={copied ? t("mc.copied") : t("mc.copy")}
          onClick={() => {
            copyText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          <Icon name={copied ? "check" : "copy"} className="glyph size-3.5 stroke-2" />
        </button>
      </div>
    </div>
  );
}

/** Set up a machine: relay-server in Docker with the image of this Relay's version, the commands in the order to run
 *  them on the machine, for the folder typed here. Folded away once a machine is paired. */
export function MachineSetup({ open }: { open: boolean }) {
  const { t } = useT();
  const setup = useSettingsStore(s => s.machinesPage.setup);
  const folder = useSettingsStore(s => s.machinesPage.setupFolder);
  if (!setup) return null;
  const commands = setupCommands(setup.image, setup.version, folder);
  return (
    <Section title={t("mc.setupTitle")} desc={t("mc.setupHelp", { version: setup.version })}>
      <details open={open} className="min-w-0">
        <summary className="cursor-pointer text-xs font-medium text-s-fg">{t("mc.setupShow")}</summary>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">
          <Field label={t("mc.setupFolder")} hint={t("mc.setupFolderHelp")} id="mcsetupfolder">
            <input
              className={`${FIELD} font-mono`}
              id="mcsetupfolder"
              spellCheck={false}
              value={folder}
              onChange={e => setSetupFolder(e.target.value)}
            />
          </Field>
          <CommandBlock hint={t("mc.setupLogin")} command={commands.login} />
          <CommandBlock hint={t("mc.setupInstall")} command={commands.install} />
          <CommandBlock hint={t("mc.setupClaude")} command={commands.claude} />
          <CommandBlock hint={t("mc.setupPair")} command={commands.pair} />
        </div>
      </details>
    </Section>
  );
}
