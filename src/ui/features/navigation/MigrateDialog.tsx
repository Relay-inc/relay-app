import { useEffect, useState } from "react";
import { migrate, migratePreview, type MigratePlan } from "../../../application/navigation/migrate";
import { useConversationsStore } from "../../../application/conversations/store";
import { hasStarted } from "../../../domain/conversations/rules";
import { projectName, vaultName } from "../../../application/workspace/vault";
import { useT } from "../../hooks/useT";

const SELECT = "h-8 px-2 rounded-md border border-separator-strong bg-bg text-sm min-w-0";
const LIST = "max-h-40 overflow-auto mt-1 px-2 py-1 rounded-md bg-fill-2 text-xs text-secondary font-mono";

/** Move or copy a project to another workspace: what goes (notes, its row or card, icon, Design link, repos, scratch
 *  notes), what stays (links, files a team workspace does not take, started conversations), what is in the way. Into a
 *  team workspace the files are listed and a box says every member will see them; the button waits for a tick. */
export function MigrateDialog({
  project,
  from,
  to,
  mode,
  onClose,
}: {
  project: string;
  from: string; // the workspace folder it is in
  to: string;
  mode: "move" | "copy";
  onClose: () => void;
}) {
  const { t, tn } = useT();
  const [context, setContext] = useState("");
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useConversationsStore(
    s => Object.values(s.chats).filter(chat => chat.project === project && hasStarted(s, chat.key)).length,
  );
  useEffect(() => {
    let live = true;
    migratePreview(project, to, mode, context).then(
      next => live && setPlan(next),
      e => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [project, to, mode, context]);

  const [name, target] = [projectName(project), vaultName(to)];
  const blocked = !plan || plan.conflicts.length > 0 || (plan.team && !seen) || busy;
  const go = async () => {
    setBusy(true);
    const err = await migrate(project, to, mode, plan?.context ?? context);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  const goes = plan && [
    tn("mig.notes", plan.files.length),
    plan.row ? t(plan.card ? "mig.card" : "mig.row") : "",
    plan.icon ? t("mig.icon") : "",
    plan.design ? t("mig.design") : "",
    plan.repos ? tn("mig.repos", plan.repos) : "",
    plan.scratch ? tn("mig.scratch", plan.scratch) : "",
  ];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={t(`mig.${mode}Title`, { name, target })}
        className="w-120 grid gap-3 p-5 bg-bg border border-separator rounded-xl shadow-lg text-sm text-label"
      >
        <h2 className="text-base font-semibold">{t(`mig.${mode}Title`, { name, target })}</h2>
        {plan && plan.contexts.length > 1 ? (
          <label className="flex items-center gap-2 text-secondary">
            {t("mig.context")}
            <select
              className={SELECT}
              value={plan.context}
              onChange={e => {
                setError("");
                setContext(e.target.value);
              }}
            >
              {plan.contexts.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ) : null}
        {!plan && !error ? <p className="text-secondary">{t("mig.reading")}</p> : null}
        {goes ? (
          <ul className="grid gap-1 list-disc pl-5">
            {goes.filter(Boolean).map(line => (
              <li key={line}>{line}</li>
            ))}
            {started ? (
              <li className="text-secondary">
                {mode === "move"
                  ? tn("mig.chatsStay", started, { here: vaultName(from) })
                  : tn("mig.chatsCopy", started, { here: vaultName(from) })}
              </li>
            ) : null}
          </ul>
        ) : null}
        {plan?.skipped.length ? (
          <details>
            <summary className="text-secondary cursor-default">{tn("mig.skipped", plan.skipped.length)}</summary>
            <div className={LIST}>
              {plan.skipped.map(p => (
                <div key={p}>{p}</div>
              ))}
            </div>
          </details>
        ) : null}
        {plan?.conflicts.length ? (
          <div className="px-3 py-2 rounded-md border border-late text-late">
            {t("mig.conflicts", { target })}
            <div className="mt-1 text-xs font-mono">
              {plan.conflicts.map(p => (
                <div key={p}>{p}</div>
              ))}
            </div>
          </div>
        ) : null}
        {plan?.team ? (
          <div className="px-3 py-2 rounded-md border border-soon">
            <p>{t("mig.team", { target })}</p>
            <details className="mt-1">
              <summary className="text-secondary cursor-default">{tn("mig.teamFiles", plan.files.length)}</summary>
              <div className={LIST}>
                {plan.files.map(p => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            </details>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={seen} onChange={e => setSeen(e.target.checked)} />
              {t("mig.teamOk", { target })}
            </label>
          </div>
        ) : null}
        {error ? <p className="text-late">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn cursor-pointer" onClick={onClose}>
            {t("mig.cancel")}
          </button>
          <button className="btn btn-primary cursor-pointer disabled:opacity-50" disabled={blocked} onClick={go}>
            {t(mode === "move" ? "mig.move" : "mig.copy")}
          </button>
        </div>
      </div>
    </div>
  );
}
