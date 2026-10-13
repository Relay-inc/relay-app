import { useState } from "react";
import type { Need } from "../../../domain/orchestrator/rules";
import type { Worker } from "../../../domain/orchestrator/types";
import { answerWorker, askReport, restartWorker } from "../../../application/orchestrator/orchestrator";
import { projectName } from "../../../application/workspace/vault";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";

/** What a worker waits on you for, with the answers to give: its question with the options it offered and a field for
 *  your own words, or, when its turn ended without a report, asking for it or starting it again. The same box sits on
 *  the worker's page and under its report in the orchestrator's conversation; answering in one clears both. */
export function NeedBox({ worker, need, large = false }: { worker: Worker; need: Need; large?: boolean }) {
  const { t } = useT();
  const [own, setOwn] = useState("");
  const project = useDerived(() => projectName(worker.project));
  const options =
    need.kind === "ask"
      ? need.options.map(label => ({ label, go: () => answerWorker(worker.key, label) }))
      : [
          { label: t("orch.askReport"), go: () => askReport(worker.key) },
          { label: t("orch.restart"), go: () => restartWorker(worker.key) },
        ];
  const sendOwn = () => {
    if (!own.trim()) return;
    answerWorker(worker.key, own);
    setOwn("");
  };
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-xl border border-accent ring-3 ring-accent-soft ${large ? "px-4 py-3.5" : "px-3.5 py-3"}`}
    >
      {large ? (
        <span className="text-[11px] font-semibold tracking-[.06em] uppercase text-accent-text">
          {need.kind === "ask" ? t("orch.asks", { name: project }) : t("orch.state.silent")}
        </span>
      ) : null}
      {need.kind === "ask" ? (
        <Markdown className={`md-chat ${large ? "text-[15px]!" : "text-sm!"} leading-normal!`} text={need.question} />
      ) : (
        <span className={large ? "text-[15px]" : "text-sm"}>{t("orch.silentQ")}</span>
      )}
      {options.length ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option, i) => (
            <button
              key={option.label}
              className={`${large ? "h-8" : "h-7.5"} px-3 rounded-lg text-[13px] font-medium ${i === 0 ? "border-0 bg-accent text-on-accent hover:bg-accent-hover" : "border border-separator-strong bg-transparent text-label hover:bg-fill"}`}
              onClick={option.go}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {need.kind === "ask" ? (
        <input
          className="h-8.5 px-3 rounded-lg border border-separator-strong bg-transparent text-[13px] text-label outline-0 focus:border-accent placeholder:text-tertiary"
          placeholder={t("orch.ownAnswer")}
          value={own}
          onChange={e => setOwn(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) sendOwn();
          }}
        />
      ) : null}
    </div>
  );
}
