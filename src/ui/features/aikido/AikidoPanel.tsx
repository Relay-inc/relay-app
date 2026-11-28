import { useEffect, useState } from "react";
import { isAlarm, placeOf, typeLabel, type Group, type Severity } from "../../../domain/aikido/rules";
import {
  fixAllWithClaude,
  fixWithClaude,
  loadAikido,
  loadIssues,
  markSeen,
  openInAikido,
  repoName,
  useAikidoStore,
} from "../../../application/aikido/aikido";
import { useSettingsStore } from "../../../application/settings/store";
import { dayMonth, relativeFormat } from "../../../shared/format";
import { useT } from "../../hooks/useT";

// critical and high in the overdue red, medium in the today orange, low quiet (DESIGN.md › Colour)
const DOT: Record<Severity, string> = {
  critical: "bg-late",
  high: "bg-late",
  medium: "bg-soon",
  low: "bg-tertiary",
};
const SEVERITY = {
  critical: "ak.sev.critical",
  high: "ak.sev.high",
  medium: "ak.sev.medium",
  low: "ak.sev.low",
} as const;
const NONE: number[] = [];
const day = (seconds: number, locale: string) => dayMonth(new Date(seconds * 1000).toISOString(), locale);

/** The Security panel of a vault project, the content of the drawer's Security tab: the open Aikido issue groups of
 *  its linked code repos, worst first, filtered per repo; one row unfolds at a time with where it is, how to fix it and
 *  "Fix met Claude". Showing it loads (at most every 5 minutes) and marks what it lists as seen. */
