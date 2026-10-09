import type { GhActor, PR, PrDetail } from "../../../../domain/pull-requests/types";
import { useEffect, useState } from "react";
import {
  chooseTicket,
  ticketOf,
  ticketState,
  trackerOfLink,
  unlinkPr,
  useLinksStore,
} from "../../../../application/today/links";
import { loadPr } from "../../../../application/today/load";
import { useTodayStore } from "../../../../application/today/store";
import { projectLabel } from "../../../../application/workspace/vault";
import { useDerived } from "../../../hooks/useDerived";
import { openTicketOf } from "../../../../application/today/today";
import { findTicketAgain } from "../../../../application/today/actions";
import {
  linkRepo,
  linkVaultBoard,
  linkableTrackers,
  repoProjects,
  trackerBoards,
  trackerProjects,
} from "../../../../application/today/boardlink";
import { setLinking, setPicking, useDetailsStore } from "../../../../application/today/details";
import { useT } from "../../../hooks/useT";
import { Icon } from "../../../components/Icon";
import { Markdown } from "../../../components/Markdown";
import { Caps } from "../parts";
import type { SectionDef, SectionProps } from "./types";

const name = (actor: GhActor) => actor?.name || actor?.login || "ghost";
const initials = (actor: GhActor) => name(actor).slice(0, 2).toUpperCase();
const AVATAR =
  "grid place-items-center size-6 flex-none rounded-full bg-fill-2 text-secondary text-[9px] font-semibold";
const CHECK: Record<string, string> = {
  SUCCESS: "bg-ok",
  FAILURE: "bg-late",
  ERROR: "bg-late",
  CANCELLED: "bg-late",
  TIMED_OUT: "bg-late",
};
const checkState = (check: { conclusion?: string; state?: string; status?: string }) =>
  check.conclusion || check.state || check.status || "PENDING";
const ago = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

/** The tabs a PR has under Today, with their counts. */
export const prTabs = (pr: PrDetail | undefined) =>
  [
    { id: "overview", label: "today.tab.overview", n: 0 },
    { id: "files", label: "today.tab.files", n: pr?.files?.nodes?.length ?? 0 },
    {
      id: "checks",
      label: "today.tab.checks",
      n: pr?.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts?.nodes?.length ?? 0,
    },
    { id: "talk", label: "today.tab.talk", n: (pr?.comments?.nodes?.length ?? 0) + (pr?.reviews?.nodes?.length ?? 0) },
  ] as const;

/** A pull request under Today, per tab: its branch, size, description and reviewers; the files it changes; its
 *  checks; and the conversation on it. Read from GitHub when it opens. */
