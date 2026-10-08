import { useEffect } from "react";
import type { Key } from "../../../shared/i18n";
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

const LEVEL = { ok: "ok", missing: "warn", ask: "off" } as const;

/** What macOS lets Relay do, one row each: its state when macOS tells it, and a button to its pane in System Settings. */
export function PermissionsSection({ active }: { active: boolean }) {
  const { t } = useT();
  const states = usePermissionsStore(s => s.states);
  // switched in System Settings, so asked again every 2 s while the page shows
  useEffect(() => {
    if (!active) return;
    loadPermissions();
    const timer = setInterval(loadPermissions, 2000);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <Section title={t("perm.title")} desc={t("perm.help")} rows>
      {PERMISSIONS.map(which => {
        const state = states[which];
        return (
          <Field key={which} label={t(`perm.${which}` as Key)} hint={t(`perm.${which}Help` as Key)}>
            {state && <StatusLine level={LEVEL[state]}>{t(`perm.state.${state}` as Key)}</StatusLine>}
            <button className={buttonClass()} onClick={() => openPermission(which)}>
              {t("perm.open")}
            </button>
          </Field>
        );
      })}
    </Section>
  );
}
