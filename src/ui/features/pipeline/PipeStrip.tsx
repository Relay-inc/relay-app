import { useEffect, useState, type ReactNode } from "react";
import type { Worker } from "../../../domain/orchestrator/types";
import { costumeOf } from "../../../domain/orchestrator/rules";
import { prsOf, ticketOf } from "../../../domain/pipeline/rules";
import {
  agentOf,
  barOf,
  ciOf,
  newComments,
  prName,
  stripOf,
  type BarAgent,
  type Ci,
  type Need,
  type NeedKind,
} from "../../../domain/pipeline/strip";
import type { PrStatus } from "../../../domain/pipeline/types";
import {
  openPipelineLink,
  pipelinePanel,
  prStatuses,
  setStripOpen,
  unignoreTicket,
} from "../../../application/pipeline/runner";
import { usePipelineStore } from "../../../application/pipeline/store";
import { openWorker, toast } from "../../../application/navigation/navigation";
import { useSettingsStore } from "../../../application/settings/store";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Crab } from "../orchestrator/Crab";
import { PipeControls } from "./PipeBar";
import { StateMark } from "../orchestrator/parts";

const NEED_KEY = {
  ask: "ps.n.ask",
  plan: "ps.n.plan",
  failed: "ps.n.failed",
  moved: "ps.n.moved",
} as const satisfies Record<NeedKind, string>;
const LABEL = "text-[11px] font-semibold tracking-[.06em] uppercase text-secondary";
const MONO = "font-mono text-[11px]";

/** The stage strip between a pipeline conversation's title bar and its messages: a 40px bar that says what is where
 *  (a count per lane, a crab per running agent) and opens, with a slide, into the lanes Building, In review and Up
 *  next, with what needs you as short rows. Closed by default, open or closed is remembered per pipeline. Needs you in
 *  the bar jumps to the oldest open question in the conversation (`onJump`); the actions are in the conversation. */
