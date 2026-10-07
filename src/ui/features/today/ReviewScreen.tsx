import type { Entry } from "../../../application/today/today";
import { putOff, todayModel } from "../../../application/today/today";
import { useDerived } from "../../hooks/useDerived";
import {
  addLineComment,
  askConfirm,
  askLine,
  closeReview,
  findings as runFindings,
  lineKey,
  pickLine,
  removeComment,
  setBody,
  setLineDraft,
  setVerdict,
  showFile,
  submitReview,
  takeFinding,
  useReviewStore,
  type Finding,
  type Verdict,
} from "../../../application/today/review";
import { useDetailsStore } from "../../../application/today/details";
import { anchorOf } from "../../../domain/pull-requests/diff";
import { fileTree, type TreeNode } from "../../../domain/pull-requests/tree";
import { timeOf } from "../../../application/calendar/calendar";
import { agent } from "../../../shared/plugins";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { minutes } from "./parts";
import { useState, type ReactNode } from "react";
import { ColumnResize } from "../navigation/ColumnResize";

const SEVERITY: Record<string, string> = {
  bug: "text-late",
  risk: "text-soon",
  nit: "text-secondary",
  question: "text-accent-text",
  answer: "text-accent-text",
};
// a finding's colour, on its number and as a bar down its line: a bug red, a risk orange, the rest blue
const DOT: Record<string, string> = { bug: "bg-late", risk: "bg-soon", nit: "bg-accent" };
const BAR: Record<string, string> = {
  bug: "shadow-[inset_3px_0_0_var(--color-late)]",
  risk: "shadow-[inset_3px_0_0_var(--color-soon)]",
  nit: "shadow-[inset_3px_0_0_var(--color-accent)]",
};
const VERDICTS: Verdict[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];
const initials = (name: string) => name.slice(0, 2).toUpperCase();
const iso = (at: number) => new Date(at).toISOString();

/** The review screen of a PR under Today (the design's work mode), a view of its own: the diff per file with
 *  GitHub's threads and your comments on the lines, Claude's findings to add or dismiss, and your review, posted on
 *  GitHub only after the dialog. Esc goes back to Today. */
