import { useEffect } from "react";
import type { Key } from "../../../shared/i18n";
import type { Policy } from "../../../domain/settings/types";
import { loadActions, setAction } from "../../../application/settings/actions";
import { useSettingsStore } from "../../../application/settings/store";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";
import { Section } from "./Section";
import { Switch } from "./Switch";

const POLICIES: Policy[] = ["auto", "ask", "deny"];

/** Agent access for one extension (`ext`, called `name`): whether agents may use it through `relay` at all, and per
 *  action whether it runs, asks first or never runs. Read again whenever it mounts. */
export function ActionsSection({ ext, name }: { ext: string; name: string }) {
  const { t } = useT();
  const list = useSettingsStore(s => s.actions.list);
  const entry = useSettingsStore(s => s.actions.entries[ext]);
  const error = useSettingsStore(s => s.actions.errors[ext] || s.actions.errors[""] || "");
  useEffect(() => {
    loadActions();
  }, []);
  const actions = list.filter(action => action.ext === ext);
  // nothing to show still takes its place in the page's column, as the Lit element did
  if (!actions.length && !error) return <div />;
  const on = entry?.access !== false;
  const inherited = entry?.["*"] as Policy | undefined;
  return (
    <Section
      title={t("act.title")}
      desc={t("act.help", { name })}
      footer={error ? <span className={ERROR_MESSAGE}>{error}</span> : null}
    >
      <Field label={t("act.access", { name })} id={`acc-${ext}`} hint={ext === "mail" ? t("act.mailOnly") : undefined}>
        <Switch id={`acc-${ext}`} on={on} onToggle={value => setAction(ext, "access", value)} />
      </Field>
      {on &&
        actions.map(action => {
          const id = `act-${action.id}`;
          const policy = inherited || action.default;
          return (
            <Field
              key={action.id}
              label={<code className="text-xs">{`${ext}.${action.id}`}</code>}
              id={id}
              hint={action.about}
            >
              <Select
                className={SELECT}
                id={id}
                empty={t("act.default", { p: t(`act.${policy}` as Key) })}
                options={POLICIES.map(value => ({ id: value, name: t(`act.${value}` as Key) }))}
                value={String(entry?.[action.id] ?? "")}
                onChange={value => setAction(ext, action.id, value)}
              />
            </Field>
          );
        })}
    </Section>
  );
}
