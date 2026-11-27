import { useEffect } from "react";
import type { Key } from "../../../shared/i18n";
import { isMac } from "../../../shared/platform";
import {
  loadPermissions,
  openPermission,
  PERMISSIONS,
  usePermissionsStore,
} from "../../../application/settings/permissions";
import { useT } from "../../hooks/useT";
import { buttonClass } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { StatusLine } from "./StatusLine";

const LEVEL = { ok: "ok", missing: "warn", ask: "off", unknown: "off" } as const;

/** What macOS lets Relay do, one row each: its state (macOS does not tell for some: "Can't be checked"), and a button
 *  to its pane in System Settings only where it is not allowed or cannot be checked. On Windows only the microphone
 *  asks, the rest has no switch there. */
export function PermissionsSection({ active }: { active: boolean }) {
  const { t } = useT();
  const states = usePermissionsStore(s => s.states);
  // before the first answer there is nothing to say yet
  const known = Object.keys(states).length > 0;
  // switched in System Settings, so asked again every 2 s while the page shows
  useEffect(() => {
    if (!active) return;
    loadPermissions();
    const timer = setInterval(loadPermissions, 2000);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <Section title={t("perm.title")} desc={t(isMac() ? "perm.help" : "perm.helpWin")} rows>
      {(isMac() ? PERMISSIONS : (["microphone"] as const)).map(which => {
        const state = states[which] ?? (known ? "unknown" : null);
        return (
          <Field key={which} label={t(`perm.${which}` as Key)} hint={t(`perm.${which}Help` as Key)}>
            {state && <StatusLine level={LEVEL[state]}>{t(`perm.state.${state}` as Key)}</StatusLine>}
            {state !== "ok" && (
              <button className={buttonClass()} onClick={() => openPermission(which)}>
                {t(isMac() ? "perm.open" : "perm.openWin")}
              </button>
            )}
          </Field>
        );
      })}
    </Section>
  );
}
