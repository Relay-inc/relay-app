import { useState } from "react";
import { SETUP_PLATFORMS, setupCommands, type SetupPlatform } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { openLink } from "../../../application/settings/window";
import { setSetupFolder, setSetupMacWay, setSetupPlatform } from "../../../application/settings/machines-page";
import { copyText } from "../../components/copy";
import { Icon } from "../../components/Icon";
import { useT } from "../../hooks/useT";
import { buttonClass, FIELD, HINT_IN_ROW } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Segmented } from "./Segmented";

const RELEASES = "https://github.com/LaurentMe/vault-app/releases/latest";
export const CLAUDE_INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";
// product names, the same in every language
const PLATFORM_NAMES: Record<SetupPlatform, string> = { mac: "Mac", linux: "Linux", unraid: "Unraid" };
const platforms = SETUP_PLATFORMS.map(id => [id, PLATFORM_NAMES[id]] as const);

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

/** Set up a machine: relay-server in Docker with the image of this Relay's version, numbered steps for the kind of
 *  machine picked here (what to prepare, then the commands in the order to run them there), for the folder typed here.
 *  Folded away once a machine is paired. */
export function MachineSetup({ open }: { open: boolean }) {
  const { t } = useT();
  const setup = useSettingsStore(s => s.machinesPage.setup);
  const platform = useSettingsStore(s => s.machinesPage.setupPlatform);
  const folder = useSettingsStore(s => s.machinesPage.setupFolder);
  const macWay = useSettingsStore(s => s.machinesPage.setupMacWay);
  if (!setup) return null;
  const app = platform === "mac" && macWay === "app";
  const commands = setupCommands(setup.image, setup.version, folder, platform);
  return (
    <Section
      title={t("mc.setupTitle")}
      desc={setup.dev ? t("mc.setupHelpDev") : t("mc.setupHelp", { version: setup.version })}
    >
      <details open={open} className="min-w-0">
        <summary className="cursor-pointer text-xs font-medium text-s-fg">{t("mc.setupShow")}</summary>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">
          <Field label={t("mc.setupKind")}>
            <Segmented label={t("mc.setupKind")} options={platforms} value={platform} onPick={setSetupPlatform} />
          </Field>
          {platform === "mac" ? (
            <Segmented
              label={t("mc.setupWay")}
              options={[
                ["app", t("mc.setupWayApp")],
                ["docker", t("mc.setupWayDocker")],
              ]}
              value={macWay}
              onPick={setSetupMacWay}
            />
          ) : null}
          {app ? (
            <>
              <span className={HINT_IN_ROW}>
                1. {t("mc.setupAppGet")}{" "}
                <button className={buttonClass("ghost")} onClick={() => openLink(RELEASES)}>
                  {t("mc.setupAppDownload")}
                </button>
              </span>
              <CommandBlock
                hint={t("mc.setupAppQuarantine")}
                command="xattr -dr com.apple.quarantine /Applications/Relay.app"
              />
              <CommandBlock hint={`2. ${t("mc.setupAppClaude")}`} command={CLAUDE_INSTALL} />
              <span className={HINT_IN_ROW}>3. {t("mc.setupAppSleep")}</span>
              <span className={HINT_IN_ROW}>4. {t("mc.setupAppSwitch")}</span>
              <span className={HINT_IN_ROW}>5. {t("mc.setupAppPair")}</span>
            </>
          ) : (
            <>
              <Field label={t("mc.setupFolder")} hint={t("mc.setupFolderHelp")} id="mcsetupfolder">
                <input
                  className={`${FIELD} font-mono`}
                  id="mcsetupfolder"
                  spellCheck={false}
                  value={folder}
                  onChange={e => setSetupFolder(e.target.value)}
                />
              </Field>
              <span className={HINT_IN_ROW}>1. {t(`mc.setupPrep.${platform}`)}</span>
              <CommandBlock hint={`2. ${t("mc.setupLogin")}`} command={commands.login} />
              <CommandBlock hint={`3. ${t("mc.setupInstall")}`} command={commands.install} />
              <CommandBlock hint={`4. ${t("mc.setupClaude")}`} command={commands.claude} />
              <CommandBlock hint={`5. ${t("mc.setupPair")}`} command={commands.pair} />
            </>
          )}
        </div>
      </details>
    </Section>
  );
}
