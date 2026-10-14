import type { Machine } from "../../../domain/settings/types";
import { repoState, snapshotBranch } from "../../../domain/settings/machines";
import { useSettingsStore } from "../../../application/settings/store";
import { machineRepoToMac, pushMachineRepo } from "../../../application/settings/machines-page";
import { useT } from "../../hooks/useT";
import { buttonClass, ERROR_MESSAGE, HINT_IN_ROW, PILL } from "./blocks";
import { StatusLine } from "./StatusLine";

/** The repos on a machine that is online: per repo its branch and what is not on GitHub yet, Push for commits not
 *  pushed and To Mac for any work there (a snapshot on `relay/<machine>`, fetched into this Mac's checkout). */
export function MachineRepos({ machine }: { machine: Machine }) {
  const { t, tn } = useT();
  const repos = useSettingsStore(s => s.machinesPage.repos[machine.id]);
  const busy = useSettingsStore(s => s.machinesPage.repoBusy[machine.id] ?? "");
  const messages = useSettingsStore(s => s.machinesPage.repoMessages);
  const branch = snapshotBranch(machine.name, machine.id);
  if (!repos) return null;
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-s-fg">{t("mc.repos", { name: machine.name })}</span>
      {repos.length ? (
        <div className="grid min-w-0 grid-cols-1 rounded-lg border border-s-border">
          {repos.map(repo => {
            const message = messages[`${machine.id}/${repo.name}`];
            const label = repoState(repo)
              .map(part => ("n" in part ? tn(part.key, part.n) : t(part.key)))
              .join(" · ");
            return (
              <div key={repo.name} className="grid gap-1 border-b border-s-border px-3 py-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-s-fg" title={repo.repo}>
                    {repo.name}
                  </span>
                  <span className={`${PILL} font-mono`}>{repo.branch}</span>
                  <StatusLine level={repo.dirty || repo.unpushed ? "warn" : "ok"}>{label}</StatusLine>
                  <span className="flex-1"></span>
                  {busy === repo.name ? <span className="text-xs text-s-muted">{t("mc.repoBusy")}</span> : null}
                  {repo.unpushed > 0 ? (
                    <button
                      className={buttonClass()}
                      disabled={!!busy}
                      onClick={() => pushMachineRepo(machine.id, repo.name)}
                    >
                      {t("mc.repoPush")}
                    </button>
                  ) : null}
                  {repo.dirty || repo.unpushed > 0 ? (
                    <button
                      className={buttonClass()}
                      disabled={!!busy}
                      title={t("mc.repoToMacHelp", { branch })}
                      onClick={() => machineRepoToMac(machine.id, repo.name)}
                    >
                      {t("mc.repoToMac")}
                    </button>
                  ) : null}
                </div>
                {message ? <span className={message.ok ? HINT_IN_ROW : ERROR_MESSAGE}>{message.text}</span> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className={HINT_IN_ROW}>{t("mc.reposEmpty")}</p>
      )}
    </div>
  );
}
