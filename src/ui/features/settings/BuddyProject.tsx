import { useEffect, useState } from "react";
import { buddyProjects, linkBuddy } from "../../../application/settings/buddy";
import { useSettingsStore } from "../../../application/settings/store";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ERROR_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";

/** A project's Buddy project, in its folded-open row while Buddy is on: its pipelines show in the title bar. */
export function BuddyProject({ name }: { name: string }) {
  const { t } = useT();
  const on = useSettingsStore(s => s.settings.integrations.buddy?.on === true);
  const ref = useSettingsStore(s => s.settings.buddy?.[name]);
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (on) buddyProjects().then(setOptions, e => setErr(String(e?.message ?? e)));
  }, [on]);
  if (!on) return null;
  const value = ref ? `${ref.workspace}/${ref.project}` : "";
  // the linked one stays pickable while the list loads or when the token no longer sees it
  const list = options ?? [];
  const shown = value && !list.some(o => o.id === value) ? [{ id: value, name: value }, ...list] : list;
  return (
    <>
      <Field label="Buddy" hint={t("bd.projectHelp")}>
        <Select
          className={SELECT}
          aria-label="Buddy"
          options={shown}
          value={value}
          empty={options ? t("bd.none") : t("pr.loading")}
          onChange={v => linkBuddy(name, v)}
        />
      </Field>
      {err && <span className={ERROR_MESSAGE}>{err}</span>}
    </>
  );
}
