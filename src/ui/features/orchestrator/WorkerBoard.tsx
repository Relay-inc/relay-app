import { useEffect, useState } from "react";
import { agoParts } from "../../../domain/settings/machines";
import { relativeFormat } from "../../../shared/format";
import { workerBoard, stopWorker } from "../../../application/orchestrator/orchestrator";
import { select } from "../../../application/navigation/navigation";
import { projectLabel } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { WorkerRow } from "./WorkerRow";

/** The orchestrator's workers in the drawer next to the coordinator, newest first. */
export function WorkerBoard() {
  const { t, locale } = useT();
  const rows = useDerived(() => workerBoard().map(worker => ({ worker, project: projectLabel(worker.project) })));
  // a clock for "5 min ago"
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const since = (at: number) => {
    const ago = agoParts(at / 1000, clock);
    return ago ? relativeFormat(locale, { numeric: "auto", style: "short" }).format(ago.value, ago.unit) : "";
  };

  if (!rows.length) return <p className="text-[13px] text-secondary">{t("orch.empty")}</p>;
  return (
    <ul className="-mt-3">
      {rows.map(({ worker, project }) => (
        <WorkerRow
          key={worker.key}
          worker={worker}
          project={project}
          when={since(worker.ended ?? worker.at)}
          onOpen={() => select(worker.key)}
          onStop={() => stopWorker(worker.key)}
        />
      ))}
    </ul>
  );
}
