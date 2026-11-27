import { useEffect, useState } from "react";
import type { BgTask } from "../../../domain/conversations/types";
import { useConversationsStore } from "../../../application/conversations/store";
import { useNavigationStore } from "../../../application/navigation/store";
import { openAgent } from "../../../application/navigation/navigation";
import { readTaskOutput, stopTask } from "../../../application/conversations/actions";
import { shownTasks } from "../../../domain/conversations/tasks";
import { formatDuration } from "../../../domain/conversations/rules";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const NONE: BgTask[] = [];
const RESULT = { completed: "tasks.completed", failed: "tasks.failed", killed: "tasks.killed" } as const;
const DOT = { running: "bg-accent", completed: "bg-separator", failed: "bg-late", killed: "bg-separator" };

/** What Claude has running in the background of the open conversation, above the composer like the terminal lists it:
 *  per task what it is, how far it is and how long it runs. A hover icon stops it, a click shows what a command
 *  printed (a subagent opens its page). Finished ones stay a few seconds with their result. The header line folds
 *  the list away, like a turn's steps. */
export function BackgroundTasks({ className }: { className: string }) {
  const { t, tn } = useT();
  const selected = useNavigationStore(s => s.selected);
  const tasks = useConversationsStore(s => s.tasks[selected] ?? NONE);
  const outputs = useConversationsStore(s => s.taskOutput[selected]);
  const [open, setOpen] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const shown = shownTasks(tasks, now);
  const reading = shown.find(task => task.id === open);
  // what an open command printed, again every 2 s while it runs
  useEffect(() => {
    if (!open) return;
    readTaskOutput(open);
    if (reading?.status !== "running") return;
    const timer = window.setInterval(() => readTaskOutput(open), 2000);
    return () => clearInterval(timer);
  }, [open, reading?.status]);
  if (!shown.length) return null;
  const kind = (task: BgTask) =>
    task.agent ??
    (task.kind === "local_bash"
      ? t("tasks.command")
      : task.kind === "local_agent"
        ? t("tasks.agent")
        : task.kind.replace(/^local_/, ""));
  const result = (task: BgTask) => (task.status === "running" ? "" : t(RESULT[task.status]));
  return (
    <div className={className}>
      <button
        className="inline-flex items-center gap-1.5 h-6 cursor-pointer px-1.5 border-0 rounded-md bg-transparent text-xs text-secondary hover:bg-fill hover:text-label"
        aria-expanded={!folded}
        onClick={() => setFolded(!folded)}
      >
        <Icon
          name="right"
          className={`glyph size-3 stroke-2 transition-transform duration-150 ${folded ? "" : "rotate-90"}`}
        />
        {tn("tasks.header", shown.length)}
      </button>
      <div className={`max-h-64 overflow-y-auto ${folded ? "hidden" : ""}`}>
        {shown.map(task => (
          <div key={task.id}>
            <div className="group flex items-center min-h-6 rounded-md text-sm text-secondary hover:bg-fill">
              <button
                className="flex-1 min-w-0 flex items-center gap-2 px-1.5 min-h-6 text-left cursor-default select-none"
                title={task.kind === "local_agent" ? t("subs.show") : t("tasks.output")}
                onClick={() =>
                  task.kind === "local_agent" ? openAgent(task.id) : setOpen(open === task.id ? null : task.id)
                }
              >
                <span className={`size-2 flex-none rounded-full ${DOT[task.status]}`}></span>
                <span className={`flex-initial min-w-0 truncate ${task.status === "running" ? "text-label" : ""}`}>
                  {task.description}
                </span>
                <span className="flex-none text-xs whitespace-nowrap">{kind(task)}</span>
                <span className="flex-1 min-w-0 truncate text-xs">
                  {result(task) ||
                    task.summary ||
                    [task.tools ? tn("tasks.steps", task.tools) : "", task.last].filter(Boolean).join(" · ")}
                </span>
                <span className="flex-none tabular-nums">
                  {formatDuration(((task.end ?? now) - task.since) / 1000)}
                </span>
              </button>
              {task.status === "running" ? (
                <button
                  className="btn-icon flex-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  title={t("tasks.stop")}
                  aria-label={t("tasks.stop")}
                  onClick={() => stopTask(task.id)}
                >
                  <Icon name="close" className="glyph size-3" />
                </button>
              ) : null}
            </div>
            {open === task.id ? (
              <pre className="mx-1.5 mb-1 max-h-40 overflow-auto rounded-md bg-fill p-2 font-mono text-xs whitespace-pre-wrap text-secondary">
                {outputs?.[task.id]?.trim() || t("tasks.noOutput")}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