export function PrSection({ entry, tab }: SectionProps<"pr">) {
  const { t, locale } = useT();
  const id = entry.id;
  const row = entry.subject.pr;
  const pr = useDetailsStore(s => s.pr[id]);
  const err = useDetailsStore(s => s.err[id]);
  if (err && !pr) return <div className="err-box">{err}</div>;
  if (!pr) return <div className="text-secondary text-sm">{t("kb.loading")}</div>;
  const checks = pr.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts?.nodes ?? [];

  if (tab === "files")
    return (
      <div className="flex flex-col border border-separator rounded-[10px]">
        {(pr.files?.nodes ?? []).map((file, i) => (
          <div key={file.path} className={`flex items-center gap-2.5 h-9 px-3 ${i ? "border-t border-separator" : ""}`}>
            <Icon name="file" className="glyph size-3.5 text-tertiary" />
            <span className="flex-1 min-w-0 truncate font-mono text-xs">{file.path}</span>
            <span className="font-mono text-[11px]">
              <span className="text-add-fg">+{file.additions}</span>{" "}
              <span className="text-del-fg">−{file.deletions}</span>
            </span>
          </div>
        ))}
      </div>
    );
  if (tab === "checks")
    return checks.length ? (
      <div className="flex flex-col border border-separator rounded-[10px]">
        {checks.map((check, i) => {
          const state = checkState(check);
          const url = check.detailsUrl || check.targetUrl;
          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 h-9 px-3 text-[13px] ${i ? "border-t border-separator" : ""}`}
            >
              <span className={`size-2 rounded-full ${CHECK[state] ?? "bg-soon"}`} />
              <span className="flex-1 min-w-0 truncate font-mono text-xs">{check.name || check.context}</span>
              <span className="text-xs text-secondary">{state.toLowerCase()}</span>
              {url ? (
                <a href={url} className="text-xs">
                  {t("today.log")}
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : (
      <div className="text-sm text-secondary">{t("today.noChecks")}</div>
    );
  if (tab === "talk") {
    const talk = [
      ...(pr.comments?.nodes ?? []).map(c => ({ who: c.author, at: c.createdAt, text: c.body ?? "", chip: "" })),
      ...(pr.reviews?.nodes ?? []).map(r => ({ who: r.author, at: r.createdAt, text: r.body ?? "", chip: r.state })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return talk.length ? (
      <div className="flex flex-col gap-1">
        {talk.map((line, i) => (
          <div key={i} className="flex gap-3 py-2">
            <span className={AVATAR}>{initials(line.who)}</span>
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <b className="font-semibold">{name(line.who)}</b>
                {line.chip ? (
                  <span className="h-5.5 px-2 rounded-md bg-fill-2 text-secondary font-medium inline-flex items-center">
                    {line.chip.toLowerCase().replace("_", " ")}
                  </span>
                ) : null}
                <span className="ml-auto text-tertiary">{ago(line.at, locale)}</span>
              </div>
              {line.text ? <Markdown text={line.text} className="md-panel text-sm leading-relaxed" /> : null}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="text-sm text-secondary">{t("today.noComments")}</div>
    );
  }
  // overview: who reviews it, latest state per reviewer, and who is asked
  const latest = new Map<string, string>();
  for (const review of pr.reviews?.nodes ?? []) latest.set(name(review.author), review.state);
  for (const ask of pr.reviewRequests?.nodes ?? [])
    if (ask.requestedReviewer && !latest.has(name(ask.requestedReviewer)))
      latest.set(name(ask.requestedReviewer), "REQUESTED");
  return (
    <div className="flex flex-col gap-5 max-w-170">
      <TicketRow pr={row} />
      <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-secondary">
        <span className="inline-flex items-center gap-1">
          <code className="font-mono text-xs bg-fill-2 text-label px-1.5 py-px rounded">{pr.headRefName}</code>→
          <code className="font-mono text-xs bg-fill-2 text-label px-1.5 py-px rounded">{pr.baseRefName}</code>
        </span>
        <span className="font-mono text-xs">
          <span className="text-add-fg">+{pr.additions}</span> <span className="text-del-fg">−{pr.deletions}</span>
        </span>
        <span>{t("today.files", { n: pr.changedFiles })}</span>
        {pr.mergeable === "CONFLICTING" ? (
          <span className="h-5.5 px-2 rounded-md bg-del-bg text-del-fg text-xs font-medium inline-flex items-center">
            {t("today.conflicts")}
          </span>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <Caps>{t("today.description")}</Caps>
        {pr.body?.trim() ? (
          <Markdown text={pr.body} className="md-panel text-sm leading-relaxed" />
        ) : (
          <span className="text-sm text-tertiary">{t("kb.noDesc")}</span>
        )}
      </section>
      {latest.size ? (
        <section className="flex flex-col gap-1.5">
          <Caps>{t("today.reviewers")}</Caps>
          {[...latest].map(([who, state]) => (
            <div key={who} className="flex items-center gap-2 text-[13px]">
              <span className={AVATAR}>{who.slice(0, 2).toUpperCase()}</span>
              <span className="flex-1">{who}</span>
              <span
                className={`text-xs ${state === "APPROVED" ? "text-ok" : state === "CHANGES_REQUESTED" ? "text-late" : "text-secondary"}`}
              >
                {state.toLowerCase().replace("_", " ")}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

const HOW: Record<string, string> = {
  number: "today.link.number",
  title: "today.link.title",
  ai: "today.link.ai",
  picked: "today.link.picked",
};
const ROW = "flex items-center gap-2.5 px-3 py-2.5 rounded-[9px] bg-fill";
const CTA =
  "h-7 px-2.5 rounded-[7px] border border-separator-strong bg-raised text-xs font-medium whitespace-nowrap cursor-pointer hover:bg-fill-2";
const numbered = (number?: string) => (number ? `${/^\d+$/.test(number) ? "#" : ""}${number}` : "");

/** The ticket the PR is about, or why there is none with the way to fix it: no vault project for the repo (link the
 *  repo), no board for the project (link a board), or nothing found (choose one, or look again). Never a dead end. */
export function TicketRow({ pr }: { pr: PR }) {
  const { t } = useT();
  const link = useLinksStore(s => s.links[pr.url]);
  const picking = useDetailsStore(s => s.picking === pr.url);
  const linking = useDetailsStore(s => s.linking === pr.url);
  const board = useTodayStore(s => (pr.project ? s.boards[pr.project] : undefined));
  const state = useDerived(() => ticketState(pr));
  if (state === "linked" && link?.card) {
    const tracker = trackerOfLink(link);
    return (
      <div className={ROW}>
        <Icon name="board" className="glyph size-3.5 text-secondary flex-none" />
        <button
          className="flex-1 min-w-0 text-left text-[13px] truncate cursor-pointer hover:underline"
          onClick={() => openTicketOf(pr)}
        >
          <span className="text-secondary">{tracker?.name} </span>
          <span className="font-mono text-xs">{numbered(link.number)}</span> {link.title}
        </button>
        <span className="text-xs text-tertiary whitespace-nowrap">{t(HOW[link.how] as "today.link.number")}</span>
        <button
          className="grid place-items-center size-6 rounded-md text-tertiary cursor-pointer hover:bg-fill-2 hover:text-label"
          title={t("today.link.notThis")}
          aria-label={t("today.link.notThis")}
          onClick={() => unlinkPr(pr.url)}
        >
          <Icon name="close" className="glyph size-3" />
        </button>
      </div>
    );
  }
  if (state === "noProject" || state === "noBoard")
    return (
      <div className="flex flex-col gap-1.5">
        <div className={ROW}>
          <Icon name="board" className="glyph size-3.5 text-tertiary flex-none" />
          <span className="flex-1 min-w-0 text-[13px] text-secondary">
            {state === "noProject"
              ? t("today.link.noProject", { repo: pr.repo })
              : t("today.link.noBoardShort", { project: projectLabel(pr.project) })}
          </span>
          <button className={CTA} onClick={() => setLinking(linking ? "" : pr.url)}>
            {state === "noProject" ? t("today.link.linkRepo") : t("today.link.linkBoard")}
          </button>
        </div>
        {linking ? state === "noProject" ? <RepoLinker pr={pr} /> : <BoardLinker project={pr.project!} /> : null}
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className={ROW}>
        <Icon name="board" className="glyph size-3.5 text-tertiary flex-none" />
        <span className="flex-1 min-w-0 text-[13px] text-secondary">{t("today.link.noneShort")}</span>
        <button className={CTA} onClick={() => findTicketAgain(pr)}>
          {t("today.link.findAgain")}
        </button>
        <button className={CTA} onClick={() => setPicking(picking ? "" : pr.url)}>
          {t("today.link.choose")}
        </button>
      </div>
      {picking && board ? <TicketPicker pr={pr} board={board} /> : null}
    </div>
  );
}

/** Choose the PR's ticket from its project's board: type to narrow by number or title, a click links it. */
function TicketPicker({
  pr,
  board,
}: {
  pr: PR;
  board: { provider: string; cards: { id: string; number: string; title: string }[] };
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = board.cards
    .filter(card => words.every(w => `${card.number} ${card.title}`.toLowerCase().includes(w.replace(/^#/, ""))))
    .slice(0, 8);
  return (
    <div className="flex flex-col p-1.5 rounded-[10px] border border-separator-strong bg-raised shadow-sm">
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => e.key === "Escape" && setPicking("")}
        placeholder={t("today.link.search")}
        className="h-8 px-2.5 mb-1 rounded-md bg-fill outline-0 text-[13px]"
      />
      {hits.length ? (
        hits.map(card => (
          <button
            key={card.id}
            onClick={() => {
              chooseTicket(pr.url, board.provider, card);
              setPicking("");
            }}
            className="flex items-center gap-2 h-8 px-2 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill-2"
          >
            <span className="font-mono text-xs text-secondary w-14 flex-none truncate">{numbered(card.number)}</span>
            <span className="flex-1 min-w-0 truncate">{card.title}</span>
          </button>
        ))
      ) : (
        <span className="px-2 py-1.5 text-xs text-tertiary">{t("today.link.noMatch")}</span>
      )}
    </div>
  );
}

const PANEL = "flex flex-col gap-2 p-3 rounded-[10px] border border-separator-strong bg-raised shadow-sm";
const SELECT = "h-8 px-2 rounded-md border border-separator-strong bg-bg text-[13px] min-w-0";

/** Link the PR's repo to a vault project, here: the project its name points at first. */
function RepoLinker({ pr }: { pr: PR }) {
  const { t } = useT();
  const options = repoProjects(pr.repo);
  const [project, setProject] = useState(options[0]?.[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className={PANEL}>
      <span className="text-xs text-secondary">{t("today.link.repoHint", { repo: pr.repo })}</span>
      <div className="flex items-center gap-2">
        <select className={`${SELECT} flex-1`} value={project} onChange={e => setProject(e.target.value)}>
          {options.map(([name, label]) => (
            <option key={name} value={name}>
              {label}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !project}
          className="btn btn-primary cursor-pointer disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setErr("");
            await linkRepo(pr.repo, project).then(
              () => setLinking(""),
              error => setErr(String(error)),
            );
            setBusy(false);
          }}
        >
          {busy ? t("today.saving") : t("today.link.link")}
        </button>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  );
}

/** Link the vault project to its board, here: the tracker, its project (Productive) and the board, the ones named
 *  like the vault project first. */
function BoardLinker({ project }: { project: string }) {
  const { t } = useT();
  const trackers = linkableTrackers();
  const [tracker, setTracker] = useState(trackers.find(x => x.id === "productive")?.id ?? trackers[0]?.id ?? "");
  // what was loaded, with what it was loaded for: a list of another tracker or project counts as loading
  const [projectList, setProjectList] = useState<{ of: string; list: { id: string; name: string }[] } | null>(null);
  const [picked, setPicked] = useState("");
  const [boardList, setBoardList] = useState<{ of: string; list: { id: string; name: string }[] } | null>(null);
  const [pickedBoard, setPickedBoard] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const projects = projectList?.of === tracker ? projectList.list : null;
  const inTracker = picked && projects?.some(p => p.id === picked) ? picked : (projects?.[0]?.id ?? "");
  const boards = boardList?.of === `${tracker}/${inTracker}` ? boardList.list : null;
  const board = pickedBoard && boards?.some(b => b.id === pickedBoard) ? pickedBoard : (boards?.[0]?.id ?? "");
  useEffect(() => {
    if (!tracker) return;
    trackerProjects(tracker, project).then(
      list => setProjectList({ of: tracker, list }),
      error => setErr(String(error)),
    );
  }, [tracker, project]);
  useEffect(() => {
    if (!tracker || !inTracker) return;
    trackerBoards(tracker, inTracker, project).then(
      list => setBoardList({ of: `${tracker}/${inTracker}`, list }),
      error => setErr(String(error)),
    );
  }, [tracker, inTracker, project]);
  if (!trackers.length) return <div className={`${PANEL} text-xs text-secondary`}>{t("today.link.noTracker")}</div>;
  return (
    <div className={PANEL}>
      <span className="text-xs text-secondary">{t("today.link.boardHint", { project: projectLabel(project) })}</span>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
        <select className={SELECT} value={tracker} onChange={e => setTracker(e.target.value)}>
          {trackers.map(x => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select className={SELECT} value={inTracker} disabled={!projects} onChange={e => setPicked(e.target.value)}>
          {(projects ?? []).map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className={SELECT} value={board} disabled={!boards} onChange={e => setPickedBoard(e.target.value)}>
          {(boards ?? []).map(b => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !board}
          className="btn btn-primary cursor-pointer disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setErr("");
            await linkVaultBoard(project, tracker, inTracker, board).then(
              () => setLinking(""),
              error => setErr(String(error)),
            );
            setBusy(false);
          }}
        >
          {busy ? t("today.saving") : t("today.link.link")}
        </button>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
    </div>
  );
}
export const prFacts: SectionDef<"pr">["facts"] = (entry, day, t) => {
  const { pr } = entry.subject;
  const link = ticketOf(pr.url);
  return [
    [
      t("today.fact.ticket"),
      link ? `${link.number ? `${/^\d+$/.test(link.number) ? "#" : ""}${link.number} ` : ""}${link.title ?? ""}` : "",
    ],
    [t("today.fact.updated"), day(pr.updated)],
  ];
};
export const prLoad: SectionDef<"pr">["load"] = entry => void loadPr(entry.id, entry.subject.pr);
