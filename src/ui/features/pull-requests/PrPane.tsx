import type { ReactNode } from "react";
import type { Key } from "../../../shared/i18n";
import { dayMonth } from "../../../shared/format";
import type { GhThread, PrDetail } from "../../../domain/pull-requests/types";
import {
  CHECK,
  actorName,
  checksOf,
  conversationOf,
  requestedReviewers,
  type Check,
} from "../../../domain/pull-requests/rules";
import { useNavigationStore } from "../../../application/navigation/store";
import { prHeading, reviewPr } from "../../../application/pull-requests/prs";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { Avatar } from "../../components/Avatar";
import { ModalLink } from "../../components/ModalLink";
import { tintText } from "../../../shared/tints";
import { CI, age } from "./prState";

type Tone = "ok" | "bad" | "run" | "";
const DOT: Record<string, string> = { ok: "bg-ok", bad: "bg-late", run: "bg-soon", "": "bg-separator" };
const CHECK_TEXT: Record<string, string> = {
  ok: "text-secondary",
  bad: "text-late",
  run: "text-soon",
  "": "text-secondary",
};
const RSTATE: Record<string, [Tone, Key]> = {
  APPROVED: ["ok", "rs.approved"],
  CHANGES_REQUESTED: ["bad", "rs.changes"],
  COMMENTED: ["", "rs.commented"],
  DISMISSED: ["", "rs.dismissed"],
};
// pale tones: green and red as in a diff, grey (orange text while running) for the rest
const TONE: Record<Tone, string> = {
  ok: "bg-add-bg text-add-fg",
  bad: "bg-del-bg text-del-fg",
  run: "bg-fill-2 text-soon",
  "": "bg-fill-2 text-secondary",
};

const chip = (tone: Tone, text: ReactNode) => (
  <span
    className={`inline-flex items-center h-5.5 px-2 rounded-md text-xs font-medium whitespace-nowrap ${TONE[tone]}`}
  >
    {text}
  </span>
);
const diffStat = (additions: number, deletions: number) => (
  <span className="font-mono text-xs">
    <span className="text-add-fg">+{additions}</span> <span className="text-del-fg">−{deletions}</span>
  </span>
);
const code = (text: string) => (
  <code className="font-mono text-xs bg-fill-2 text-label px-1.5 py-px rounded-sm">{text}</code>
);
const section = (title: string, count: number | string, body: ReactNode) => (
  <section className="flex flex-col gap-1">
    <h3 className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-tertiary">
      {title}
      {count !== "" ? (
        <>
          {" "}
          <span className="font-medium tabular-nums">{count}</span>
        </>
      ) : null}
    </h3>
    {body}
  </section>
);
const box = (rows: ReactNode) => <div className="flex flex-col border border-separator rounded-[10px]">{rows}</div>;
const boxRow = "flex items-center gap-2.5 h-9 px-3 border-t border-separator first:border-t-0";

/** One PR next to the list, from the raw GraphQL answer of github_pr: title, meta, chips, description, checks,
 *  conversation, comments in the code and files, with GitHub and the AI review in the header. Every text from GitHub
 *  renders through Markdown. */