export function PipeStrip({ project, onJump }: { project: string; onJump: (id: string) => void }) {
  const { t } = useT();
  const { linked, strip, rounds, parallel, pickName, paused, ignored, open } = useDerived(() => {
    const panel = pipelinePanel(project);
    return {
      linked: panel.linked,
      strip: stripOf(panel),
      rounds: panel.rounds,
      parallel: panel.parallel,
      pickName: panel.pickName,
      paused: panel.paused || panel.all,
      ignored: panel.ignored,
      open: !!usePipelineStore.getState().strip[project],
    };
  });
  // the oldest question just jumped to: its button stays lit for a moment, with the ring on the card
  const [lit, setLit] = useState(false);
  const prs = usePrStatuses(open ? [...strip.review] : []);
  if (!linked) return null;
  const bar = barOf(strip, rounds);
  const toggle = () => setStripOpen(project, !open);
  // optional chain: the React Compiler reads a closure's member path as a memo dependency during render, and an
  // empty Needs you made `strip.need[0].id` throw there and blank the whole window
  const jump = () => {
    const id = strip.need[0]?.id;
    if (!id) return;
    onJump(id);
    setLit(true);
    setTimeout(() => setLit(false), 1200);
  };
  const need = bar.counts.need;
  const counts = [
    [t("ps.lane.building"), bar.counts.building],
    [t("ps.lane.review"), bar.counts.review],
    [t("ps.lane.next"), bar.counts.next],
  ] as const;
  return (
    <div className="flex-none">
      <div className="min-h-10 flex flex-wrap items-center pl-5 pr-3.5 bg-well border-b border-separator">
        {open ? null : (
          <button
            className={`h-7 -ml-2 mr-2 px-2 flex items-center gap-1.25 rounded-md text-xs cursor-default disabled:opacity-100 ${lit ? "bg-accent-soft" : ""}`}
            aria-label={t("ps.jump", { n: need })}
            disabled={!need}
            onClick={jump}
          >
            {lit ? <span className="size-1.75 rounded-full bg-accent ring-3 ring-accent-soft" /> : null}
            <span className={need ? "font-medium text-accent-text" : "text-secondary"}>{t("ps.lane.need")}</span>
            <span className={`font-semibold tabular-nums ${need ? "text-accent-text" : "text-label"}`}>{need}</span>
          </button>
        )}
        <button
          className="flex-1 basis-40 min-w-0 h-10 flex items-center gap-4.5 overflow-hidden cursor-default"
          aria-expanded={open}
          aria-controls="pipe-strip"
          aria-label={t(open ? "ps.hide" : "ps.show")}
          onClick={toggle}
        >
          {open ? (
            <span className={LABEL}>{t("ps.title")}</span>
          ) : (
            <>
              <span className="flex items-center gap-4 text-xs">
                {counts.map(([name, n]) => (
                  <span key={name} className="inline-flex items-center gap-1.25 text-secondary">
                    {name}
                    <span className="font-semibold tabular-nums text-label">{n}</span>
                  </span>
                ))}
              </span>
              {bar.agents.length ? (
                <>
                  <span className="w-px h-4.5 bg-separator-strong" />
                  <span className="flex items-center gap-4">
                    {bar.agents.map(a => (
                      <BarAgentMark key={a.key} agent={a} worker={strip.building.find(w => w.key === a.key)!} />
                    ))}
                  </span>
                </>
              ) : null}
            </>
          )}
        </button>
        <PipeControls project={project} />
        {/* the chevron opens and closes too, the controls sit between it and the rest of the bar */}
        <button
          className="h-10 flex-none flex items-center gap-1 ml-1.5 cursor-default"
          aria-hidden="true"
          tabIndex={-1}
          onClick={toggle}
        >
          {open ? <span className="text-xs text-secondary">{t("ps.collapse")}</span> : null}
          <span className="size-6.5 grid place-items-center rounded-md text-secondary">
            <Icon
              name="chevron"
              className={`glyph size-3 stroke-2 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
            />
          </span>
        </button>
      </div>
      {/* the lanes slide open under the bar and push the conversation down (rows 0fr to 1fr) */}
      <div
        id="pipe-strip"
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex gap-3 overflow-auto max-h-96 px-5 pt-3.5 pb-4 bg-well border-b border-separator">
            <Lane name={t("ps.lane.need")} count={strip.need.length} hot w="w-64" empty={t("ps.emptyNeed")}>
              {strip.need.map(n => (
                <NeedRow key={n.id} need={n} onClick={() => onJump(n.id)} />
              ))}
            </Lane>
            <Lane
              name={t("ps.lane.building")}
              count={strip.building.length}
              w="w-72"
              empty={t("ps.emptyBuilding", { n: parallel })}
            >
              {strip.building.map(w => (
                <BuildCard key={w.key} worker={w} agent={agentOf(w, rounds)} rounds={rounds} />
              ))}
            </Lane>
            <Lane name={t("ps.lane.review")} count={strip.review.length} w="w-64" empty={t("ps.emptyReview")}>
              {strip.review.map(w => (
                <ReviewCard key={w.key} worker={w} prs={prs} />
              ))}
            </Lane>
            {/* the ignored tickets under Up next: out of the flow, each with Unignore */}
            <div className="w-48 flex-none flex flex-col gap-4">
              <Lane
                name={t("ps.lane.next")}
                count={strip.next.length}
                w="w-full"
                note={paused ? t("ps.notPicked") : undefined}
                empty={pickName ? t("ps.emptyNext", { column: pickName }) : t("ps.emptyNextAny")}
              >
                {strip.next.map(n => (
                  <button
                    key={n.id}
                    className="flex items-baseline gap-1.5 min-h-7.5 px-2.5 py-1 rounded-lg bg-raised border border-separator text-left text-[13px] cursor-default hover:border-separator-strong"
                    onClick={() => n.url && openPipelineLink(n.url)}
                  >
                    {n.ref ? <span className="text-xs text-secondary tabular-nums">#{n.ref}</span> : null}
                    <span className="flex-1 min-w-0 truncate">{n.title}</span>
                  </button>
                ))}
              </Lane>
              {ignored.length ? (
                <Lane name={t("ps.lane.ignored")} count={ignored.length} w="w-full" empty="">
                  {ignored.map(x => (
                    <div
                      key={x.id}
                      className="flex flex-col items-start min-h-7.5 px-2.5 py-1 rounded-lg border border-dashed border-separator-strong leading-snug"
                    >
                      <button
                        className="w-full flex gap-1.5 min-w-0 text-left text-[13px] text-secondary cursor-default hover:underline"
                        onClick={() => x.url && openPipelineLink(x.url)}
                      >
                        {x.number ? <span className="text-xs tabular-nums">#{x.number}</span> : null}
                        <span className="flex-1 min-w-0 truncate">{x.title}</span>
                      </button>
                      <button
                        className="text-xs text-accent-text cursor-default hover:underline"
                        title={t("ps.unignoreHelp")}
                        onClick={() =>
                          void unignoreTicket(project, x.id).catch(e => toast(String((e as Error)?.message ?? e)))
                        }
                      >
                        {t("ps.unignore")}
                      </button>
                    </div>
                  ))}
                </Lane>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Lane({
  name,
  count,
  hot,
  w,
  empty,
  note,
  children,
}: {
  name: string;
  count: number;
  hot?: boolean;
  w: string;
  empty: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${w} flex-none min-w-0 flex flex-col gap-2 *:shrink-0`} aria-label={name}>
      <div className={`flex items-center gap-1.5 h-4.5 px-0.5 ${LABEL}`}>
        <span>{name}</span>
        <span className={`tracking-normal ${hot && count ? "text-accent-text" : ""}`}>{count}</span>
      </div>
      {count ? (
        children
      ) : (
        <div className="px-3 py-3 rounded-xl border border-dashed border-separator-strong text-xs leading-normal text-secondary">
          {empty}
        </div>
      )}
      {note ? <div className="px-1 text-xs text-secondary">{note}</div> : null}
    </div>
  );
}

