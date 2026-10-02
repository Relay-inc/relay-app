import type { MailFilter } from "../../../domain/mail/types";
import { useT } from "../../hooks/useT";

const STATE_LABELS = { all: "mail.fAll", unread: "mail.fUnread", read: "mail.fRead" } as const;
const STATES = ["all", "unread", "read"] as const;

/** The inbox's filter bar: search, read state, project, reload. `projects` are [name, display label]. */
export function MailBar({
  className,
  filter,
  projects,
  busy,
  onFilter,
  onReload,
}: {
  className?: string;
  filter: MailFilter;
  projects: [string, string][];
  busy: boolean;
  onFilter: (change: Partial<MailFilter>) => void;
  onReload: () => void;
}) {
  const { t } = useT();
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 mb-3.5">
        <input
          className="field basis-full min-w-0 placeholder:text-tertiary"
          type="search"
          placeholder={t("mail.search")}
          value={filter.q}
          spellCheck={false}
          onChange={e => onFilter({ q: e.target.value })}
        />
        <span className="seg">
          {STATES.map(state => (
            <button key={state} className={filter.state === state ? "on" : ""} onClick={() => onFilter({ state })}>
              {t(STATE_LABELS[state])}
            </button>
          ))}
        </span>
        <select className="field" value={filter.project} onChange={e => onFilter({ project: e.target.value })}>
          <option value="">{t("mail.allProjects")}</option>
          <option value="-">{t("mail.noProject")}</option>
          {projects.map(([name, label]) => (
            <option key={name} value={name}>
              {label}
            </option>
          ))}
        </select>
        <span className="flex-1"></span>
        {busy ? <span className="spinner"></span> : null}
        <button className="btn" onClick={onReload}>
          {t("pr.reload")}
        </button>
      </div>
    </div>
  );
}