export function ReviewScreen({ id, entries }: { id: string; entries: Entry[] }) {
  const { t } = useT();
  const entry = entries[0];
  const r = useReviewStore(st => st.reviews[id]);
  const details = useDetailsStore(st => st.pr);
  const at = useDerived(() => todayModel().placed[entry.id]);
  const [hot, setHot] = useState("");
  if (!r) return null;
  const prs = r.prs;
  const several = prs.length > 1;
  // a PR's detail (its threads, its description), read under its Today item
  const detailOf = (url: string) => details[`review:${url}`] ?? details[`fix:${url}`];
  const files = r.files ?? [];
  const fileIndex = Math.min(r.file, Math.max(0, files.length - 1));
  const file = files[fileIndex];
  const claude = agent("claude")?.glyph ?? "";
  // GitHub's open threads on this file, by side and line
  const threads = (file ? (detailOf(file.pr)?.reviewThreads?.nodes ?? []) : []).filter(
    th => th.path === file?.path && !th.isResolved && !th.isOutdated,
  );
  const indexOf = (pr: string, path: string) => files.findIndex(x => x.pr === pr && x.path === path);
  // Claude's open findings on this file, per line: shown under it (added ones are your comments by then)
  const marks = new Map<string, Finding[]>();
  for (const f of r.findings)
    if (f.state === "open" && indexOf(f.pr, f.path) === fileIndex) {
      const key = lineKey(fileIndex, f.side, f.line);
      marks.set(key, [...(marks.get(key) ?? []), f]);
    }
  const comments = r.comments.filter(c => file && c.pr === file.pr && c.path === file.path);
  // a finding and its line point at each other: the same number on both, hover one to light up the other
  const numberOf = new Map(r.findings.map((f, i) => [f.id, i + 1]));
  const go = (f: (typeof r.findings)[number]) => {
    const i = indexOf(f.pr, f.path);
    if (i < 0) return;
    showFile(id, i);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-line="${lineKey(i, f.side, f.line)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const first = entry.subject.type === "pr" ? entry.subject.pr : null;
  const asked = several
    ? t("review.group", { n: prs.length })
    : first && (detailOf(first.url)?.reviewRequests?.nodes ?? []).length
      ? t("review.asked", { who: first.author ?? "" })
      : t("today.reviewAsked");
  const prLabel = (url: string) => {
    const pr = prs.find(x => x.url === url);
    return pr ? `${pr.repo.split("/").pop()} #${pr.number}` : "";
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-13 flex-none flex items-center gap-2.5 pl-3 pr-3.5 border-b border-separator">
        <button
          onClick={closeReview}
          className="inline-flex items-center gap-1.5 h-7.5 pl-1.5 pr-2.5 rounded-lg text-[13px] font-medium text-secondary cursor-pointer hover:bg-fill-2 hover:text-label"
        >
          <Icon name="left" className="glyph size-4" />
          {t("nav.today")}
          <span className="font-mono text-[11px] text-tertiary px-1 rounded border border-separator-strong leading-4">
            esc
          </span>
        </button>
        <span className="w-px h-4.5 bg-separator-strong" />
        <span className="grid place-items-center size-6 rounded-[7px] bg-fill-2 text-accent-text">
          <Icon name="pr" className="glyph size-3.5" />
        </span>
        <span className="font-semibold truncate max-w-115">{t("review.titleOf", { title: r.title })}</span>
        <span className="inline-flex items-center gap-1.5 h-5.5 px-2 rounded-md bg-fill-2 text-xs font-medium whitespace-nowrap">
          <span className="size-1.75 rounded-full bg-soon" />
          {asked}
        </span>
        {at ? (
          <span className="text-xs text-secondary whitespace-nowrap">
            {t("today.planned", { time: timeOf(iso(at.start)), est: minutes(entry.est) })}
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          onClick={() => {
            closeReview();
            putOff(entry.id);
          }}
          className="h-7.5 px-2.5 rounded-lg text-[13px] font-medium text-secondary cursor-pointer hover:bg-fill-2 hover:text-label"
        >
          {t("today.later")}
        </button>
        <button
          onClick={() => askConfirm(id, true)}
          className="inline-flex items-center gap-2 h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium whitespace-nowrap cursor-pointer hover:bg-accent-hover"
        >
          <Icon name="check" className="glyph size-3.5" />
          {t("review.submit")}
        </button>
      </div>

      <div className="relative flex-1 min-h-0 grid grid-cols-[var(--reviewFiles-w)_minmax(0,1fr)_var(--reviewSide-w)]">
        <ColumnResize column="reviewFiles" />
        <ColumnResize column="reviewSide" />
        <FileTree
          groups={(several ? prs.map(pr => pr.url) : [""]).map(url => ({
            label: several ? prLabel(url) : "",
            files: files.flatMap((f, index) => (several && f.pr !== url ? [] : [{ path: f.path, index }])),
          }))}
          current={fileIndex}
          stats={files.map((f, i) => ({
            add: f.additions,
            del: f.deletions,
            notes: r.findings.filter(x => x.state === "open" && indexOf(x.pr, x.path) === i).length,
          }))}
          onPick={i => showFile(id, i)}
        />
        <div className="min-w-0 min-h-0 overflow-y-auto px-5 pt-4 pb-6 flex flex-col gap-2.5 select-text">
          {file ? (
            <div className="flex items-center gap-2 font-mono text-xs">
              {several ? <span className="text-tertiary">{prLabel(file.pr)} ·</span> : null}
              <span className="font-semibold text-label">{file.path}</span>
              <span className="text-add-fg">+{file.additions}</span>
              <span className="text-del-fg">−{file.deletions}</span>
            </div>
          ) : null}
          {r.err ? <div className="err-box">{r.err}</div> : null}
          {!r.files ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
          {file ? (
            <>
              <span className="text-xs text-tertiary">{t("review.clickLine")}</span>
              {file.lines.length ? (
                // long lines scroll sideways inside the diff; every row is as wide as the widest, so the
                // colours run through, and a thread or the comment box stays at the left, readable
                <div className="shrink-0 border border-separator rounded-[10px] overflow-x-auto overflow-y-hidden font-mono text-xs leading-5.5 [container-type:inline-size]">
                  <div className="w-max min-w-full flex flex-col">
                    {file.lines.map((line, i) => {
                      const anchor = anchorOf(line);
                      const key = anchor ? lineKey(fileIndex, anchor.side, anchor.line) : "";
                      const on = !!key && r.line === key;
                      const notes = (key && marks.get(key)) || [];
                      const mark = notes[0];
                      const here = anchor ? threads.filter(th => th.line === anchor.line) : [];
                      const mine = anchor ? comments.filter(c => c.side === anchor.side && c.line === anchor.line) : [];
                      const lit = !!mark && hot === mark.id;
                      const bg = on
                        ? "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]"
                        : lit
                          ? `bg-accent-soft ${BAR[mark.severity] ?? BAR.nit}`
                          : mark
                            ? `${line.kind === "add" ? "bg-add-bg" : line.kind === "del" ? "bg-del-bg" : ""} ${BAR[mark.severity] ?? BAR.nit}`
                            : line.kind === "add"
                              ? "bg-add-bg"
                              : line.kind === "del"
                                ? "bg-del-bg"
                                : line.kind === "hunk"
                                  ? "bg-fill text-tertiary"
                                  : "";
                      return (
                        <div key={i}>
                          <div
                            data-line={key || undefined}
                            onClick={() => key && pickLine(id, key)}
                            onMouseEnter={() => mark && setHot(mark.id)}
                            onMouseLeave={() => mark && setHot("")}
                            className={`grid grid-cols-[26px_36px_36px_18px_minmax(0,1fr)] ${key ? "cursor-pointer" : ""} ${bg}`}
                          >
                            <span className="grid place-items-center">
                              {mark ? (
                                <span
                                  className={`grid place-items-center min-w-4.5 h-4.5 px-1 rounded-full font-sans text-[10px] font-semibold text-on-accent ${DOT[mark.severity] ?? DOT.nit}`}
                                >
                                  {numberOf.get(mark.id)}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-right pr-2 text-tertiary">
                              {line.kind === "hunk" ? "" : (line.old ?? "")}
                            </span>
                            <span className="text-right pr-2 text-tertiary">
                              {line.kind === "hunk" ? "" : (line.new ?? "")}
                            </span>
                            <span className={line.kind === "add" ? "text-add-fg" : "text-del-fg"}>
                              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                            </span>
                            <span className="whitespace-pre pr-4">{line.text}</span>
                          </div>
                          {here
                            .flatMap(th => th.comments?.nodes ?? [])
                            .map((c, j) => (
                              <div
                                key={`t${j}`}
                                className="sticky left-0 w-[100cqw] flex gap-2.5 py-2.5 pr-3.5 pl-24.5 bg-fill border-y border-separator font-sans text-[13px] leading-normal"
                              >
                                <span className="grid place-items-center size-5.5 flex-none rounded-full bg-raised text-secondary text-[9px] font-semibold">
                                  {initials(c.author?.login ?? "?")}
                                </span>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs">
                                    <b className="font-semibold">{c.author?.login}</b>{" "}
                                    <span className="text-tertiary">{new Date(c.createdAt).toLocaleDateString()}</span>
                                  </span>
                                  <span className="whitespace-pre-wrap">{c.body}</span>
                                </div>
                              </div>
                            ))}
                          {notes.map(f => (
                            <div
                              key={f.id}
                              onMouseEnter={() => setHot(f.id)}
                              onMouseLeave={() => setHot("")}
                              className={`sticky left-0 w-[100cqw] flex flex-col gap-2 py-2.5 pr-3.5 pl-24.5 bg-raised border-y border-separator font-sans text-[13px] leading-normal ${BAR[f.severity] ?? BAR.nit}`}
                            >
                              <div className="flex items-center gap-2 text-xs">
                                <span
                                  className={`grid place-items-center min-w-4.5 h-4.5 px-1 rounded-full text-[10px] font-semibold text-on-accent ${DOT[f.severity] ?? DOT.nit}`}
                                >
                                  {numberOf.get(f.id)}
                                </span>
                                {claude ? <Glyph svg={claude} className="glyph size-3 text-accent-text" /> : null}
                                <span className={`font-semibold ${SEVERITY[f.severity]}`}>
                                  {t(`review.sev.${f.severity}`)}
                                </span>
                                <span className="flex-1" />
                                <button
                                  className="h-6.5 px-2.25 rounded-[7px] text-xs font-medium text-secondary cursor-pointer hover:text-label"
                                  onClick={() => takeFinding(id, f.id, false)}
                                >
                                  {t("review.dismiss")}
                                </button>
                                <button
                                  className="h-6.5 px-2.25 rounded-[7px] bg-accent text-on-accent text-xs font-medium cursor-pointer"
                                  onClick={() => takeFinding(id, f.id, true)}
                                >
                                  {t("review.addAsComment")}
                                </button>
                              </div>
                              <span className="whitespace-pre-wrap select-text">{f.text}</span>
                            </div>
                          ))}
                          {mine.map(c => (
                            <div
                              key={c.id}
                              className="sticky left-0 w-[100cqw] flex items-start gap-2.5 py-2.5 pr-3.5 pl-24.5 bg-accent-soft border-y border-separator font-sans text-[13px] leading-normal"
                            >
                              <span className="flex-1 whitespace-pre-wrap">{c.body}</span>
                              <span className="text-[11px] font-semibold text-accent-text">{t("review.inReview")}</span>
                              <button
                                className="text-xs text-secondary cursor-pointer hover:text-label"
                                onClick={() => removeComment(id, c.id)}
                              >
                                {t("today.remove")}
                              </button>
                            </div>
                          ))}
                          {on ? (
                            <div className="sticky left-0 w-[100cqw] flex flex-col gap-2 pt-2.5 pb-3 pr-3.5 pl-24.5 bg-accent-soft font-sans text-[13px]">
                              <input
                                autoFocus
                                value={r.draft}
                                onChange={e => setLineDraft(id, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    addLineComment(id);
                                  }
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    pickLine(id, key);
                                  }
                                }}
                                placeholder={t("review.linePlaceholder", { n: anchor!.line })}
                                className="h-8 px-2.5 rounded-lg border border-separator-strong bg-raised text-[13px] outline-0"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  className="h-7 px-2.5 rounded-[7px] text-xs font-medium text-secondary cursor-pointer"
                                  onClick={() => pickLine(id, key)}
                                >
                                  {t("review.cancel")}
                                </button>
                                <button
                                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] border border-separator-strong bg-raised text-xs font-medium cursor-pointer"
                                  onClick={() => askLine(id)}
                                >
                                  {claude ? <Glyph svg={claude} className="glyph size-3" /> : null}
                                  {t("review.askClaude")}
                                </button>
                                <button
                                  disabled={!r.draft.trim()}
                                  className="h-7 px-2.5 rounded-[7px] bg-accent text-on-accent text-xs font-medium cursor-pointer disabled:opacity-50"
                                  onClick={() => addLineComment(id)}
                                >
                                  {t("review.addToReview")}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-secondary">{t("review.noPatch")}</div>
              )}
            </>
          ) : null}
        </div>

        <aside className="min-h-0 flex flex-col border-l border-separator bg-sidebar">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-xs text-secondary">
              {claude ? <Glyph svg={claude} className="glyph size-3.5 text-accent-text" /> : null}
              <b className="font-semibold text-label">{t("review.byClaude")}</b>
              {r.ran && r.read < files.length ? (
                <span className="text-soon" title={t("review.readSomeTip")}>
                  · {t("review.readSome", { n: r.read, total: files.length })}
                </span>
              ) : (
                <span>· {t("review.readFiles", { n: files.length })}</span>
              )}
              <span className="flex-1" />
              <button
                disabled={r.running || !r.files}
                onClick={() =>
                  runFindings(
                    id,
                    prs.map(pr => detailOf(pr.url)?.body ?? ""),
                  )
                }
                className="text-xs text-secondary cursor-pointer hover:text-label disabled:opacity-50"
              >
                {t("review.again")}
              </button>
            </div>
            <span className="text-[13px] text-secondary">
              {r.running
                ? t("review.reading")
                : t("review.found", { n: r.findings.filter(f => f.severity !== "answer").length })}
            </span>
            {/* an index of the findings: the full text and the buttons are under their line in the diff */}
            <div className="flex flex-col gap-0.5">
              {r.findings.map(f => (
                <button
                  key={f.id}
                  onClick={() => go(f)}
                  onMouseEnter={() => setHot(f.id)}
                  onMouseLeave={() => setHot("")}
                  className={`flex items-start gap-2 px-2 py-1.5 -mx-2 rounded-lg text-left cursor-pointer ${hot === f.id ? "bg-accent-soft" : "hover:bg-fill-2"} ${f.state === "open" ? "" : "opacity-55"}`}
                >
                  <span
                    className={`grid place-items-center flex-none min-w-4.5 h-4.5 px-1 mt-px rounded-full text-[10px] font-semibold text-on-accent ${DOT[f.severity] ?? DOT.nit}`}
                  >
                    {numberOf.get(f.id)}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col leading-[1.35]">
                    <span className="text-[13px] line-clamp-2">{f.text}</span>
                    <span className="font-mono text-[11px] text-tertiary truncate">
                      {several ? `#${prs.find(x => x.url === f.pr)?.number} · ` : ""}
                      {f.path.split("/").pop()}:{f.line}
                      {f.state === "added"
                        ? ` · ${t("review.added")}`
                        : f.state === "dismissed"
                          ? ` · ${t("review.dismissed")}`
                          : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-none flex flex-col gap-2.5 px-4 pt-3.5 pb-4 border-t border-separator bg-bg">
            <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-tertiary">
              {t("review.yours", { n: r.comments.length })}
            </span>
            <textarea
              value={r.body}
              onChange={e => setBody(id, e.target.value)}
              rows={3}
              placeholder={t("review.bodyPlaceholder")}
              className="w-full px-2.5 py-2 rounded-lg border border-separator-strong bg-raised text-[13px] leading-normal outline-0 resize-y select-text"
            />
            <div className="flex items-center gap-2">
              <div className="flex bg-fill-2 rounded-[7px] p-0.5">
                {VERDICTS.map(v => (
                  <button
                    key={v}
                    onClick={() => setVerdict(id, v)}
                    className={`h-6 px-2 rounded-[5px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${r.verdict === v ? "bg-raised shadow-sm text-label" : "text-secondary"}`}
                  >
                    {t(`review.verdict.${v}`)}
                  </button>
                ))}
              </div>
              <span className="flex-1" />
              <button
                onClick={() => askConfirm(id, true)}
                className="h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium whitespace-nowrap cursor-pointer hover:bg-accent-hover"
              >
                {t("review.submitShort")}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {r.confirm ? (
        // the design's dialog: small, over the screen; only a click on the backdrop closes it
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]"
          onClick={e => e.target === e.currentTarget && !r.busy && askConfirm(id, false)}
        >
          <div className="w-110 flex flex-col gap-3 p-5 rounded-[14px] bg-bg shadow-2xl">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center size-7.5 rounded-lg bg-fill-2 text-soon">
                <Icon name="bell" className="glyph size-4" />
              </span>
              <b className="text-[15px] font-semibold">{t("review.confirmTitle")}</b>
            </div>
            <span className="text-[13px] leading-relaxed text-secondary">
              {t("review.confirmBody", {
                pr: prs.map(pr => `${pr.repo} #${pr.number}`).join(", "),
                verdict: t(`review.verdict.${r.verdict}`),
                n: r.comments.length,
              })}
            </span>
            {r.err ? <div className="err-box">{r.err}</div> : null}
            <div className="flex justify-end gap-2 mt-1">
              <button className="btn cursor-pointer" disabled={r.busy} onClick={() => askConfirm(id, false)}>
                {t("review.cancel")}
              </button>
              <button className="btn btn-primary cursor-pointer" disabled={r.busy} onClick={() => submitReview(id)}>
                {r.busy ? t("today.saving") : t("review.post")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Stat = { add: number; del: number; notes: number };
/** The changed files as a tree, like GitHub's: a block per PR when the review has several, folders to fold. */
function FileTree({
  groups,
  current,
  stats,
  onPick,
}: {
  groups: { label: string; files: { path: string; index: number }[] }[];
  current: number;
  stats: Stat[];
  onPick: (index: number) => void;
}) {
  const [folded, setFolded] = useState<string[]>([]);
  const toggle = (key: string) =>
    setFolded(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
  const rows = (nodes: TreeNode[], depth: number, group: string): ReactNode[] =>
    nodes.flatMap(node => {
      const pad = { paddingLeft: `${8 + depth * 14}px` };
      if (node.kind === "dir") {
        const key = `${group}|${node.path}`;
        const open = !folded.includes(key);
        return [
          <button
            key={key}
            onClick={() => toggle(key)}
            style={pad}
            className="flex items-center gap-1.5 h-7 pr-2 rounded-md text-left text-[13px] text-secondary cursor-pointer hover:bg-fill-2"
          >
            <Icon
              name="chevron"
              className={`glyph size-3 flex-none transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <Icon name="folder" className="glyph size-3.5 flex-none text-tertiary" />
            <span className="truncate">{node.name}</span>
          </button>,
          ...(open ? rows(node.children, depth + 1, group) : []),
        ];
      }
      const stat = stats[node.index];
      return [
        <button
          key={`${group}|${node.path}`}
          onClick={() => onPick(node.index)}
          style={pad}
          title={node.path}
          className={`flex items-center gap-1.5 h-7 pr-2 rounded-md text-left text-[13px] cursor-pointer ${node.index === current ? "bg-accent-soft text-label font-medium" : "text-label hover:bg-fill-2"}`}
        >
          <span className="size-3 flex-none" />
          <Icon name="file" className="glyph size-3.5 flex-none text-tertiary" />
          <span className="flex-1 min-w-0 truncate">{node.name}</span>
          {stat?.notes ? (
            <span className="min-w-4 h-4 px-1 rounded-full bg-soon text-on-accent text-[10px] grid place-items-center">
              {stat.notes}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-add-fg">+{stat?.add ?? 0}</span>
          <span className="font-mono text-[11px] text-del-fg">−{stat?.del ?? 0}</span>
        </button>,
      ];
    });
  return (
    <nav className="min-h-0 overflow-y-auto border-r border-separator px-2 py-3 flex flex-col gap-0.5">
      {groups.map(group => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {group.label ? (
            <span className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {group.label}
            </span>
          ) : null}
          {rows(fileTree(group.files), 0, group.label)}
        </div>
      ))}
    </nav>
  );
}
