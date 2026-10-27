import type { VaultCount } from "../../../domain/usage/types";
import { noteKey } from "../../../domain/navigation/keys";
import { openDetail } from "../../../application/navigation/panel";
import { useUsageStore } from "../../../application/usage/store";
import { num } from "../../../application/usage/usage";
import { useT } from "../../hooks/useT";
import { UsageRow } from "./UsageRow";

const CARD = "flex flex-col rounded-xl border border-separator bg-raised";
const LABEL = "m-0 text-[11px] font-semibold tracking-wider uppercase text-tertiary";
const NOTE = "text-sm text-secondary";
const STATS = ["read", "write", "edit", "search"] as const;

/** The usage view's Vault tab: what the agents' tool calls did in this vault, this week and today, the notes they
 *  read and changed most, and the week per folder. A note opens in the drawer on a click. */
export function VaultUsage() {
  const { t, locale } = useT();
  const vault = useUsageStore(s => s.tokens?.vault);
  const tokensError = useUsageStore(s => s.tokensError);
  if (!vault) return <p className={NOTE}>{tokensError || t("usage.vaultReading")}</p>;
  const week: VaultCount = vault.week;
  if (!week.read && !week.write && !week.edit && !week.search) return <p className={NOTE}>{t("usage.vaultNone")}</p>;

  const top = (title: string, list: { path: string; n: number }[]) => (
    <div className={`${CARD} px-4 pt-3 pb-1`}>
      <span className={`${LABEL} mb-1`}>{title}</span>
      {list.length ? (
        list.map(x => {
          const slash = x.path.lastIndexOf("/");
          return (
            <button
              key={x.path}
              className="flex items-center gap-3 py-2 border-t border-separator first-of-type:border-t-0 text-left hover:text-accent-text"
              title={x.path}
              onClick={() => openDetail(noteKey(x.path))}
            >
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="truncate text-sm">{x.path.slice(slash + 1).replace(/\.md$/, "")}</span>
                {slash > 0 && <span className="truncate text-[11px] text-tertiary">{x.path.slice(0, slash)}</span>}
              </span>
              <span className="text-sm font-medium tabular-nums">{num(x.n, locale)}</span>
            </button>
          );
        })
      ) : (
        <p className={`${NOTE} pb-3`}>–</p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-3">
        {STATS.map(k => (
          <div key={k} className={`${CARD} gap-1.5 px-4 py-3.5`}>
            <span className={LABEL}>{t(`usage.vault.${k}`)}</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{num(week[k], locale)}</span>
            <span className="text-xs text-secondary tabular-nums">
              {t("usage.vaultToday", { n: num(vault.today[k], locale) })}
            </span>
          </div>
        ))}
      </div>
      <p className={`${NOTE} -mt-2`}>
        {t("usage.vaultNotes", { week: num(week.notes, locale), today: num(vault.today.notes, locale) })}
      </p>
      <div className="grid grid-cols-2 gap-3 items-start">
        {top(t("usage.vaultReadMost"), vault.topRead)}
        {top(t("usage.vaultChangedMost"), vault.topChanged)}
      </div>
      {vault.folders.length > 0 && (
        <div className={`${CARD} px-4 pt-3 pb-1`}>
          <UsageRow
            head
            label={<span className={LABEL}>{t("usage.vaultFolders")}</span>}
            today={t("usage.vault.read")}
            week={t("usage.vaultChanged")}
          />
          {vault.folders.map(f => (
            <UsageRow
              key={f.folder}
              label={f.folder || t("usage.vaultRoot")}
              today={num(f.read, locale)}
              week={num(f.changed, locale)}
            />
          ))}
        </div>
      )}
      <p className={`${NOTE} text-xs max-w-160`}>{t("usage.vaultEstimate")}</p>
    </div>
  );
}