/** A ticket that needs you, as a row of the strip: no buttons, a click scrolls to its card in the conversation. */
function NeedRow({ need, onClick }: { need: Need; onClick: () => void }) {
  const { t } = useT();
  return (
    <button
      className="flex flex-col min-h-7.5 px-2.5 py-1 rounded-lg bg-raised border border-separator text-left cursor-default leading-snug hover:border-separator-strong"
      onClick={onClick}
    >
      <span className="flex gap-1.5 min-w-0 text-[13px]">
        {need.ref ? <span className="text-xs text-secondary tabular-nums">#{need.ref}</span> : null}
        <span className="flex-1 min-w-0 truncate">{need.title}</span>
      </span>
      <span className="text-xs text-accent-text">{t(NEED_KEY[need.kind])}</span>
    </button>
  );
}

/** How long a worker has run, "14m": ticks every 30 seconds. */
function useElapsed() {
  const { locale } = useT();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (since: number) => {
    const min = Math.max(0, Math.floor((clock - since) / 60_000));
    const [value, unit] = min >= 60 ? [Math.floor(min / 60), "hour"] : [min, "minute"];
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  };
}

const family = (w: Worker) => {
  const name = costumeOf(w.model, false);
  return name === "plain" ? "" : name[0].toUpperCase() + name.slice(1);
};

/** An agent's crab with a small mark for its state, or the plain state mark with the crabs switched off. */
function AgentMark({ worker, size }: { worker: Worker; size: number }) {
  const crabs = useSettingsStore(s => s.settings.workerCrabs !== false);
  if (!crabs) return <StateMark state={worker.state} />;
  return (
    <span className="relative flex-none">
      <Crab costume="pipeline" running={worker.state === "running"} size={size} />
      <span
        className={`absolute -right-1 -bottom-0.75 grid place-items-center rounded-full bg-raised ring-1 ring-separator ${size > 20 ? "size-3.5" : "size-2.75"}`}
      >
        {worker.stalled ? (
          <span className="text-[8px] font-extrabold leading-none text-soon">!</span>
        ) : (
          <StateMark state={worker.state} />
        )}
      </span>
    </span>
  );
}

/** Segments of a progress bar, `done` of them filled. */
function Segs({ done, total, thin, fill }: { done: number; total: number; thin?: boolean; fill: string }) {
  return (
    <span className={`flex ${thin ? "gap-0.5" : "gap-0.75 w-full"}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`${thin ? "w-1.25 h-1 rounded-xs" : "flex-1 h-1 rounded-xs"} ${i < done ? fill : "bg-fill-2"}`}
        />
      ))}
    </span>
  );
}

/** One running agent in the collapsed bar: crab, ticket number and a tiny progress bar with its step or round. */
function BarAgentMark({ agent, worker }: { agent: BarAgent; worker: Worker }) {
  const { t } = useT();
  const label = progressLabel(agent, t, true);
  return (
    <span className="inline-flex items-center gap-1.75 text-xs">
      <AgentMark worker={worker} size={18} />
      <span className="text-secondary tabular-nums">#{agent.ref}</span>
      {agent.total ? <Segs done={agent.done} total={agent.total} thin fill="bg-accent" /> : null}
      <span className="text-secondary tabular-nums">{label}</span>
    </span>
  );
}

function progressLabel(a: BarAgent, t: ReturnType<typeof useT>["t"], short: boolean) {
  const n = a.done;
  const max = a.total;
  if (a.kind === "review") return t(short ? "ps.barReview" : "ps.reviewRound", { n, max });
  if (a.kind === "checks") return t(short ? "ps.barChecks" : "ps.checksRound", { n, max });
  return a.kind === "step" ? `${a.done}/${a.total}` : "";
}

/** A ticket's card in a lane: its crab (opens the agent's conversation), number (opens the ticket), title, time and
 *  what is under it. */
function Card({
  worker,
  time,
  meta,
  children,
}: {
  worker: Worker;
  time: string;
  meta: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT();
  const ticket = ticketOf(worker)!;
  return (
    <article className="flex flex-col gap-2 pt-2.5 px-3 pb-3 rounded-xl bg-raised border border-separator shadow-xs">
      <div className="flex items-start gap-2.5">
        <button
          className="flex-none mt-px cursor-default"
          aria-label={t("ps.openAgent")}
          onClick={() => void openWorker(worker.key)}
        >
          <AgentMark worker={worker} size={26} />
        </button>
        <div className="flex-1 min-w-0 flex flex-col leading-snug">
          <div className="flex items-baseline gap-1.5">
            <button
              className="text-xs text-secondary tabular-nums cursor-default hover:underline"
              onClick={() => ticket.url && openPipelineLink(ticket.url)}
            >
              #{ticket.number}
            </button>
            <button
              className="flex-1 min-w-0 font-semibold text-left line-clamp-2 cursor-default hover:underline"
              onClick={() => void openWorker(worker.key)}
            >
              {ticket.title || worker.title}
            </button>
            <span className="text-xs text-secondary whitespace-nowrap">{time}</span>
          </div>
          <div className="mt-0.5 text-xs text-secondary truncate">{meta}</div>
        </div>
      </div>
      {children}
    </article>
  );
}

/** A repo's folder name, for the chips. */
const folder = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

function BuildCard({ worker, agent, rounds }: { worker: Worker; agent: BarAgent; rounds: number }) {
  const { t } = useT();
  const elapsed = useElapsed();
  const model = family(worker);
  const word = worker.stalled ? "ps.s.stuck" : worker.phase ? "ps.s.agentDone" : "ps.s.building";
  const repos = worker.trees?.length ? worker.trees.map(x => folder(x.repo)) : worker.repo ? [folder(worker.repo)] : [];
  const step = worker.step;
  return (
    <Card
      worker={worker}
      time={elapsed(worker.at)}
      meta={
        <>
          {model ? `${model} · ` : ""}
          <span className={worker.stalled ? "text-soon" : worker.phase ? "" : "text-accent"}>{t(word)}</span>
        </>
      }
    >
      {step && !worker.phase ? (
        <div className="flex flex-col gap-1.25">
          <div className="text-xs">
            {step.note
              ? t("ps.stepNote", { done: step.done, total: step.total, note: step.note })
              : t("ps.step", { done: step.done, total: step.total })}
          </div>
          <Segs done={agent.done} total={agent.total} fill="bg-secondary" />
        </div>
      ) : null}
      {worker.phase ? (
        <div className="flex items-center gap-1.5 text-xs text-accent">
          <span className="spinner" />
          {agent.kind === "review" || agent.kind === "checks"
            ? progressLabel({ ...agent, total: rounds }, t, false)
            : t("ps.checks")}
        </div>
      ) : null}
      {worker.stalled ? (
        <div className="flex flex-col gap-0.5 px-2.25 py-1.75 rounded-lg bg-soon/12 text-xs">
          <span className="font-semibold text-soon">{t("orch.stuck")}</span>
          <span>{worker.stalled}</span>
        </div>
      ) : null}
      {worker.branch || repos.length ? (
        <div className="flex flex-wrap items-center gap-1.25">
          {worker.branch ? <span className={`${MONO} mr-0.5 text-secondary`}>{worker.branch}</span> : null}
          {repos.map(r => (
            <span key={r} className="h-4.5 inline-flex items-center px-1.5 rounded-sm bg-fill-2 text-[11px]">
              {r}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

const CI_STYLE: Record<Exclude<Ci, "none">, { key: string; color: string }> = {
  passed: { key: "ps.ci.passed", color: "text-ok" },
  running: { key: "ps.ci.running", color: "text-accent" },
  failed: { key: "ps.ci.failed", color: "text-late" },
};

function ReviewCard({ worker, prs }: { worker: Worker; prs: Record<string, PrStatus> }) {
  const { t, tn } = useT();
  const ago = useElapsed();
  const urls = prsOf(worker);
  const known = urls.filter(u => prs[u]).map(u => prs[u]);
  const comments = known.length === urls.length ? newComments(known, worker.ended ?? 0) : -1;
  return (
    <Card worker={worker} time={ago(worker.ended ?? worker.at)} meta={family(worker)}>
      <div className="flex flex-col gap-1">
        {urls.map(url => {
          const { repo, n } = prName(url);
          const ci = prs[url] ? ciOf(prs[url].checks) : "none";
          const style = ci === "none" ? null : CI_STYLE[ci];
          return (
            <div key={url} className="flex items-center gap-1.75 text-xs whitespace-nowrap">
              {style ? (
                <span className={`w-3 ${style.color}`} role="img" aria-label={t(style.key as "ps.ci.passed")}>
                  {ci === "running" ? (
                    <span className="spinner" />
                  ) : (
                    <Icon name={ci === "passed" ? "check" : "close"} className="glyph size-3 stroke-2" />
                  )}
                </span>
              ) : (
                <span className="w-3" />
              )}
              <button
                className={`${MONO} text-accent-text cursor-default hover:underline`}
                onClick={() => openPipelineLink(url)}
              >
                {repo} {n}
              </button>
              <span className="flex-1" />
              {style ? <span className={style.color}>{t(style.key as "ps.ci.passed")}</span> : null}
            </div>
          );
        })}
      </div>
      {comments >= 0 ? (
        <div className="text-xs">{comments ? tn("ps.comments", comments) : t("ps.noComments")}</div>
      ) : null}
    </Card>
  );
}

/** Each in-review worker's PRs as gh reads them (checks, new comments), by url: read when the strip opens and every
 *  minute while it is open, a gh call per PR. A PR gh cannot read has none. */
function usePrStatuses(workers: Worker[]) {
  const [prs, setPrs] = useState<Record<string, PrStatus>>({});
  const keys = workers.map(w => w.key).join(" ");
  useEffect(() => {
    if (!keys) return;
    let live = true;
    const read = () =>
      Promise.all(keys.split(" ").map(key => prStatuses(key))).then(lists => {
        if (live) setPrs(Object.fromEntries(lists.flat().map(pr => [pr.url, pr])));
      });
    void read();
    const timer = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [keys]);
  return prs;
}
