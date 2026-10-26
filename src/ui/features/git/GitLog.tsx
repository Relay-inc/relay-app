import { useMemo } from "react";
import type { GitRepo } from "../../../domain/git/git";
import { graphRows, type Edge, type GraphRow } from "../../../domain/git/graph";
import { useGitStore } from "../../../application/git/store";
import {
  LOG,
  logRepoOf,
  openCommit,
  pickLogRepo,
  setLogHeight,
  toggleLog,
  toggleLogAll,
} from "../../../application/git/git";
import { useT } from "../../hooks/useT";
import { useAgo } from "../orchestrator/parts";
import { Icon } from "../../components/Icon";

// the graph's lanes: a colour each, in turn
const LANE_COLOURS = ["#5856d6", "#34c759", "#af52de", "#ff9500", "#30b0c7", "#ff2d55", "#007aff", "#a2845e"];
const W = 12; // a lane's width
const H = 26; // a row's height
const MAX_LANES = 8; // wider graphs are cut off at the right
const x = (lane: number) => lane * W + W / 2;

/** The log of one repo of the project under the commit box, as a graph like Sourcetree's: a row per commit with its
 *  subject, branches and tags, author and age. The squares pick the repo, its top edge drags it higher. */
export function GitLog({ repos, colours }: { repos: GitRepo[]; colours: string[] }) {
  const { t, locale } = useT();
  const ago = useAgo();
  // a week back relative ("3 days ago"), older a date, with its year when that is not this one
  const age = (at: number) =>
    Date.now() - at < 7 * 86_400_000
      ? ago(at)
      : new Date(at).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
          year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : "2-digit",
        });
  const open = useGitStore(s => !s.folded[LOG]);
  const picked = useGitStore(s => s.logRepo);
  const { log, logErr, logAll, logHeight } = useGitStore();
  const repo = logRepoOf(repos, picked);
  const rows = useMemo(() => graphRows(log ?? []), [log]);
  const lanes = Math.min(MAX_LANES, Math.max(1, ...rows.map(r => r.width)));

  return (
    <div
      className="flex-none flex flex-col min-h-0 border-t border-separator"
      style={open ? { height: logHeight } : {}}
    >
      {open ? <Splitter height={logHeight} /> : null}
      <div className="flex-none flex items-center gap-1.5 h-8 px-1">
        <button
          className="flex items-center gap-1 h-6 -ml-0.5 pl-0.5 pr-1.5 rounded-md text-xs font-semibold text-secondary cursor-pointer hover:bg-fill"
          aria-expanded={open}
          onClick={toggleLog}
        >
          <Icon name="chevron" className={`glyph size-2.5 transition-transform ${open ? "" : "-rotate-90"}`} />
          {t("git.log")}
        </button>
        {/* with several repos, which one the log shows: their colour squares */}
        {repos.length > 1
          ? repos.map((r, i) => (
              <button
                key={r.repo}
                className={`grid place-items-center size-5 rounded-md cursor-pointer hover:bg-fill ${r.repo === repo?.repo ? "bg-fill-2" : ""}`}
                title={t("git.logOf", { repo: r.name })}
                aria-label={t("git.logOf", { repo: r.name })}
                aria-pressed={r.repo === repo?.repo}
                onClick={() => pickLogRepo(r.repo)}
              >
                <span
                  className={`size-2.5 rounded-[3px] ${r.repo === repo?.repo ? "" : "opacity-40"}`}
                  style={{ background: colours[i] }}
                />
              </button>
            ))
          : null}
        <span className="flex-1 min-w-0 truncate text-xs text-tertiary">{repos.length > 1 ? repo?.name : ""}</span>
        <button
          className={`flex-none h-6 px-2 rounded-md text-xs cursor-pointer hover:bg-fill ${logAll ? "bg-fill-2 text-label" : "text-tertiary"}`}
          aria-pressed={logAll}
          onClick={toggleLogAll}
        >
          {t("git.allBranches")}
        </button>
      </div>
      {open ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {logErr ? <div className="err-box mx-1 select-text">{logErr}</div> : null}
          {!log && !logErr ? <div className="px-1 text-xs text-tertiary">{t("kb.loading")}</div> : null}
          {log && !log.length ? <div className="px-1 text-xs text-tertiary">{t("git.logEmpty")}</div> : null}
          {rows.map(row => (
            <LogRow key={row.commit.hash} repo={repo?.repo ?? ""} row={row} lanes={lanes} age={age} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// the log's top edge: dragged up the log grows, the files above keep at least some room
function Splitter({ height }: { height: number }) {
  const { t } = useT();
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("git.log")}
      className="flex-none h-1.5 -mt-1 cursor-row-resize"
      onPointerDown={e => {
        const from = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.onpointermove = move =>
          setLogHeight(Math.round(Math.min(window.innerHeight - 280, Math.max(120, height + from - move.clientY))));
      }}
      onPointerUp={e => {
        e.currentTarget.onpointermove = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}

function LogRow({
  repo,
  row,
  lanes,
  age,
}: {
  repo: string;
  row: GraphRow;
  lanes: number;
  age: (at: number) => string;
}) {
  const { commit } = row;
  const merge = commit.parents.length > 1;
  const when = new Date(commit.at * 1000);
  return (
    // a click opens the commit: its files and their diffs in a window over the app
    <button
      className="w-full flex items-center gap-2 pr-1 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
      style={{ height: H }}
      onClick={() => openCommit(repo, commit)}
      title={`${commit.subject}\n${commit.hash.slice(0, 10)} · ${commit.author} · ${when.toLocaleString()}`}
    >
      <svg className="flex-none" width={lanes * W} height={H} aria-hidden="true">
        {row.edges.map((edge, i) => (
          <path
            key={i}
            d={path(edge)}
            fill="none"
            stroke={LANE_COLOURS[edge.lane % LANE_COLOURS.length]}
            strokeWidth={1.5}
          />
        ))}
        {commit.head ? (
          <circle
            cx={x(row.lane)}
            cy={H / 2}
            r={4}
            fill="var(--color-bg)"
            stroke={LANE_COLOURS[row.lane % LANE_COLOURS.length]}
            strokeWidth={2}
          />
        ) : (
          <circle cx={x(row.lane)} cy={H / 2} r={3.5} fill={LANE_COLOURS[row.lane % LANE_COLOURS.length]} />
        )}
      </svg>
      <span className={`min-w-0 truncate ${merge ? "text-tertiary" : ""}`}>{commit.subject}</span>
      {commit.refs.slice(0, 1).map(ref => (
        <span
          key={ref}
          className={`flex-none max-w-[96px] truncate h-4.5 px-1.5 rounded-[5px] font-mono text-[11px] leading-4.5 ${ref.startsWith("tag: ") ? "text-soon bg-fill-2" : commit.head && ref === commit.refs[0] ? "bg-accent-soft text-accent" : "bg-fill-2 text-secondary"}`}
          title={ref}
        >
          {ref.replace(/^tag: /, "")}
        </span>
      ))}
      {commit.refs.length > 1 ? (
        <span className="flex-none text-[11px] text-tertiary" title={commit.refs.slice(1).join("\n")}>
          +{commit.refs.length - 1}
        </span>
      ) : null}
      <span className="flex-1" />
      <span className="flex-none max-w-[90px] truncate text-xs text-tertiary">{commit.author}</span>
      <span className="flex-none w-16 text-right truncate text-xs text-tertiary tabular-nums">
        {age(commit.at * 1000)}
      </span>
    </button>
  );
}

// a line in a row: straight down in its lane, or a curve between two lanes
function path({ from, to, part }: Edge) {
  const [y1, y2] = part === "in" ? [0, H / 2] : part === "out" ? [H / 2, H] : [0, H];
  if (from === to) return `M${x(from)} ${y1}V${y2}`;
  const mid = (y1 + y2) / 2;
  return `M${x(from)} ${y1}C${x(from)} ${mid} ${x(to)} ${mid} ${x(to)} ${y2}`;
}
