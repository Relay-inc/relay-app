import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { writtenPaths, type GitFile, type GitRepo } from "../../../domain/git/git";
import { anchorOf, parsePatch } from "../../../domain/pull-requests/diff";
import { useNavigationStore } from "../../../application/navigation/store";
import { useConversationsStore } from "../../../application/conversations/store";
import { selectedProject } from "../../../application/conversations/selectors";
import { useGitStore } from "../../../application/git/store";
import {
  addComment,
  askDiscard,
  busyRepos,
  commitStaged,
  discardFile,
  followGit,
  loadGit,
  openFile,
  pickLine,
  removeComment,
  sendComments,
  setLineDraft,
  setMessage,
  stagedRepos,
  suggestMessage,
  toggleFold,
  toggleStaged,
} from "../../../application/git/git";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { ModalHeader } from "../../components/ModalHeader";

const STATUS: Record<string, string> = {
  A: "text-add-fg border-add-fg",
  D: "text-del-fg border-del-fg",
  M: "text-soon border-soon",
  U: "text-late border-late",
  "?": "text-tertiary border-separator-strong",
};

// a colour per repo, in the order the drawer lists them: the macOS system colours, without the red and orange the
// file badges use
const REPO_COLOURS = ["#007aff", "#34c759", "#af52de", "#ff2d55", "#30b0c7", "#ffcc00", "#5856d6", "#a2845e"];

/** The project's checkouts as git sees them: per repo its branch and its changed files (staged ones ticked), under
 *  them one commit box for every repo with something staged, as in JetBrains, and a file's diff in a window over the app to comment on line by line. The comments go to the composer together,
 *  as one message to the agent. */
export function GitPanel() {
  const { t } = useT();
  const key = useNavigationStore(s => s.selected);
  const project = useDerived(() => selectedProject()) ?? "";
  const busy = useConversationsStore(s => s.status[key] === "busy");
  const written = useDerived(() => writtenPaths(useConversationsStore.getState().messages[key]));
  const blocked = useDerived(() => busyRepos());
  const { repos, err, open, discard } = useGitStore();
  const comments = useGitStore(s => s.comments[key]) ?? [];

  useEffect(() => followGit(key, project, busy), [key, project, busy]);

  const [openRepo, openPath] = open.split("\n");
  const repo = repos?.find(r => r.repo === openRepo);
  const file = repo?.files.find(f => f.path === openPath);
  // every file over every repo, for the window's previous and next
  const all = (repos ?? []).flatMap(r => r.files.map(f => ({ repo: r.repo, path: f.path })));
  const at = all.findIndex(f => f.repo === openRepo && f.path === openPath);
  const step = (by: number) => {
    const next = all[at + by];
    if (next) openFile(next.repo, next.path);
  };
  const send =
    comments.length && repos ? (
      <button
        className="h-8 px-3 rounded-lg bg-accent text-on-accent text-[13px] font-medium cursor-pointer"
        onClick={() => {
          sendComments(repos);
          openFile("", "");
        }}
      >
        {comments.length === 1 ? t("git.sendOne") : t("git.send", { n: comments.length })}
      </button>
    ) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5 select-none">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="flex-1" />
        <button
          className="btn-icon"
          title={t("git.refresh")}
          aria-label={t("git.refresh")}
          onClick={() => loadGit(key, project)}
        >
          <Icon name="refresh" className="glyph size-4" />
        </button>
      </div>
      {err ? <div className="err-box">{err}</div> : null}
      {!repos && !err ? <div className="text-sm text-secondary">{t("kb.loading")}</div> : null}
      {repos && !repos.length ? <div className="text-sm text-secondary">{t("git.noRepos")}</div> : null}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {repos?.map((r, i) => (
          <RepoBox key={r.repo} repo={r} written={written} colour={REPO_COLOURS[i % REPO_COLOURS.length]} />
        ))}
      </div>
      {repos?.some(r => r.files.length) ? <CommitBox repos={repos} blocked={blocked} /> : null}
      {send}
      {/* over the whole window, not inside the drawer */}
      {repo && file
        ? createPortal(
            <Modal onClose={() => openFile("", "")}>
              <ModalHeader
                left={
                  <span className="flex items-center gap-2 min-w-0 font-mono text-xs">
                    {repos && repos.length > 1 ? <span className="text-tertiary">{repo.name} ·</span> : null}
                    <span className="font-semibold text-label truncate">{file.path}</span>
                    <span className="text-add-fg">+{file.add}</span>
                    <span className="text-del-fg">−{file.del}</span>
                  </span>
                }
                position={`${at + 1} / ${all.length}`}
                first={at <= 0}
                last={at >= all.length - 1}
                onStep={step}
                onClose={() => openFile("", "")}
              />
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-6">
                <FileDiff repo={repo} file={file} />
              </div>
              {send ? (
                <div className="flex-none flex justify-end px-5 py-3 border-t border-separator">{send}</div>
              ) : null}
            </Modal>,
            document.body,
          )
        : null}
      {discard ? createPortal(<DiscardDialog what={discard} />, document.body) : null}
    </div>
  );
}

