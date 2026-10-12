import { ORCH, needOf, reportKey, workerName } from "../../../domain/orchestrator/rules";
import type { Item } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useOrchestratorStore } from "../../../application/orchestrator/store";
import { openWorker } from "../../../application/navigation/navigation";
import { projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { RelayTurn } from "../conversations/RelayTurn";
import { NeedBox } from "./NeedBox";
import { WorkerAvatar, useAgo, useStateText } from "./parts";

/** A worker's report as Relay wrote it into the coordinator, shown as the worker: its crab, title, project, state and
 *  summary, a click opens its page. Under its latest report, what it asks you. A report of a worker Relay no longer
 *  knows stays the folded text. */
export function ReportCard({ item }: { item: Item }) {
  const key = reportKey(item.text) ?? "";
  const worker = useOrchestratorStore(s => s.workers[key]);
  // the question goes under the newest report of that worker only
  const latest = useConversationsStore(
    s =>
      [...(s.messages[ORCH] ?? [])].reverse().find(other => other.kind === "me" && reportKey(other.text) === key) ===
      item,
  );
  if (!worker) return <RelayTurn text={item.text} />;
  const need = latest ? needOf(worker) : null;
  return (
    <>
      <Card workerKey={key} />
      {need ? <NeedBox worker={worker} need={need} /> : null}
    </>
  );
}

function Card({ workerKey }: { workerKey: string }) {
  const { t } = useT();
  const ago = useAgo();
  const worker = useOrchestratorStore(s => s.workers[workerKey]);
  const state = useStateText(worker);
  const project = useDerived(() => projectName(worker.project));
  return (
    <button
      className="flex w-full gap-3 px-3.5 py-3 rounded-xl bg-raised border-0 text-left cursor-default shadow-sm ring-1 ring-separator-strong hover:ring-accent"
      onClick={() => openWorker(workerKey)}
    >
      <WorkerAvatar worker={worker} />
      <span className="flex-1 min-w-0 flex flex-col gap-0.75">
        <span className="flex items-baseline gap-1.5 text-xs text-secondary">
          <b className="font-semibold text-label truncate">{worker.title}</b>
          <span className="flex-none">
            {workerName(worker.key)} · {project} · <span className={state.color}>{state.short}</span>
          </span>
          <span className="flex-1" />
          <span className="flex-none text-tertiary">{ago(worker.ended ?? worker.at)}</span>
        </span>
        {worker.report?.summary ? (
          <Markdown className="md-chat text-[13px]! leading-normal! line-clamp-2" text={worker.report.summary} />
        ) : null}
        <span className="inline-flex items-center gap-1 text-xs text-accent-text">
          {t("orch.openWorker")}
          <Icon name="right" className="glyph size-2.75 stroke-2" />
        </span>
      </span>
    </button>
  );
}
