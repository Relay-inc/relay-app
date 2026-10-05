import type { Entry, TodayModel } from "../../../application/today/today";
import { putOff, selectEntry } from "../../../application/today/today";
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
  type Verdict,
} from "../../../application/today/review";
import { useDetailsStore } from "../../../application/today/details";
import { anchorOf } from "../../../domain/pull-requests/diff";
import { timeOf } from "../../../application/calendar/calendar";
import { agent } from "../../../shared/plugins";
import { useT } from "../../hooks/useT";
import { Glyph } from "../../components/Glyph";
import { Icon } from "../../components/Icon";
import { KIND_ICON, TONE_BG, minutes } from "./parts";

const SEVERITY: Record<string, string> = {
  bug: "text-late",
  risk: "text-soon",
  nit: "text-secondary",
  question: "text-accent-text",
  answer: "text-accent-text",
};
const VERDICTS: Verdict[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];
const initials = (name: string) => name.slice(0, 2).toUpperCase();
const iso = (at: number) => new Date(at).toISOString();

/** The review screen of a PR under Today (the design's work mode): the queue as a rail, the diff per file with
 *  GitHub's threads and your comments on the lines, Claude's findings to add or dismiss, and your review, posted on
 *  GitHub only after the dialog. Esc goes back to Today. */
