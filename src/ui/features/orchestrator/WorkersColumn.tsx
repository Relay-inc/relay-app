import { ORCH } from "../../../domain/orchestrator/rules";
import { lastAi } from "../../../application/conversations/selectors";
import { useConversationsStore } from "../../../application/conversations/store";
import { workerRuns } from "../../../application/orchestrator/orchestrator";
import { openWorker, select } from "../../../application/navigation/navigation";
import { useNavigationStore } from "../../../application/navigation/store";
import { projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { WorkerRow } from "./WorkerRow";

/** The orchestrator's column on the right: its conversation first (what the middle shows by default), then the
 *  latest run's workers and the earlier ones. */
export function WorkersColumn() {
  const { t, locale } = useT();
  const selected = useNavigationStore(s => s.selected);
  const detail = useNavigationStore(s => s.orchDetail);
  const busy = useConversationsStore(s => s.status[ORCH] === "busy");
  const said = useConversationsStore(s => !!s.messages[ORCH]?.some(item => item.kind === "ai"));
  const last = useDerived(() => lastAi(ORCH));
  const runs = useDerived(() => {
    const { run, since, earlier } = workerRuns();
    const rows = (list: typeof run) => list.map(worker => ({ worker, project: projectName(worker.project) }));
    return { run: rows(run), since, earlier: rows(earlier), titles: run.map(worker => worker.title).join(", ") };
  });
  const onCoordinator = selected === ORCH && !detail;
  const time = new Date(runs.since).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const rows = (list: typeof runs.run) =>
    list.map(({ worker, project }) => (
      <WorkerRow
        key={worker.key}
        worker={worker}
        project={project}
        selected={detail && selected === worker.key}
        onOpen={() => openWorker(worker.key)}
      />
    ));

  return (
    <div className="flex flex-col gap-0.5 -mx-1.5">
      <button
        className={`flex w-full items-center gap-3 min-h-14 px-2.5 rounded-[10px] border-0 text-left cursor-default ${onCoordinator ? "bg-accent-soft" : "bg-transparent hover:bg-fill"}`}
        onClick={() => select(ORCH)}
      >
        <span className="size-7 flex-none rounded-lg bg-fill-2 text-accent-text grid place-items-center">
          <Icon name="agent" className="glyph size-4" />
        </span>
        <span className="flex-1 min-w-0 flex flex-col leading-snug">
          <span className={`text-sm ${onCoordinator ? "font-semibold" : "font-medium"}`}>{t("orch.conversation")}</span>
          <span className="text-xs text-secondary truncate">{said ? last : t("orch.noMessages")}</span>
        </span>
        {busy ? <span className="spinner" /> : null}
      </button>
      {runs.run.length ? (
        <>
          <div className="flex flex-col gap-0.5 px-2.5 pt-4 pb-1.5 text-xs">
            <span className="font-semibold text-secondary">{t("orch.thisRun", { time })}</span>
            <span className="text-tertiary truncate">{runs.titles}</span>
          </div>
          {rows(runs.run)}
        </>
      ) : (
        <p className="mx-2.5 mt-4 p-3.5 rounded-[10px] border border-dashed border-separator-strong text-xs leading-normal text-tertiary">
          {t("orch.emptyHint")}
        </p>
      )}
      {runs.earlier.length ? (
        <>
          <div className="px-2.5 pt-4 pb-1.5 text-xs font-semibold text-secondary">{t("orch.earlier")}</div>
          {rows(runs.earlier)}
        </>
      ) : null}
    </div>
  );
}