export function PrPane({ prKey }: { prKey: string }) {
  const { t, tn, locale } = useT();
  const pr = useNavigationStore(s => s.panel.detail[prKey]) as PrDetail | undefined;
  const err = useNavigationStore(s => s.panel.err);
  const heading = useDerived(() => prHeading(prKey));
  const formatDate = (iso: string) => dayMonth(iso, locale);

  const entry = (key: number, who: string, at: string, body: string | undefined, extra?: ReactNode) => (
    <div key={key} className="flex gap-3 py-2">
      <Avatar name={who} size="size-6 text-[9px]" />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs">
          <b className="font-semibold">{who}</b>
          {extra}
          <span className="ml-auto text-tertiary tabular-nums">{formatDate(at)}</span>
        </div>
        {body?.trim() ? <Markdown className="md-panel text-sm leading-[1.55]" text={body} /> : null}
      </div>
    </div>
  );
  const reviewChip = (state: string) => {
    const known = RSTATE[state];
    return chip(known?.[0] ?? "", known ? t(known[1]) : state);
  };
  const check = (item: Check, i: number) => {
    const tone = CHECK[item.state] ?? "run";
    return (
      <div key={i} className={boxRow}>
        <span className={`size-2 rounded-full flex-none ${DOT[tone]}`}></span>
        <span className="flex-1 min-w-0 truncate font-mono text-xs">
          {item.url ? (
            <a className="underline" href={item.url}>
              {item.name}
            </a>
          ) : (
            item.name
          )}
        </span>
        <span className={`text-xs ${CHECK_TEXT[tone]}`}>{String(item.state || "").toLowerCase()}</span>
      </div>
    );
  };
  const thread = (item: GhThread, i: number) => {
    const badge = item.isResolved ? t("pr.resolved") : item.isOutdated ? t("pr.outdated") : "";
    return (
      <div key={i} className={`mb-2.5 ${item.isResolved ? "opacity-60" : ""}`}>
        <div className="flex justify-between gap-2 text-xs">
          <code className="font-mono wrap-anywhere">
            {item.path}
            {item.line ? `:${item.line}` : ""}
          </code>
          <span className="text-secondary">{badge}</span>
        </div>
        {(item.comments?.nodes || []).map((reply, j) => entry(j, actorName(reply.author), reply.createdAt, reply.body))}
      </div>
    );
  };

  let content: ReactNode;
  if (err && !pr) content = <div className="err-box">{err}</div>;
  else if (!pr) content = <div className="text-secondary">{t("pr.loading")}</div>;
  else {
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
    const ci = rollup?.state ? CI[rollup.state] : undefined;
    const asked = requestedReviewers(pr);
    const checks = checksOf(rollup?.contexts?.nodes || []);
    const talk = conversationOf(pr);
    const threads = pr.reviewThreads?.nodes || [];
    const files = pr.files?.nodes;
    content = (
      <>
        <div className="flex flex-col gap-2.5">
          {/* repo · project on the left, GitHub and the AI review on the right */}
          <div className="flex items-center gap-2 text-xs text-secondary">
            <span className="font-mono">{heading.repo}</span>
            {heading.project ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Icon name="folder" className={`glyph size-3 ${tintText(heading.project.tint, "")}`} />
                  {heading.project.label}
                </span>
              </>
            ) : null}
            <span className="flex-1"></span>
            <ModalLink href={pr.url}>{t("pr.openGh")}</ModalLink>
            <button
              className="btn btn-primary cursor-pointer inline-flex items-center gap-1.5 h-7 px-3 text-xs"
              title={t("pr.reviewTitle")}
              onClick={() => reviewPr(prKey)}
            >
              <Icon name="chat" className="glyph size-3.5" />
              {t("pr.review")}
            </button>
          </div>
          <h2 className="m-0 text-xl leading-snug font-semibold tracking-tight text-pretty">
            {pr.isDraft ? (
              <span className="text-xs font-medium text-secondary px-1.5 py-0.5 rounded-sm border border-separator-strong mr-2 align-middle">
                {t("pr.draft")}
              </span>
            ) : null}
            {pr.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-secondary tabular-nums">
            <span className="font-mono text-xs text-label">#{pr.number}</span>
            <span>{actorName(pr.author)}</span>
            <span>{age(pr.createdAt, t)}</span>
            <span className="inline-flex items-center gap-1">
              {code(pr.headRefName)}→{code(pr.baseRefName)}
            </span>
            {diffStat(pr.additions, pr.deletions)}
            <span>{tn("pr.files", Number(pr.changedFiles) || 0)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ci ? chip(ci[0], t(ci[1])) : null}
            {pr.reviewDecision === "CHANGES_REQUESTED" ? chip("bad", t("rv.changes")) : null}
            {pr.reviewDecision === "APPROVED" ? chip("ok", t("rv.approved")) : null}
            {pr.mergeable === "CONFLICTING" ? chip("bad", t("pr.conflict")) : null}
            {asked.length ? chip("", t("pr.asked", { who: asked.join(", ") })) : null}
          </div>
        </div>
        {section(
          t("pr.desc"),
          "",
          pr.body?.trim() ? (
            <Markdown className="md-panel text-sm leading-[1.65]" text={pr.body} />
          ) : (
            <div className="text-[13px] text-secondary">{t("pr.noDesc")}</div>
          ),
        )}
        {checks.length ? section(t("pr.checks"), checks.length, box(checks.map(check))) : null}
        {section(
          t("pr.talk"),
          talk.length,
          talk.length ? (
            talk.map((item, i) =>
              entry(i, item.who, item.at, item.body, item.state ? reviewChip(item.state) : undefined),
            )
          ) : (
            <div className="text-[13px] text-secondary">{t("pr.noComments")}</div>
          ),
        )}
        {threads.length ? section(t("pr.threads"), threads.length, threads.map(thread)) : null}
        {files?.length
          ? section(
              t("pr.filesH"),
              pr.changedFiles,
              box(
                files.map(file => (
                  <div key={file.path} className={boxRow}>
                    <Icon name="file" className="glyph size-3.5 flex-none text-tertiary" />
                    <span className="flex-1 min-w-0 truncate font-mono text-xs">{file.path}</span>
                    {diffStat(file.additions, file.deletions)}
                  </div>
                )),
              ),
            )
          : null}
      </>
    );
  }
  return <div className="max-w-180 px-8 pt-5.5 pb-10 flex flex-col gap-6 select-text cursor-auto">{content}</div>;
}
