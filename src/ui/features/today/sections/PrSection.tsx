import type { GhActor, PR, PrDetail } from "../../../../domain/pull-requests/types";
import { trackerOfLink, unlinkPr, useLinksStore } from "../../../../application/today/links";
import { openTicketOf } from "../../../../application/today/today";
import { useDetailsStore } from "../../../../application/today/details";
import { useT } from "../../../hooks/useT";
import { Icon } from "../../../components/Icon";
import { Markdown } from "../../../components/Markdown";
import { Caps } from "../parts";

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
export function PrSection({ id, tab, pr: row }: { id: string; tab: string; pr: PR }) {
  const { t, locale } = useT();
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

const HOW: Record<string, string> = { number: "today.link.number", title: "today.link.title", ai: "today.link.ai" };
/** The ticket the PR is about, as Relay worked it out (its number, its title, or Claude): a click opens it, the cross
 *  says it is not this one. */
function TicketRow({ pr }: { pr: PR }) {
  const { t } = useT();
  const link = useLinksStore(s => s.links[pr.url]);
  if (!link?.card) return null;
  const tracker = trackerOfLink(link);
  const number = link.number ? `${/^\d+$/.test(link.number) ? "#" : ""}${link.number}` : "";
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-[9px] bg-fill">
      <Icon name="board" className="glyph size-3.5 text-secondary flex-none" />
      <button
        className="flex-1 min-w-0 text-left text-[13px] truncate cursor-pointer hover:underline"
        onClick={() => openTicketOf(pr)}
      >
        <span className="text-secondary">{tracker?.name} </span>
        <span className="font-mono text-xs">{number}</span> {link.title}
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
