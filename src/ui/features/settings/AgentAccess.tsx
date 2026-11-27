import { useEffect, type ReactNode } from "react";
import { accessSummary, loadActions, showAccess } from "../../../application/settings/actions";
import { useSettingsStore } from "../../../application/settings/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Field } from "./Field";
import { Section } from "./Section";

/** "Change in Privacy & access →" and the like: a link in a row */
export const LINK =
  "text-xs text-accent-text hover:underline focus-visible:ring-2 ring-s-ring focus-visible:outline-none";

/** An integration's Agent access: one summary row of what agents may do with it, and a link to where that is set (its
 *  row on Privacy & access, unfolded). `children`: more rows in the card. Nothing until the actions are read. */
export function AgentAccess({ ext, name, children }: { ext: string; name: string; children?: ReactNode }) {
  const { t } = useT();
  const has = useSettingsStore(s => s.actions.list.some(action => action.ext === ext));
  const summary = useDerived(() => accessSummary(ext));
  useEffect(() => {
    loadActions();
  }, []);
  if (!has) return null;
  return (
    <Section title={t("act.title")} rows>
      <Field
        label={t("act.agentsMay", { name })}
        hint={ext === "mail" ? `${summary} · ${t("act.claudeOnly")}` : summary}
      >
        <button className={LINK} onClick={() => showAccess(ext)}>
          {t("act.change")}
        </button>
      </Field>
      {children}
    </Section>
  );
}
