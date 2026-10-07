import { useEffect, useMemo } from "react";
import { totals, type ChangedFile, type RepoChanges } from "../../../domain/conversations/changes";
import { anchorOf, parsePatch } from "../../../domain/pull-requests/diff";
import { useNavigationStore } from "../../../application/navigation/store";
import { useConversationsStore } from "../../../application/conversations/store";
import { useChangesStore } from "../../../application/changes/store";
import {
  addComment,
  loadChanges,
  openFile,
  pickLine,
  removeComment,
  sendComments,
  setLineDraft,
} from "../../../application/changes/changes";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";

const STATUS = {
  A: "text-add-fg border-add-fg",
  D: "text-del-fg border-del-fg",
  M: "text-soon border-soon",
  R: "text-secondary border-separator-strong",
} as const;

/** The open conversation's changes, from git: its files per repo, and a file's diff to comment on line by line. The
 *  comments go to the composer together, as one message to the agent. */
export function ChangesPanel() {
  const { t } = useT();
  const key = useNavigationStore(s => s.selected);
  // a turn that ends may have changed files: load again then
  const busy = useConversationsStore(s => s.status[key] === "busy");
  const { repos, err, open } = useChangesStore();
  const comments = useChangesStore(s => s.comments[key]) ?? [];

  useEffect(() => {
    if (!busy) loadChanges(key);
  }, [key, busy]);

  const [openRepo, openPath] = open.split("\n");
  const repo = repos?.find(r => r.repo === openRepo);
  const file = repo?.files.find(f => f.path === openPath);
  const sum = repos ? totals(repos) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5 select-none">
      <div className="flex items-center gap-2 text-[13px]">
        {file ? (
          <button
            className="inline-flex items-center gap-1 text-secondary cursor-pointer hover:text-label"
            onClick={() => openFile("", "")}
          >
            <Icon name="left" className="glyph size-3.5" />
            {t("changes.back")}
          </button>
        ) : sum ? (
          <span className="font-semibold">
            {t("changes.count", { n: sum.files })} <span className="text-add-fg">+{sum.add}</span>{" "}
            <span className="text-del-fg">−{sum.del}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          className="btn-icon"
          title={t("changes.refresh")}
          aria-label={t("changes.refresh")}
          onClick={() => loadChanges(key)}
        >
          <Icon name="refresh" className="glyph size-4" />
        </button>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
      {!repos && !err ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
      {repos && !sum?.files ? <div className="text-sm text-secondary">{t("changes.empty")}</div> : null}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {repo && file ? (
          <FileDiff repo={repo} file={file} />
        ) : (
          repos?.filter(r => r.files.length).map(r => <RepoFiles key={r.repo} repo={r} several={repos.length > 1} />)
        )}
      </div>
      {repos?.length ? <span className="text-xs text-tertiary">{t("changes.notGit")}</span> : null}
      {comments.length ? (
        <button
          className="h-8 rounded-lg bg-accent text-on-accent text-[13px] font-medium cursor-pointer"
          onClick={() => repos && sendComments(repos)}
        >
          {comments.length === 1 ? t("changes.sendOne") : t("changes.send", { n: comments.length })}
        </button>
      ) : null}
    </div>
  );
}

function RepoFiles({ repo, several }: { repo: RepoChanges; several: boolean }) {
  const { t } = useT();
  return (
    <div className="flex flex-col mb-3">
      <div className="flex items-baseline gap-1.5 px-1 pb-1 text-xs text-tertiary">
        {several ? <span className="font-semibold text-secondary">{repo.name}</span> : null}
        <span className="font-mono">{repo.branch}</span>
        <span>{t("changes.vs", { base: repo.base })}</span>
      </div>
      {repo.files.map(f => {
        const cut = f.path.lastIndexOf("/");
        return (
          <button
            key={f.path}
            className="grid grid-cols-[minmax(0,auto)_minmax(0,max-content)_1fr_auto] items-center gap-0 h-8 px-1.5 rounded-md text-left text-[13px] cursor-pointer hover:bg-fill"
            title={f.path}
            onClick={() => openFile(repo.repo, f.path)}
          >
            {/* the folder cut off at its start, so the part nearest the file stays; a left-to-right mark on both ends, or
                rtl moves the slashes */}
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-tertiary [direction:rtl]">
              {cut > 0 ? `\u200e${f.path.slice(0, cut + 1)}\u200e` : ""}
            </span>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">{f.path.slice(cut + 1)}</span>
            <span />
            <span className="flex items-center gap-1.5 pl-3 font-mono text-xs">
              {f.add ? <span className="text-add-fg">+{f.add}</span> : null}
              {f.del ? <span className="text-del-fg">−{f.del}</span> : null}
              <span
                className={`grid place-items-center size-3.5 rounded-[3px] border text-[9px] font-sans font-bold ${STATUS[f.status]}`}
              >
                {f.status}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FileDiff({ repo, file }: { repo: RepoChanges; file: ChangedFile }) {
  const { t } = useT();
  const lines = useMemo(() => parsePatch(file.patch), [file.patch]);
  const { line: picked, draft } = useChangesStore();
  const comments = (useChangesStore(s => s.comments[s.key]) ?? []).filter(
    c => c.repo === repo.repo && c.path === file.path,
  );
  return (
    <div className="flex flex-col gap-2 select-text">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className="font-semibold text-label break-all">{file.path}</span>
        <span className="text-add-fg">+{file.add}</span>
        <span className="text-del-fg">−{file.del}</span>
      </div>
      {file.binary || !lines.length ? (
        <div className="text-sm text-secondary">{t("changes.binary")}</div>
      ) : (
        <>
          <span className="text-xs text-tertiary">{t("changes.clickLine")}</span>
          {/* long lines scroll sideways; every row is as wide as the widest, so the colours run through */}
          <div className="shrink-0 border border-separator rounded-[10px] overflow-x-auto overflow-y-hidden font-mono text-xs leading-5.5 [container-type:inline-size]">
            <div className="w-max min-w-full flex flex-col">
              {lines.map((line, i) => {
                const anchor = anchorOf(line);
                const key = anchor ? `${anchor.side}:${anchor.line}` : "";
                const on = !!key && picked === key;
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
                      onClick={() => key && pickLine(key)}
                      className={`grid grid-cols-[36px_36px_18px_minmax(0,1fr)] ${key ? "cursor-pointer" : ""} ${bg}`}
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
                      <span className="whitespace-pre pr-4">{line.text}</span>
                    </div>
                    {mine.map(c => (
                      <div
                        key={c.id}
                        className="sticky left-0 w-[100cqw] flex items-start gap-2.5 py-2.5 pr-3.5 pl-22.5 bg-accent-soft border-y border-separator font-sans text-[13px] leading-normal"
                      >
                        <span className="flex-1 whitespace-pre-wrap">{c.body}</span>
                        <button
                          className="text-xs text-secondary cursor-pointer hover:text-label"
                          onClick={() => removeComment(c.id)}
                        >
                          {t("today.remove")}
                        </button>
                      </div>
                    ))}
                    {on && anchor && line.kind !== "hunk" ? (
                      <div className="sticky left-0 w-[100cqw] flex flex-col gap-2 pt-2.5 pb-3 pr-3.5 pl-22.5 bg-accent-soft font-sans text-[13px]">
                        <textarea
                          autoFocus
                          rows={2}
                          value={draft}
                          onChange={e => setLineDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              addComment(repo.repo, file.path, anchor.side, anchor.line, line.text);
                            }
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              pickLine(key);
                            }
                          }}
                          placeholder={t("changes.linePlaceholder", { n: anchor.line })}
                          className="px-2.5 py-1.5 rounded-lg border border-separator-strong bg-raised text-[13px] outline-0 resize-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            className="h-7 px-2.5 rounded-[7px] text-xs font-medium text-secondary cursor-pointer"
                            onClick={() => pickLine(key)}
                          >
                            {t("review.cancel")}
                          </button>
                          <button
                            disabled={!draft.trim()}
                            className="h-7 px-2.5 rounded-[7px] bg-accent text-on-accent text-xs font-medium cursor-pointer disabled:opacity-50"
                            onClick={() => addComment(repo.repo, file.path, anchor.side, anchor.line, line.text)}
                          >
                            {t("changes.add")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