export function ReviewScreen({ model, entry }: { model: TodayModel; entry: Entry }) {
  const { t } = useT();
  const s = entry.subject;
  const r = useReviewStore(st => st.reviews[entry.id]);
  const pr = s.type === "pr" ? s.pr : null;
  const detail = useDetailsStore(st => st.pr[entry.id]);
  if (!pr || !r) return null;
  const files = r.files ?? [];
  const file = files[Math.min(r.file, Math.max(0, files.length - 1))];
  const at = model.placed[entry.id];
  const claude = agent("claude")?.glyph ?? "";
  // GitHub's open threads on this file, by side and line
  const threads = (detail?.reviewThreads?.nodes ?? []).filter(
    th => th.path === file?.path && !th.isResolved && !th.isOutdated,
  );
  const marks = new Map(
    r.findings
      .filter(f => f.state !== "dismissed" && f.path === file?.path)
      .map(f => [lineKey(f.path, f.side, f.line), f]),
  );
  const comments = r.comments.filter(c => c.path === file?.path);
  const asked = (detail?.reviewRequests?.nodes ?? []).length
    ? t("review.asked", { who: pr.author ?? "" })
    : t("today.reviewAsked");

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
        <span className="font-semibold truncate max-w-115">{t("review.title", { n: pr.number, title: pr.title })}</span>
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
          onClick={() => askConfirm(entry.id, true)}
          className="inline-flex items-center gap-2 h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium whitespace-nowrap cursor-pointer hover:bg-accent-hover"
        >
          <Icon name="check" className="glyph size-3.5" />
          {t("review.submit")}
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[64px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r border-separator bg-sidebar py-2.5 flex flex-col items-center gap-1">
          {model.queue.map(item => {
            const on = item.id === entry.id;
            return (
              <button
                key={item.id}
                title={item.title}
                onClick={() => {
                  closeReview();
                  selectEntry(item.id);
                }}
                className={`relative grid place-items-center w-10 h-9 rounded-[9px] cursor-pointer hover:bg-fill-2 ${on ? "bg-accent-soft text-accent-text" : "text-secondary"}`}
              >
                <Icon name={KIND_ICON[item.kind]} className="glyph size-4" />
                <span
                  className={`absolute left-0.75 top-2.5 w-0.75 h-4 rounded-sm ${on ? "bg-accent" : TONE_BG[item.tone]}`}
                />
              </button>
            );
          })}
        </div>

        <div className="min-w-0 min-h-0 grid grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 min-h-0 overflow-y-auto px-5 pt-4 pb-6 flex flex-col gap-2.5 select-text">
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => showFile(entry.id, i)}
                  className={`inline-flex items-center gap-2 h-7 px-2.5 rounded-[7px] border font-mono text-xs cursor-pointer ${f === file ? "border-accent bg-accent-soft" : "border-separator-strong hover:bg-fill"}`}
                >
                  <Icon name="file" className="glyph size-3 text-tertiary" />
                  {f.path}
                  <span className="text-add-fg">+{f.additions}</span>
                  <span className="text-del-fg">−{f.deletions}</span>
                </button>
              ))}
            </div>
            {r.err ? <div className="err-box">{r.err}</div> : null}
            {!r.files ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
            {file ? (
              <>
                <span className="text-xs text-tertiary">{t("review.clickLine")}</span>
                {file.lines.length ? (
                  <div className="flex flex-col border border-separator rounded-[10px] overflow-hidden font-mono text-xs leading-5.5">
                    {file.lines.map((line, i) => {
                      const anchor = anchorOf(line);
                      const key = anchor ? lineKey(file.path, anchor.side, anchor.line) : "";
                      const on = !!key && r.line === key;
                      const mark = key ? marks.get(key) : undefined;
                      const here = anchor ? threads.filter(th => th.line === anchor.line) : [];
                      const mine = anchor ? comments.filter(c => c.side === anchor.side && c.line === anchor.line) : [];
                      const bg = on
                        ? "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]"
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
                            onClick={() => key && pickLine(entry.id, key)}
                            className={`grid grid-cols-[40px_40px_18px_minmax(0,1fr)_16px] ${key ? "cursor-pointer" : ""} ${bg}`}
                          >
                            <span className="text-right pr-2 text-tertiary">
                              {line.kind === "hunk" ? "" : (line.old ?? "")}
                            </span>
                            <span className="text-right pr-2 text-tertiary">
                              {line.kind === "hunk" ? "" : (line.new ?? "")}
                            </span>
                            <span className={line.kind === "add" ? "text-add-fg" : "text-del-fg"}>
                              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                            </span>
                            <span className="whitespace-pre overflow-hidden text-ellipsis">{line.text}</span>
                            <span className="grid place-items-center">
                              {mark ? (
                                <span
                                  className={`size-1.75 rounded-full ${mark.severity === "bug" ? "bg-late" : mark.severity === "risk" ? "bg-soon" : "bg-secondary"}`}
                                />
                              ) : null}
                            </span>
                          </div>
                          {here
                            .flatMap(th => th.comments?.nodes ?? [])
                            .map((c, j) => (
                              <div
                                key={`t${j}`}
                                className="flex gap-2.5 py-2.5 pr-3.5 pl-24.5 bg-fill border-y border-separator font-sans text-[13px] leading-normal"
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
                          {mine.map(c => (
                            <div
                              key={c.id}
                              className="flex items-start gap-2.5 py-2.5 pr-3.5 pl-24.5 bg-accent-soft border-y border-separator font-sans text-[13px] leading-normal"
                            >
                              <span className="flex-1 whitespace-pre-wrap">{c.body}</span>
                              <span className="text-[11px] font-semibold text-accent-text">{t("review.inReview")}</span>
                              <button
                                className="text-xs text-secondary cursor-pointer hover:text-label"
                                onClick={() => removeComment(entry.id, c.id)}
                              >
                                {t("today.remove")}
                              </button>
                            </div>
                          ))}
                          {on ? (
                            <div className="flex flex-col gap-2 pt-2.5 pb-3 pr-3.5 pl-24.5 bg-accent-soft font-sans text-[13px]">
                              <input
                                autoFocus
                                value={r.draft}
                                onChange={e => setLineDraft(entry.id, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    addLineComment(entry.id);
                                  }
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    pickLine(entry.id, key);
                                  }
                                }}
                                placeholder={t("review.linePlaceholder", { n: anchor!.line })}
                                className="h-8 px-2.5 rounded-lg border border-separator-strong bg-raised text-[13px] outline-0"
                              />
                              <div className="flex justify-end gap-2">
                                <button
                                  className="h-7 px-2.5 rounded-[7px] text-xs font-medium text-secondary cursor-pointer"
                                  onClick={() => pickLine(entry.id, key)}
                                >
                                  {t("review.cancel")}
                                </button>
                                <button
                                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[7px] border border-separator-strong bg-raised text-xs font-medium cursor-pointer"
                                  onClick={() => askLine(entry.id)}
                                >
                                  {claude ? <Glyph svg={claude} className="glyph size-3" /> : null}
                                  {t("review.askClaude")}
                                </button>
                                <button
                                  disabled={!r.draft.trim()}
                                  className="h-7 px-2.5 rounded-[7px] bg-accent text-on-accent text-xs font-medium cursor-pointer disabled:opacity-50"
                                  onClick={() => addLineComment(entry.id)}
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
                <span>· {t("review.readFiles", { n: files.length })}</span>
                <span className="flex-1" />
                <button
                  disabled={r.running || !r.files}
                  onClick={() => runFindings(entry.id, pr, detail?.body ?? "")}
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
              {r.findings.map(f => (
                <div
                  key={f.id}
                  className={`flex flex-col gap-2 p-3 rounded-[10px] bg-raised shadow-sm ring-1 ${f.state === "added" ? "ring-ok" : "ring-separator-strong"} ${f.state === "dismissed" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`h-5 px-1.75 rounded-[5px] bg-fill-2 font-semibold inline-flex items-center ${SEVERITY[f.severity]}`}
                    >
                      {t(`review.sev.${f.severity}`)}
                    </span>
                    <button
                      onClick={() => {
                        const i = files.findIndex(x => x.path === f.path);
                        if (i >= 0) showFile(entry.id, i);
                      }}
                      className="font-mono text-[11px] text-accent-text cursor-pointer"
                    >
                      {f.path.split("/").pop()}:{f.line}
                    </button>
                    <span className="flex-1" />
                    <span className="text-[11px] font-semibold text-ok">
                      {f.state === "added" ? t("review.added") : f.state === "dismissed" ? t("review.dismissed") : ""}
                    </span>
                  </div>
                  <div className="text-[13px] leading-normal select-text">{f.text}</div>
                  {f.state === "open" ? (
                    <div className="flex gap-1.5 justify-end">
                      <button
                        className="h-6.5 px-2.25 rounded-[7px] text-xs font-medium text-secondary cursor-pointer"
                        onClick={() => takeFinding(entry.id, f.id, false)}
                      >
                        {t("review.dismiss")}
                      </button>
                      <button
                        className="h-6.5 px-2.25 rounded-[7px] bg-accent text-on-accent text-xs font-medium cursor-pointer"
                        onClick={() => takeFinding(entry.id, f.id, true)}
                      >
                        {t("review.addAsComment")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex-none flex flex-col gap-2.5 px-4 pt-3.5 pb-4 border-t border-separator bg-bg">
              <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-tertiary">
                {t("review.yours", { n: r.comments.length })}
              </span>
              <textarea
                value={r.body}
                onChange={e => setBody(entry.id, e.target.value)}
                rows={3}
                placeholder={t("review.bodyPlaceholder")}
                className="w-full px-2.5 py-2 rounded-lg border border-separator-strong bg-raised text-[13px] leading-normal outline-0 resize-y select-text"
              />
              <div className="flex items-center gap-2">
                <div className="flex bg-fill-2 rounded-[7px] p-0.5">
                  {VERDICTS.map(v => (
                    <button
                      key={v}
                      onClick={() => setVerdict(entry.id, v)}
                      className={`h-6 px-2 rounded-[5px] text-[11px] font-medium whitespace-nowrap cursor-pointer ${r.verdict === v ? "bg-raised shadow-sm text-label" : "text-secondary"}`}
                    >
                      {t(`review.verdict.${v}`)}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                <button
                  onClick={() => askConfirm(entry.id, true)}
                  className="h-7.5 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium whitespace-nowrap cursor-pointer hover:bg-accent-hover"
                >
                  {t("review.submitShort")}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {r.confirm ? (
        // the design's dialog: small, over the screen; only a click on the backdrop closes it
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]"
          onClick={e => e.target === e.currentTarget && !r.busy && askConfirm(entry.id, false)}
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
                pr: `${pr.repo} #${pr.number}`,
                verdict: t(`review.verdict.${r.verdict}`),
                n: r.comments.length,
              })}
            </span>
            {r.err ? <div className="err-box">{r.err}</div> : null}
            <div className="flex justify-end gap-2 mt-1">
              <button className="btn cursor-pointer" disabled={r.busy} onClick={() => askConfirm(entry.id, false)}>
                {t("review.cancel")}
              </button>
              <button
                className="btn btn-primary cursor-pointer"
                disabled={r.busy}
                onClick={() => submitReview(entry.id, pr)}
              >
                {r.busy ? t("today.saving") : t("review.post")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
