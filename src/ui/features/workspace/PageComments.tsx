import { useEffect, useRef, useState } from "react";
import {
  addComment,
  loadComments,
  onComments,
  type PageComments as Comments,
} from "../../../application/navigation/pages";
import {
  membersFor,
  mentionQuery,
  mentionsIn,
  type CommentThread,
  type Member,
  type Span,
} from "../../../domain/workspace/comments";
import { agoOf } from "../brain/ago";
import { useT } from "../../hooks/useT";
import { Note } from "../../components/Note";
import type { CommentsApi } from "./PageEditor";

/** A page's comments beside it (ticket 11), in the place of its history: the open threads in the order of their text,
 *  each with its quote, replies, Reply, Resolve and Delete (one's own); then the resolved ones, folded. A selection in
 *  the page (or ⌘⌥M) starts a new comment on it. `edits`: counts the page's edits, so anchors are found again. */
export function PageComments({
  page,
  api,
  hasSelection,
  compose,
  open,
  onOpen,
  edits,
}: {
  page: string;
  api: { current: CommentsApi | null };
  hasSelection: boolean;
  compose: { n: number; sel: { from: number; to: number; quote: string } | null }; // ⌘⌥M: a draft on that selection
  open: string | null; // the thread opened (its text clicked, or picked here)
  onOpen: (id: string | null) => void;
  edits: number;
}) {
  const { t } = useT();
  const [data, setData] = useState<Comments | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<{ from: number; to: number; quote: string } | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const reload = () => void loadComments(page).then(setData, e => setErr(String(e)));
  useEffect(reload, [page]);
  // another member's comment arrives on a shared document
  const doc = data?.doc;
  useEffect(() => {
    if (!doc) return;
    const stop = onComments(doc, reload);
    return () => void stop.then(f => f());
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘⌥M: its selection becomes the draft (once per press)
  const [pressed, setPressed] = useState(compose.n);
  if (compose.n !== pressed) {
    setPressed(compose.n);
    if (compose.sel) setDraft(compose.sel);
  }

  const threads = data?.threads ?? [];
  // where each thread's text is now (anchors move with the text)
  const spans = new Map<string, Span>();
  void edits;
  for (const th of threads) spans.set(th.id, api.current?.locate(th.anchor, th.quote) ?? null);
  const openThreads = threads
    .filter(th => !th.resolved)
    .sort((a, b) => (spans.get(a.id)?.from ?? Infinity) - (spans.get(b.id)?.from ?? Infinity));
  const resolved = threads.filter(th => th.resolved);
  const marked = openThreads.flatMap(th => {
    const s = spans.get(th.id);
    return s ? [{ id: th.id, ...s }] : [];
  });
  const key = marked.map(m => `${m.id}:${m.from}:${m.to}`).join(",") + `|${open}`;
  useEffect(() => {
    api.current?.mark(marked, open);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => api.current?.mark([], null), [api]);

  const act = (kind: string, on: string, text = "", mentions: string[] = []) =>
    addComment(page, kind, on, text, "", null, mentions).then(reload, e => setErr(String(e)));
  // who an @ may name: a shared document's other members (none on a note of this Mac's own)
  const members = data?.members ?? [];

  return (
    <aside className="w-80 flex-none min-h-0 overflow-y-auto border-l border-separator flex flex-col">
      <div className="h-10 flex-none flex items-center gap-2 px-4">
        <span className="flex-1 text-[13px] font-medium text-label">{t("page.comments")}</span>
        <button
          className="h-7 px-2.5 rounded-md border border-separator text-[13px] text-label hover:bg-fill disabled:opacity-40"
          disabled={!hasSelection}
          title={t("page.commentHint")}
          onClick={() => setDraft(api.current?.selection() ?? null)}
        >
          {t("page.comment")}
        </button>
      </div>
      {err ? <div className="err-box mx-3 mb-2">{err}</div> : null}
      {draft ? (
        <Composer
          className="mx-3 mb-2"
          quote={draft.quote}
          placeholder={t(members.length ? "page.commentPlaceholderTeam" : "page.commentPlaceholder")}
          send={t("page.comment")}
          members={members}
          onCancel={() => setDraft(null)}
          onSend={(text, mentions) =>
            addComment(
              page,
              "comment",
              "",
              text,
              draft.quote,
              api.current?.anchor(draft.from, draft.to),
              mentions,
            ).then(
              id => {
                setDraft(null);
                onOpen(id);
                reload();
              },
              e => setErr(String(e)),
            )
          }
        />
      ) : null}
      {!data ? (
        <div className="px-4">
          <Note>{t("pr.loading")}</Note>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {!threads.length && !draft ? <Note>{t("page.commentHint")}</Note> : null}
          {data.kind === "file" && threads.length ? (
            <p className="px-1 text-xs text-tertiary">{t("page.commentsHere")}</p>
          ) : null}
          {openThreads.map(th => (
            <Thread
              key={th.id}
              thread={th}
              span={spans.get(th.id) ?? null}
              open={open === th.id}
              onOpen={() => {
                onOpen(th.id);
                const s = spans.get(th.id);
                if (s) api.current?.reveal(s.from, s.to);
              }}
              act={act}
              members={members}
            />
          ))}
          {resolved.length ? (
            <button
              className="self-start px-1 py-1 text-[13px] text-secondary cursor-default hover:text-label"
              aria-expanded={showResolved}
              onClick={() => setShowResolved(!showResolved)}
            >
              {t("page.commentsResolved", { n: resolved.length })}
            </button>
          ) : null}
          {showResolved
            ? resolved.map(th => (
                <Thread
                  key={th.id}
                  thread={th}
                  span={spans.get(th.id) ?? null}
                  open={open === th.id}
                  onOpen={() => onOpen(th.id)}
                  act={act}
                  members={members}
                />
              ))
            : null}
        </div>
      )}
    </aside>
  );
}

/** One thread: the quoted text (or that it is gone), the comment and its replies, then Reply, Resolve or Reopen. */
function Thread({
  thread,
  span,
  open,
  onOpen,
  act,
  members,
}: {
  thread: CommentThread;
  span: Span;
  open: boolean;
  onOpen: () => void;
  act: (kind: string, on: string, text?: string, mentions?: string[]) => Promise<void>;
  members: Member[];
}) {
  const { t } = useT();
  const [replying, setReplying] = useState(false);
  return (
    <section
      className={`flex flex-col gap-2 p-2.5 rounded-lg border ${open ? "border-soon bg-fill" : "border-separator"} ${thread.resolved ? "opacity-70" : ""}`}
    >
      <button className="text-left text-xs text-secondary italic line-clamp-2 cursor-default" onClick={onOpen}>
        {span ? `“${thread.quote}”` : t("page.commentGone", { quote: thread.quote })}
      </button>
      {[thread, ...thread.replies].map(c => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-label truncate">{c.by}</span>
            <span className="flex-1 text-tertiary">{agoOf(c.at, t)}</span>
            {c.mine ? (
              <button className="text-tertiary hover:text-late cursor-default" onClick={() => void act("delete", c.id)}>
                {t("page.commentDelete")}
              </button>
            ) : null}
          </div>
          <p className="text-[13px] text-label whitespace-pre-wrap break-words">{c.text}</p>
        </div>
      ))}
      {replying ? (
        <Composer
          placeholder={t("page.replyPlaceholder")}
          send={t("page.reply")}
          members={members}
          onCancel={() => setReplying(false)}
          onSend={(text, mentions) => act("reply", thread.id, text, mentions).then(() => setReplying(false))}
        />
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <button className="text-accent-text cursor-default" onClick={() => setReplying(true)}>
            {t("page.reply")}
          </button>
          <button
            className="text-secondary hover:text-label cursor-default"
            onClick={() => void act(thread.resolved ? "reopen" : "resolve", thread.id)}
          >
            {t(thread.resolved ? "page.reopen" : "page.resolve")}
          </button>
        </div>
      )}
    </section>
  );
}

/** A comment or reply being written: ⌘↩ sends it, Escape cancels. On a shared document @ lists the members whose name
 *  starts with what follows it (↑↓ and ↩ or Tab, or a click, picks one); the members still named go with the text. */
function Composer({
  quote,
  className = "",
  placeholder,
  send,
  members = [],
  onSend,
  onCancel,
}: {
  quote?: string;
  className?: string;
  placeholder: string;
  send: string;
  members?: Member[];
  onSend: (text: string, mentions: string[]) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<Member[]>([]);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const query = members.length ? mentionQuery(text, caret) : null;
  const matches = query === null ? [] : membersFor(query, members);
  const go = () => {
    if (text.trim()) void onSend(text.trim(), mentionsIn(text, picked));
  };
  const pick = (m: Member) => {
    const start = caret - (query ?? "").length - 1;
    const next = `${text.slice(0, start)}@${m.name} ${text.slice(caret)}`;
    const at = start + m.name.length + 2;
    setText(next);
    setCaret(at);
    setPicked(p => (p.some(x => x.fp === m.fp) ? p : [...p, m]));
    setHi(0);
    requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
  };
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {quote ? <p className="text-xs text-secondary italic line-clamp-2">“{quote}”</p> : null}
      <textarea
        ref={box}
        autoFocus
        rows={3}
        className="w-full px-2.5 py-2 rounded-md border border-separator bg-bg text-[13px] text-label resize-none focus:outline-none focus:border-accent"
        placeholder={placeholder}
        value={text}
        onChange={e => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
          setHi(0);
        }}
        onSelect={e => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={e => {
          if (matches.length && ["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            setHi(i => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
          } else if (matches.length && !e.metaKey && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            pick(matches[hi] ?? matches[0]);
          } else if (e.key === "Enter" && e.metaKey) go();
          else if (e.key === "Escape") onCancel();
        }}
      />
      {matches.length ? (
        <div role="listbox" className="-mt-1 flex flex-col p-1 rounded-md border border-separator bg-bg shadow-sm">
          {matches.map((m, i) => (
            <button
              key={m.fp}
              role="option"
              aria-selected={i === hi}
              className={`px-2 py-1 rounded text-left text-[13px] text-label cursor-default ${i === hi ? "bg-fill-2" : "hover:bg-fill"}`}
              onMouseDown={e => {
                e.preventDefault();
                pick(m);
              }}
            >
              {`@${m.name}`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button className="h-7 px-2.5 rounded-md text-[13px] text-secondary hover:bg-fill" onClick={onCancel}>
          {t("page.commentCancel")}
        </button>
        <button
          className="h-7 px-2.5 rounded-md bg-accent text-on-accent text-[13px] hover:opacity-90 disabled:opacity-40"
          disabled={!text.trim()}
          onClick={go}
        >
          {send}
        </button>
      </div>
    </div>
  );
}
