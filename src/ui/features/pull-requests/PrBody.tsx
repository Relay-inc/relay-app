import type { ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import type { PrDetail } from "../../../domain/pull-requests/types";
import {
  CHECK,
  actorName,
  checksOf,
  conversationOf,
  requestedReviewers,
  type Check,
} from "../../../domain/pull-requests/rules";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { Note } from "../../components/Note";
import { dayMonth } from "../../../shared/format";
import { PrChip, type Tone } from "./PrChip";
import { PrSection } from "./PrSection";
import { PrStatus } from "./PrStatus";

const DOT: Record<string, string> = { ok: "bg-ok", bad: "bg-late", run: "bg-soon", "": "bg-separator" };
const RSTATE: Record<string, [Tone, Key]> = {
  APPROVED: ["ok", "rs.approved"],
  CHANGES_REQUESTED: ["bad", "rs.changes"],
  COMMENTED: ["", "rs.commented"],
  DISMISSED: ["", "rs.dismissed"],
};
const diffStat = (additions: number, deletions: number) => (
  <>
    <span className="text-ok">+{additions}</span> <span className="text-bad">−{deletions}</span>
  </>
);

/** The content of one PR in the right panel, from the raw GraphQL answer: title, meta, chips, description, checks,
 *  conversation, threads, files. Every text from GitHub renders through Markdown. */
export function PrBody({ pr }: { pr: PrDetail }) {
  const { t, tn, locale } = useT();
  const formatDate = (iso: string) => dayMonth(iso, locale);
  const comment = (key: number, head: ReactNode, at: string, body?: string) => (
    <div key={key} className="py-2 border-b border-separator">
      <div className="flex items-center gap-2 text-sm mb-1">
        {head}
        <span className="ml-auto text-xs text-secondary tabular-nums">{formatDate(at)}</span>
      </div>
      {body?.trim() ? <Markdown className="md-panel" text={body} /> : null}
    </div>
  );
  const reviewChip = (state: string) => {
    const known = RSTATE[state];
    return <PrChip tone={known?.[0] ?? ""}>{known ? t(known[1]) : state}</PrChip>;
  };
  const check = (item: Check, i: number) => (
    <li key={i} className="flex items-center gap-2 py-1">
      <span className={`w-2 h-2 rounded-full flex-none ${DOT[CHECK[item.state] ?? "run"]}`}></span>
      {item.url ? (
        <a className="underline" href={item.url}>
          {item.name}
        </a>
      ) : (
        item.name
      )}
      <span className="ml-auto text-xs whitespace-nowrap text-secondary tabular-nums">
        {String(item.state || "").toLowerCase()}
      </span>
    </li>
  );

  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const checks = checksOf(rollup?.contexts?.nodes || []);
  const talk = conversationOf(pr);
  const threads = pr.reviewThreads?.nodes || [];
  const files = pr.files?.nodes;
  const asked = requestedReviewers(pr);
  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 leading-snug">
        {pr.isDraft ? (
          <span className="text-xs text-secondary border border-separator rounded-sm px-1 mr-1.5">{t("pr.draft")}</span>
        ) : null}
        {pr.title}
      </h2>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-secondary mt-0.5 tabular-nums">
        <span>#{pr.number}</span>
        <span>{actorName(pr.author)}</span>
        <span>{formatDate(pr.createdAt)}</span>
        <span>
          <code>{pr.headRefName}</code> → <code>{pr.baseRefName}</code>
        </span>
        <span>
          {diffStat(pr.additions, pr.deletions)} {tn("pr.files", Number(pr.changedFiles) || 0)}
        </span>
      </div>
      <PrStatus wrap ci={rollup?.state ?? null} review={pr.reviewDecision ?? null}>
        {pr.mergeable === "CONFLICTING" ? <PrChip tone="bad">{t("pr.conflict")}</PrChip> : null}
        {asked.length ? <PrChip>{t("pr.asked", { who: asked.join(", ") })}</PrChip> : null}
      </PrStatus>
      <PrSection className="mt-4" heading={t("pr.desc")}>
        {pr.body?.trim() ? <Markdown className="md-panel" text={pr.body} /> : <Note>{t("pr.noDesc")}</Note>}
      </PrSection>
      {checks.length ? (
        <PrSection className="mt-4" heading={t("pr.checks")} count={checks.length}>
          <ul className="list-none p-0 text-sm">{checks.map(check)}</ul>
        </PrSection>
      ) : null}
      <PrSection className="mt-4" heading={t("pr.talk")} count={talk.length}>
        {talk.length ? (
          talk.map((entry, i) =>
            comment(
              i,
              <>
                <b>{entry.who}</b>
                {entry.state ? reviewChip(entry.state) : null}
              </>,
              entry.at,
              entry.body,
            ),
          )
        ) : (
          <Note>{t("pr.noComments")}</Note>
        )}
      </PrSection>
      {threads.length ? (
        <PrSection className="mt-4" heading={t("pr.threads")} count={threads.length}>
          {threads.map((thread, i) => (
            <div key={i} className={`mb-2.5 ${thread.isResolved ? "opacity-60" : ""}`}>
              <div className="flex justify-between gap-2 text-xs">
                <code className="font-mono wrap-anywhere">
                  {thread.path}
                  {thread.line ? `:${thread.line}` : ""}
                </code>
                {thread.isResolved ? (
                  <span className="text-secondary tabular-nums">{t("pr.resolved")}</span>
                ) : thread.isOutdated ? (
                  <span className="text-secondary tabular-nums">{t("pr.outdated")}</span>
                ) : null}
              </div>
              {(thread.comments?.nodes || []).map((reply, j) =>
                comment(j, <b>{actorName(reply.author)}</b>, reply.createdAt, reply.body || ""),
              )}
            </div>
          ))}
        </PrSection>
      ) : null}
      {files?.length ? (
        <PrSection className="mt-4" heading={t("pr.filesH")} count={pr.changedFiles}>
          <ul className="list-none p-0 text-sm">
            {files.map(file => (
              <li key={file.path} className="flex items-center gap-2 py-1">
                <code className="font-mono text-xs wrap-anywhere">{file.path}</code>
                <span className="ml-auto text-xs whitespace-nowrap">{diffStat(file.additions, file.deletions)}</span>
              </li>
            ))}
          </ul>
        </PrSection>
      ) : null}
    </div>
  );
}