export function AikidoPanel({ project }: { project: string }) {
  const { t, tn, locale } = useT();
  const linked = useSettingsStore(s =>
    s.settings.integrations.aikido?.on === true ? (s.settings.aikido?.[project] ?? NONE) : NONE,
  );
  const state = useAikidoStore(s => s.projects[project]);
  const repos = useAikidoStore(s => s.repos);
  const [repo, setRepo] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const groups = state?.groups;
  useEffect(() => {
    loadAikido(project);
  }, [project, linked.length]);
  useEffect(() => {
    if (groups) markSeen(project);
  }, [project, groups]);

  if (!linked.length) return <p className="px-4 py-3.5 text-secondary">{t("ak.notLinked")}</p>;

  const shown = (groups ?? []).filter(g => repo === null || g.repos.includes(repo));
  const name = (id: number) => repoName(id, repos?.list);
  const scanned = Math.max(0, ...(repos?.list ?? []).filter(r => linked.includes(r.id)).map(r => r.scanned));
  const alarmRepos = (repo === null ? linked : [repo]).filter(id =>
    shown.some(g => isAlarm(g) && g.repos.includes(id)),
  );
  const chip = (on: boolean) =>
    `h-6.5 rounded-full px-2.5 text-xs ${on ? "bg-fill-2 text-label" : "border border-separator-strong text-secondary hover:bg-fill"}`;

  return (
    <div className="-m-3 flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pt-3.5 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{t("ak.open", { n: groups?.length ?? 0 })}</span>
          {scanned > 0 && (
            <span className="text-xs text-secondary">{t("ak.scanned", { when: ago(scanned, locale) })}</span>
          )}
        </div>
        {linked.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("ak.repos")}>
            <button className={chip(repo === null)} aria-pressed={repo === null} onClick={() => setRepo(null)}>
              {t("ak.allRepos")}
            </button>
            {linked.map(id => (
              <button key={id} className={chip(repo === id)} aria-pressed={repo === id} onClick={() => setRepo(id)}>
                {name(id)} {(groups ?? []).filter(g => g.repos.includes(id)).length}
              </button>
            ))}
          </div>
        )}
        {state?.err && <p className="text-xs text-secondary">{state.err}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {!groups ? (
          <p className="px-2 py-2.5 text-secondary">{state?.err ? "" : t("pr.loading")}</p>
        ) : !shown.length ? (
          <p className="px-2 py-2.5 text-secondary">{t("ak.none")}</p>
        ) : (
          shown.map(g => (
            <Row
              key={g.id}
              project={project}
              group={g}
              repos={g.repos.filter(id => linked.includes(id)).map(name)}
              open={open === g.id}
              onToggle={() => setOpen(open === g.id ? null : g.id)}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-separator px-4 py-2.5">
        <span className="text-xs text-secondary">{t("ak.codeOnly")}</span>
        <button
          className="h-7 rounded-lg border border-separator-strong bg-raised px-3 text-xs hover:bg-fill disabled:opacity-50"
          disabled={!alarmRepos.length}
          title={tn("ak.fixAllHelp", alarmRepos.length)}
          onClick={async () => {
            for (const id of alarmRepos) await fixAllWithClaude(project, id);
          }}
        >
          {t("ak.fixAll")}
        </button>
      </div>
    </div>
  );
}

/** "2 u geleden": how long ago, in minutes, hours or days. */
function ago(seconds: number, locale: string) {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  const f = relativeFormat(locale, { numeric: "auto", style: "short" });
  if (minutes < 60) return f.format(-minutes, "minute");
  if (minutes < 48 * 60) return f.format(-Math.round(minutes / 60), "hour");
  return f.format(-Math.round(minutes / 1440), "day");
}

/** One issue group: its dot, title and a meta line; unfolded, where it is (its issues' files and lines, loaded then),
 *  how to fix it, and the two actions. */
function Row({
  project,
  group,
  repos,
  open,
  onToggle,
}: {
  project: string;
  group: Group;
  repos: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t, locale } = useT();
  const issues = useAikidoStore(s => s.issues[group.id]);
  useEffect(() => {
    if (open) loadIssues(group.id).catch(() => {});
  }, [open, group.id]);
  const sla = Math.min(...(issues ?? []).map(i => i.sla).filter(Boolean));
  const file = issues?.find(i => i.file)?.file;
  const meta = [
    t(SEVERITY[group.severity]),
    typeLabel(group.type),
    repos.join(", "),
    ...(open
      ? [
          group.since ? t("ak.since", { date: day(group.since, locale) }) : "",
          Number.isFinite(sla) ? t("ak.sla", { date: day(sla, locale) }) : "",
        ]
      : [file ?? ""]),
  ].filter(Boolean);
  const places = issues?.length ? issues.map(placeOf).filter(Boolean) : group.locations;
  const head = (
    <button
      className={`flex w-full gap-2.5 text-left ${open ? "" : "rounded-lg px-2 py-2.25 hover:bg-fill"}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={`mt-1.25 size-2 flex-none rounded-full ${DOT[group.severity]}`} aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={open ? "font-medium" : ""}>{group.title}</span>
        <span className="text-xs text-secondary">{meta.join(" · ")}</span>
      </span>
    </button>
  );
  if (!open) return head;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg bg-fill px-2 pt-2.5 pb-3">
      {head}
      {places.length > 0 && (
        <div className="ml-4.5 flex flex-col gap-0.5 rounded-md border border-separator bg-raised px-2 py-1.5 font-mono text-xs break-all text-secondary">
          {places.map((place, i) => (
            <span key={i}>{place}</span>
          ))}
        </div>
      )}
      {group.howToFix && <p className="ml-4.5 leading-normal whitespace-pre-line">{group.howToFix}</p>}
      <div className="ml-4.5 flex gap-1.5">
        <button
          className="h-7 rounded-lg bg-accent px-3 text-xs font-medium text-on-accent hover:bg-accent-hover"
          onClick={() => fixWithClaude(project, group.id)}
        >
          {t("ak.fix")}
        </button>
        <button
          className="h-7 rounded-lg border border-separator-strong px-2.5 text-xs text-label hover:bg-fill-2"
          onClick={openInAikido}
        >
          {t("ak.openInAikido")}
        </button>
      </div>
    </div>
  );
}