/** Discarding loses work: asked in a small dialog over the app, only its buttons or Esc decide. */
function DiscardDialog({ what }: { what: string }) {
  const { t } = useT();
  const path = what.split("\n")[1];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,10,14,.32)]">
      <div role="alertdialog" className="w-110 flex flex-col gap-3 p-5 rounded-[14px] bg-bg shadow-2xl">
        <b className="text-[15px] font-semibold">{t("git.discardTitle")}</b>
        <span className="text-[13px] leading-relaxed text-secondary">
          <span className="font-mono text-label break-all">{path}</span> {t("git.discardBody")}
        </span>
        <div className="flex justify-end gap-2 mt-1">
          <button className="btn cursor-pointer" autoFocus onClick={() => askDiscard("", "")}>
            {t("review.cancel")}
          </button>
          <button className="btn btn-primary cursor-pointer" onClick={() => discardFile()}>
            {t("git.discard")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The one message for every repo with staged files: each gets its own commit with it, pushed when asked. */
function CommitBox({ repos, blocked }: { repos: GitRepo[]; blocked: string[] }) {
  const { t } = useT();
  const message = useGitStore(s => s.message);
  const suggesting = useGitStore(s => s.suggesting);
  const running = useGitStore(s => !!s.running);
  const staged = stagedRepos(repos);
  // why a commit cannot go now, as the buttons' title
  const why = staged.some(r => blocked.includes(r.repo))
    ? t("git.busy")
    : !staged.length
      ? t("git.nothingStaged")
      : !message.trim()
        ? t("git.noMessage")
        : "";
  const commit = (push: boolean) =>
    commitStaged(
      staged.map(r => r.repo),
      push,
    );
  return (
    <div className="flex-none flex flex-col gap-1.5 pt-2.5 px-1 border-t border-separator">
      <div className="relative">
        <textarea
          rows={3}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t("git.message")}
          aria-label={t("git.message")}
          className="field h-auto w-full py-1.5 pr-9 resize-none select-text"
        />
        <button
          className="btn-icon absolute right-1 top-1 disabled:opacity-40"
          disabled={!staged.length || suggesting}
          title={staged.length ? t("git.suggest") : t("git.nothingStaged")}
          aria-label={t("git.suggest")}
          onClick={() => suggestMessage(staged)}
        >
          {suggesting ? <span className="spinner" /> : <Icon name="wand" className="glyph size-4" />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* with several repos, which ones get a commit */}
        <span className="flex-1 min-w-0 truncate text-xs text-tertiary">
          {repos.length > 1 && staged.length ? t("git.commitIn", { repos: staged.map(r => r.name).join(", ") }) : ""}
        </span>
        <button
          className="btn disabled:opacity-50"
          disabled={!!why || running}
          title={why || undefined}
          onClick={() => commit(false)}
        >
          {t("git.commit")}
        </button>
        <button
          className="btn btn-primary disabled:opacity-50"
          disabled={!!why || running}
          title={why || undefined}
          onClick={() => commit(true)}
        >
          {t("git.commitPush")}
        </button>
      </div>
    </div>
  );
}

function RepoBox({ repo, written, colour }: { repo: GitRepo; written: string[]; colour: string }) {
  const { t } = useT();
  const running = useGitStore(s => s.running === repo.repo);
  const err = useGitStore(s => s.errs[repo.repo]) ?? repo.err ?? "";
  const folded = useGitStore(s => !!s.folded[repo.repo]);
  const changed = repo.files.filter(f => !f.untracked);
  const loose = repo.files.filter(f => f.untracked);
  const staged = repo.files.filter(f => f.staged).length;
  return (
    <div className={`flex flex-col ${folded ? "mb-0.5" : "mb-3"}`}>
      <div className={`flex items-center gap-1.5 px-1 ${folded ? "" : "pb-1"}`}>
        <button
          className="flex-none flex items-center gap-1 max-w-[60%] -ml-1 pl-1 pr-1.5 h-6 rounded-md cursor-pointer hover:bg-fill"
          title={repo.repo}
          aria-expanded={!folded}
          onClick={() => toggleFold(repo.repo)}
        >
          <Icon
            name="chevron"
            className={`glyph size-3 flex-none text-tertiary transition-transform ${folded ? "-rotate-90" : ""}`}
          />
          <span className="flex-none size-2.5 rounded-[3px]" style={{ background: colour }} />
          <span className="ml-0.5 text-[13px] font-semibold truncate">{repo.name}</span>
        </button>
        {/* the name left, the branch and the counts right */}
        <span className="flex-1" />
        {repo.branch ? (
          // one line: the branch name gives way first, cut off with an ellipsis, the counts stay
          <span
            className="min-w-0 flex items-center gap-1 h-5 px-1.5 rounded-md bg-fill-2 text-xs text-secondary font-mono whitespace-nowrap"
            title={repo.branch}
          >
            <Icon name="branch" className="glyph size-3 flex-none" />
            <span className="min-w-0 truncate">{repo.branch}</span>
            {repo.ahead ? (
              <span className="flex-none" title={t("git.ahead", { n: repo.ahead })}>
                ↑{repo.ahead}
              </span>
            ) : null}
            {repo.behind ? (
              <span className="flex-none" title={t("git.behind", { n: repo.behind })}>
                ↓{repo.behind}
              </span>
            ) : null}
          </span>
        ) : null}
        {/* folded, what it hides: its files, the ticked ones first */}
        {folded && repo.files.length ? (
          <span className="flex-none text-xs text-tertiary tabular-nums">
            {staged ? `${staged}/${repo.files.length}` : repo.files.length}
          </span>
        ) : null}
        {running ? <span className="spinner" /> : null}
      </div>
      {folded ? null : (
        <>
          {!repo.files.length && !repo.err ? <div className="px-1 text-xs text-tertiary">{t("git.clean")}</div> : null}
          {changed.length ? (
            <Group id="changes" title={t("git.changes")} repo={repo} files={changed} written={written} />
          ) : null}
          {loose.length ? (
            <Group id="unversioned" title={t("git.unversioned")} repo={repo} files={loose} written={written} />
          ) : null}
        </>
      )}
      {err ? <div className="err-box mt-2 mx-1 select-text">{err}</div> : null}
    </div>
  );
}

