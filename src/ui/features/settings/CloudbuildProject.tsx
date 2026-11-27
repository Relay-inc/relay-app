import { useEffect, useState } from "react";
import { cloudProjects, linkCloudbuild } from "../../../application/settings/cloudbuild";
import { useSettingsStore } from "../../../application/settings/store";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { ChangeInput } from "./ChangeInput";
import { ERROR_MESSAGE, FIELD, SELECT } from "./blocks";
import { Field } from "./Field";

/** A project's GCP project and location, in its folded-open row while Cloud Build is on: its triggers show in the
 *  title bar. */
export function CloudbuildProject({ name }: { name: string }) {
  const { t } = useT();
  const on = useSettingsStore(s => s.settings.integrations.cloudbuild?.on === true);
  const ref = useSettingsStore(s => s.settings.cloudbuild?.[name]);
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (on) cloudProjects().then(setOptions, e => setErr(String(e?.message ?? e)));
  }, [on]);
  if (!on) return null;
  const value = ref?.project ?? "";
  // the linked one stays pickable while the list loads or when the login no longer sees it
  const list = options ?? [];
  const shown = value && !list.some(o => o.id === value) ? [{ id: value, name: value }, ...list] : list;
  return (
    <>
      <Field label="Cloud Build" hint={t("cb.projectHelp")}>
        <Select
          className={SELECT}
          aria-label="Cloud Build"
          options={shown}
          value={value}
          empty={options ? t("cb.none") : t("pr.loading")}
          onChange={v => linkCloudbuild(name, v, ref?.location ?? "")}
        />
      </Field>
      {value && (
        <Field label={t("cb.location")} id={`cb-location-${name}`}>
          <ChangeInput
            className={FIELD}
            id={`cb-location-${name}`}
            value={ref?.location ?? "global"}
            onCommit={v => linkCloudbuild(name, value, v)}
            spellCheck={false}
            placeholder="global"
          />
        </Field>
      )}
      {err && <span className={ERROR_MESSAGE}>{err}</span>}
    </>
  );
}
