import { useEffect, useState } from "react";
import { suggest, type AikidoRepo } from "../../../domain/aikido/rules";
import { aikidoRepos, linkAikido } from "../../../application/settings/aikido";
import { useSettingsStore } from "../../../application/settings/store";
import { Icon as AppIcon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { useT } from "../../hooks/useT";
import { BUTTON_GLYPH, buttonClass, ERROR_MESSAGE, SELECT } from "./blocks";
import { Field } from "./Field";

/** A project's Aikido code repos (a project often has more than one: a frontend and a backend), in its card while
 *  Aikido is on: their open issues show in the project's Security panel. Repos named like the project's GitHub repos
 *  are offered first. */
export function AikidoProject({ name }: { name: string }) {
  const { t } = useT();
  const on = useSettingsStore(s => s.settings.integrations.aikido?.on === true);
  const linked = useSettingsStore(s => s.settings.aikido?.[name]) ?? [];
  const slugs = useSettingsStore(s => s.projectsPage.repos[name]) ?? [];
  const [repos, setRepos] = useState<AikidoRepo[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (on) aikidoRepos().then(setRepos, e => setErr(String(e?.message ?? e)));
  }, [on]);
  if (!on) return null;
  const list = repos ?? [];
  const label = (id: number) => list.find(r => r.id === id)?.name ?? `#${id}`;
  const offered = suggest(list, slugs).filter(id => !linked.includes(id));
  const rest = list.filter(r => !linked.includes(r.id));
  return (
    <>
      <Field label="Aikido" hint={t("ak.projectHelp")} wrap>
        <Select
          className={SELECT}
          aria-label={t("ak.addRepo")}
          options={rest.map(r => ({ id: String(r.id), name: `${r.name} · ${r.provider}` }))}
          value=""
          empty={repos ? t("ak.addRepo") : t("pr.loading")}
          onChange={v => v && linkAikido(name, [...linked, Number(v)])}
        />
      </Field>
      {(linked.length > 0 || offered.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {linked.map(id => (
            <span
              key={id}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-s-border pr-1 pl-2.5 font-mono text-xs text-s-fg"
            >
              {label(id)}
              <button
                className={`${buttonClass("ghost", true)} size-6`}
                title={t("ak.removeRepo", { repo: label(id) })}
                aria-label={t("ak.removeRepo", { repo: label(id) })}
                onClick={() =>
                  linkAikido(
                    name,
                    linked.filter(x => x !== id),
                  )
                }
              >
                <AppIcon name="close" className={`${BUTTON_GLYPH} size-3.5`} />
              </button>
            </span>
          ))}
          {offered.length > 0 && (
            <button className={buttonClass()} onClick={() => linkAikido(name, [...linked, ...offered])}>
              {t("ak.addSuggested", { list: offered.map(label).join(", ") })}
            </button>
          )}
        </div>
      )}
      {err && <span className={ERROR_MESSAGE}>{err}</span>}
    </>
  );
}