function Group({
  id,
  title,
  repo,
  files,
  written,
}: {
  id: string;
  title: string;
  repo: GitRepo;
  files: GitFile[];
  written: string[];
}) {
  const { t } = useT();
  const folded = useGitStore(s => !!s.folded[`${repo.repo}\n${id}`]);
  return (
    <div className="flex flex-col">
      <button
        className="self-start flex items-center gap-1 h-6 -ml-0.5 pl-0.5 pr-1.5 rounded-md text-xs text-tertiary cursor-pointer hover:bg-fill"
        aria-expanded={!folded}
        onClick={() => toggleFold(`${repo.repo}\n${id}`)}
      >
        <Icon name="chevron" className={`glyph size-2.5 transition-transform ${folded ? "-rotate-90" : ""}`} />
        {title} <span className="tabular-nums">{files.length}</span>
      </button>
      {(folded ? [] : files).map(f => {
        const cut = f.path.lastIndexOf("/");
        const mine = written.includes(`${repo.repo}/${f.path}`);
        return (
          <div
            key={f.path}
            className="group flex items-center gap-1.5 h-8 pl-1.5 pr-1 rounded-md text-[13px] hover:bg-fill"
          >
            <input
              type="checkbox"
              className="flex-none cursor-pointer"
              checked={f.staged}
              aria-label={f.staged ? t("git.unstage", { path: f.path }) : t("git.stage", { path: f.path })}
              onChange={() => toggleStaged(repo.repo, f)}
            />
            <button
              className="flex-1 min-w-0 grid grid-cols-[minmax(0,auto)_minmax(0,max-content)_1fr_auto] items-center h-full text-left cursor-pointer"
              title={f.orig ? `${f.orig} → ${f.path}` : f.path}
              onClick={() => openFile(repo.repo, f.path)}
            >
              {/* the folder cut off at its start, so the part nearest the file stays; a left-to-right mark on both ends, or
                  rtl moves the slashes */}
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-tertiary [direction:rtl]">
                {cut > 0 ? `\u200e${f.path.slice(0, cut + 1)}\u200e` : ""}
              </span>
              <span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium">
                {f.path.slice(cut + 1)}
              </span>
              <span />
              <span className="flex items-center gap-1.5 pl-3 font-mono text-xs">
                {/* a hint, git decides what changed: the open conversation wrote this file */}
                {mine ? <span className="size-1.5 rounded-full bg-accent" title={t("git.written")} /> : null}
                {f.add ? <span className="text-add-fg">+{f.add}</span> : null}
                {f.del ? <span className="text-del-fg">−{f.del}</span> : null}
                <span
                  className={`grid place-items-center size-3.5 rounded-[3px] border text-[9px] font-sans font-bold ${STATUS[f.status] ?? "text-secondary border-separator-strong"}`}
                >
                  {f.status}
                </span>
              </span>
            </button>
            <button
              className="btn-icon size-6! opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title={t("git.discard")}
              aria-label={t("git.discardFile", { path: f.path })}
              onClick={() => askDiscard(repo.repo, f.path)}
            >
              <Icon name="undo" className="glyph size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FileDiff({ repo, file }: { repo: GitRepo; file: GitFile }) {
  const { t } = useT();
  const lines = useMemo(() => parsePatch(file.patch), [file.patch]);
  const { line: picked, draft } = useGitStore();
  const comments = (useGitStore(s => s.comments[s.key]) ?? []).filter(
    c => c.repo === repo.repo && c.path === file.path,
  );
  return (
    <div className="flex flex-col gap-2 select-text">
      {file.binary || !lines.length ? (
        <div className="text-sm text-secondary">{t("git.binary")}</div>
      ) : (
        <>
          <span className="text-xs text-tertiary">{t("git.clickLine")}</span>
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
                          placeholder={t("git.linePlaceholder", { n: anchor.line })}
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
                            {t("git.add")}
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
