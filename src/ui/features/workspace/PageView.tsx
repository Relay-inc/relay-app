import { useEffect, useRef, useState } from "react";
import { SidebarMenu, type MenuItem } from "../navigation/SidebarMenu";
import { useDismiss } from "../../hooks/useDismiss";
import { loadChanges, runPageAction, setChangesOpen, useChangesStore } from "../../../application/navigation/changes";
import { openCount } from "../../../domain/workspace/changes";
import { Toast } from "../conversations/Toast";
import {
  addToConversation,
  askAboutPage,
  copyPagePath,
  revealPage,
  openNoteLink,
  loadPage,
  pagePath,
  pageProject,
  savePage,
  type Page,
  type PageHistory as History,
  type PageVersion,
  usePageThread,
} from "../../../application/navigation/pages";
import { useNavigationStore } from "../../../application/navigation/store";
import { pageKey } from "../../../domain/navigation/keys";
import { workspaceOf, workspaces } from "../../../application/navigation/workspaces";
import { chatBar, chatsOf } from "../../../application/conversations/selectors";
import { goBack } from "../../../application/navigation/navigation";
import { openNote } from "../../../application/workspace/vault";
import { useKeyLabel } from "../../hooks/useKeyLabel";
import { useConversationsStore } from "../../../application/conversations/store";
import { useWorkspaceStore } from "../../../application/workspace/store";
import { noteTitle } from "../../../domain/workspace/rules";
import { FRONTMATTER, frontmatterOf, withFrontmatter } from "../../../domain/workspace/properties";
import { noteName } from "../../../domain/navigation/pages";
import { clockTime } from "../../../shared/format";
import { agoOf } from "./ago";
import { useDerived } from "../../hooks/useDerived";
import { useT } from "../../hooks/useT";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/Icon";
import { Note } from "../../components/Note";
import { PageEditor, type CommentsApi, type HeadWriter } from "./PageEditor";
import { PageComments } from "./PageComments";
import type { Peer } from "../../../application/workspace/coedit";
import { PageTop } from "./PageTop";
import { PageHistory, VersionDiff } from "./PageHistory";
import { LinkedSections } from "./LinkedSections";
import { loadLinked } from "../../../application/navigation/linked";
import { toggleShowMarkdown, useEditorStore } from "../../../application/navigation/editor";
import { loadRail, railNote, railOpen, setRail, useRailStore } from "../../../application/navigation/rail";
import { aboutOf } from "../../../domain/workspace/rail";
import { Rail } from "./Rail";
import { registryOf } from "../../../application/types/types";
import { typeOf } from "../../../domain/types/registry";
import { typeNameOf } from "../../../domain/types/header";
import { ChangesPanel } from "./ChangesPanel";
import { toggleFavourite, useFavouritesStore } from "../../../application/navigation/favourites";

const EDIT_MAX = 1_000_000; // characters: a bigger note is shown read-only

/** A workspace's note as a page in the middle column (the A6 design): a bar with where it lives, when it was edited and
 *  Ask Claude, then its folders, icon and title, its properties, the project's conversations and the body. */
export function PageView({ target, className }: { target: string; className: string }) {
  const { t, locale } = useT();
  const read = useNavigationStore(s => s.panel.detail[pageKey(target)]) as Page | undefined;
  const toast = useNavigationStore(s => s.toast);
  useEffect(() => {
    void loadPage(target);
    void loadLinked(); // the project page's auto sections
  }, [target]);
  const page = read && !("err" in read) ? read : null;
  const err = read && "err" in read ? read.err : "";
  // the rail is asked for when the page opens and after each save (a new hash), not on a keystroke
  const hash = page?.hash;
  useEffect(() => {
    if (!hash) return;
    const { folder, path } = railNote(target);
    void loadRail(folder, path);
  }, [target, hash]);
  const folder = railNote(target).folder;
  useRailStore(s => s.closed); // the rail's fold follows
  const shown = railOpen(folder);
  // the Changes feed of the page's workspace: its count on the pill, the panel when open
  useEffect(() => {
    void loadChanges(folder);
  }, [folder, hash]);
  const feed = useChangesStore(s => s.by[folder]);
  const feedOpen = useChangesStore(s => s.open);
  const toReview = feed ? openCount(feed) : 0;
  const pinned = useFavouritesStore(s => (s.by[folder] ?? []).includes(railNote(target).path));
  const raw = useEditorStore(s => s.showMarkdown);
  const scroller = useRef<HTMLDivElement>(null);
  const path = pagePath(target) || target;
  // the page's own workspace, not the one the sidebar shows
  const workspace = useDerived(() => workspaces().find(w => w.folder === workspaceOf(pageKey(target)))?.name ?? "");
  const project = useDerived(() => pageProject(path));
  const icon = useWorkspaceStore(s => (project ? s.icons[project.key] : undefined));
  // the project's conversations, newest first
  useConversationsStore(s => s.chats); // the count follows new and closed conversations
  const chats = project ? chatsOf(project.key) : [];
  // what the page was opened from: "← its title" goes back to it (⌘[ and Esc too)
  const back = useDerived(() => {
    const key = useNavigationStore.getState().back?.key;
    if (!key) return null;
    const bar = chatBar(key);
    return (bar.onView ? bar.heading : bar.title) || t("page.backDefault");
  });
  const backKey = useKeyLabel("app.back");

  const headRef = useRef<HeadWriter["current"]>(null);
  // the Ask Claude and More menus, under their buttons
  const [menu, setMenu] = useState<{ kind: "ask" | "more"; x: number; y: number } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  useDismiss(menuElement, !!menu, () => setMenu(null), { inside: el => !!el.closest("[data-menu-button]") });
  const openMenu = (kind: "ask" | "more") => (e: React.MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setMenu(menu?.kind === kind ? null : { kind, x: kind === "ask" ? box.left : box.right - 180, y: box.bottom + 4 });
  };
  const [peers, setPeers] = useState<Peer[]>([]); // who else is on a shared document's page
  // what is beside the page (its history or its comments, one at a time), and a version picked in the history (what
  // changed since shows in the page's place); both belong to the page they were opened on
  const [view, setView] = useState<{
    on: string;
    side: "history" | "comments" | null;
    picked: { v: PageVersion; kind: History["kind"] } | null;
  }>({
    on: target,
    side: null,
    picked: null,
  });
  const side = view.on === target ? view.side : null;
  const history = side === "history";
  const picked = view.on === target ? view.picked : null;
  const setPicked = (p: typeof picked) => setView({ on: target, side, picked: p });
  // the comments' side of the editor, and what it tells them
  const commentsApi = useRef<CommentsApi | null>(null);
  const [selected, setSelected] = useState(false);
  // ⌘⌥M: the selection it was pressed on, as a new comment's draft (`n` tells one press from the next)
  const [compose, setCompose] = useState<{ n: number; sel: ReturnType<CommentsApi["selection"]> }>({ n: 0, sel: null });
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [edits, setEdits] = useState(0);
  const showComments = () => setView({ on: target, side: "comments", picked: null });
  // a thread the Inbox opened this page on: the comments beside it, that thread open
  const asked = usePageThread(s => s);
  const [took, setTook] = useState(0);
  if (asked.n !== took && asked.page === target) {
    setTook(asked.n);
    setView({ on: target, side: "comments", picked: null });
    setOpenThread(asked.thread);
  }
  const { title, head, body } = page ? pageParts(path, page.text) : { ...noteTitle(path, noteName(path)), head: "" };
  const folders = railNote(target).path.split("/").slice(0, -1); // where the note really is, in its workspace
  // a typed note's header shows its about: in its breadcrumb, the bar's chip is for the others
  const typed = useDerived(() => !!typeOf(registryOf(folder), typeNameOf(head)));
  const about = typed ? "" : aboutOf(frontmatterOf(head) ?? "");

  const ACTIONS = ["summarise", "next-steps", "link", "properties", "split"] as const;
  const menuItems = (): MenuItem[] =>
    menu?.kind === "more"
      ? [
          { id: "addchat", label: t("pages.addToChat"), icon: "talk" },
          { id: "reveal", label: t("pages.reveal"), icon: "folder" },
          { id: "open", label: t("note.open"), icon: "out" },
          { id: "copy", label: t("pages.copyPath"), icon: "copy" },
          { id: "markdown", label: t(raw ? "page.hideMarkdown" : "page.showMarkdown"), icon: "term" },
        ]
      : [
          { id: "ask", label: t("page.askAbout"), icon: "talk" },
          ...(selected ? [{ id: "", label: t("page.actOn"), head: true }] : []),
          ...ACTIONS.map(a => ({ id: `act:${a}`, label: t(`page.action.${a}`), icon: "wand" })),
        ];
  const pick = (id: string) => {
    setMenu(null);
    if (id === "ask") void askAboutPage(path);
    else if (id === "addchat") void addToConversation(railNote(target).path, folder);
    else if (id === "reveal") void revealPage(path);
    else if (id === "open") void openNote(target);
    else if (id === "copy") void copyPagePath(path);
    else if (id === "markdown") toggleShowMarkdown();
    else if (id.startsWith("act:"))
      void runPageAction(folder, railNote(target).path, id.slice(4), commentsApi.current?.selection()?.quote ?? null);
  };

  return (
    <div className={`${className} relative flex flex-col min-h-0`}>
      {/* app chrome is not text: no selection in the bar, like a native Mac app */}
      <div className="h-12 flex-none flex items-center gap-2 pl-4 pr-2.5 select-none" data-tauri-drag-region>
        {back ? (
          <>
            <button
              data-page-back
              className="-ml-2 inline-flex items-center gap-1.5 h-7.5 max-w-60 pl-1.5 pr-2.5 rounded-lg text-[13px] font-medium text-secondary cursor-default hover:bg-fill-2 hover:text-label"
              title={t("page.back", { title: back }) + ` (${backKey})`}
              onClick={() => void goBack()}
            >
              <Icon name="left" className="glyph size-3.75 flex-none" />
              <span className="truncate">{back}</span>
            </button>
            <span className="w-px h-4 bg-separator-strong" />
          </>
        ) : null}
        <Icon name="file" className="glyph size-3.75 text-tertiary" />
        <div title={path} className="flex-1 min-w-0 flex items-center gap-1.5 text-[13px] whitespace-nowrap">
          <span className="text-tertiary">{workspace}</span>
          <span className="text-tertiary">/</span>
          <span className="truncate font-medium text-label">{title}</span>
        </div>
        {peers.length ? (
          <div
            role="img"
            aria-label={t("page.peers", { names: peers.map(p => p.name).join(", ") })}
            title={peers.map(p => p.name).join(", ")}
            className="flex -space-x-1"
          >
            {peers.map(p => (
              <span
                key={p.from}
                className="size-6 grid place-items-center rounded-full ring-2 ring-bg text-[10px] font-semibold text-white"
                style={{ backgroundColor: p.color }}
              >
                {initials(p.name)}
              </span>
            ))}
          </div>
        ) : null}
        <button
          className={`h-6.5 flex items-center gap-1.5 px-2.5 rounded-full text-[13px] font-medium ${feedOpen ? "bg-accent-soft text-accent-text" : "border border-separator-strong text-label hover:bg-fill"}`}
          aria-label={t("changes.pill", { n: toReview })}
          aria-pressed={feedOpen}
          onClick={() => setChangesOpen(!feedOpen)}
        >
          <Icon name="edit" className="glyph size-3.25" />
          {t("changes.title")}
          {toReview ? (
            <span className="min-w-4 h-4 px-1 grid place-items-center rounded-full bg-accent text-on-accent text-[10.5px] font-semibold">
              {toReview}
            </span>
          ) : null}
        </button>
        {page?.modified ? (
          <span className="text-xs text-tertiary">{t("page.edited", { ago: agoOf(page.modified, t) })}</span>
        ) : null}
        <button
          className={`size-7 grid place-items-center rounded-md text-secondary hover:bg-fill hover:text-label ${history ? "bg-fill-2 text-label" : ""}`}
          title={t("page.history")}
          aria-label={t("page.history")}
          aria-pressed={history}
          onClick={() => setView({ on: target, side: history ? null : "history", picked: null })}
        >
          <Icon name="clock" className="glyph size-4" />
        </button>
        <button
          className={`size-7 grid place-items-center rounded-md text-secondary hover:bg-fill hover:text-label ${side === "comments" ? "bg-fill-2 text-label" : ""}`}
          title={t("page.comments")}
          aria-label={t("page.comments")}
          aria-pressed={side === "comments"}
          onClick={() => setView({ on: target, side: side === "comments" ? null : "comments", picked: null })}
        >
          <Icon name="talk" className="glyph size-4" />
        </button>
        <button
          data-menu-button
          className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-separator text-[13px] text-label hover:bg-fill"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "ask"}
          onClick={openMenu("ask")}
        >
          <Icon name="wand" className="glyph size-3.5" />
          {t("page.ask")}
        </button>
      </div>

      <div className="h-10 flex-none flex items-center gap-1.5 pl-6 pr-4 text-sm text-secondary select-none">
        <div data-breadcrumb className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
          {folders.map((name, i) => (
            <span key={i} className="contents">
              {i ? <Icon name="right" className="glyph size-3 flex-none text-tertiary" /> : null}
              <span>{name}</span>
            </span>
          ))}
        </div>
        {folders.length ? <Icon name="right" className="glyph size-3 flex-none text-tertiary" /> : null}
        <span className="truncate">{title}</span>
        {about ? (
          <button
            className="ml-2 h-5.5 flex-none flex items-center gap-1.5 pl-1.5 pr-2 rounded-md border border-separator-strong text-xs text-accent-text"
            onClick={() => void openNoteLink(about)}
          >
            <span className="text-secondary">about:</span>
            <span className="size-3.5 grid place-items-center rounded-sm bg-accent-soft text-[9px] font-bold">
              {about.charAt(0).toUpperCase()}
            </span>
            {about}
          </button>
        ) : null}
        <span className="flex-1" />
        <button
          className={`size-7 grid place-items-center rounded-md hover:bg-fill ${pinned ? "text-accent-text" : "text-secondary hover:text-label"}`}
          title={t(pinned ? "pages.unfavourite" : "pages.favourite")}
          aria-label={t(pinned ? "pages.unfavourite" : "pages.favourite")}
          aria-pressed={pinned}
          onClick={() => void toggleFavourite(railNote(target).path)}
        >
          <Icon name="star" className={`glyph size-4 ${pinned ? "fill-current" : ""}`} />
        </button>
        <button
          className={`size-7 grid place-items-center rounded-md ${shown ? "bg-accent-soft text-accent-text" : "text-secondary hover:bg-fill hover:text-label"}`}
          title={t(shown ? "rail.hide" : "rail.show")}
          aria-label={t(shown ? "rail.hide" : "rail.show")}
          aria-pressed={shown}
          onClick={() => {
            setRail(folder, !shown);
            if (!shown) setView({ on: target, side: null, picked: null });
          }}
        >
          <Icon name="columns" className="glyph size-4" />
        </button>
        <button
          data-menu-button
          className="size-7 grid place-items-center rounded-md text-secondary hover:bg-fill hover:text-label"
          title={t("page.more")}
          aria-label={t("page.more")}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "more"}
          onClick={openMenu("more")}
        >
          <Icon name="more" className="glyph size-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
          {err ? (
            <div className="err-box m-4.5">{err}</div>
          ) : !page ? (
            <div className="p-4.5">
              <Note>{t("pr.loading")}</Note>
            </div>
          ) : (
            <article className="w-full max-w-180 mx-auto pt-10 px-8 pb-16 flex flex-col gap-6">
              <PageTop
                page={target}
                project={icon}
                title={title}
                yaml={frontmatterOf(head) ?? ""}
                onChange={yaml => {
                  const next = withFrontmatter(head, yaml);
                  // through the editor: what is typed in the body goes along, one write, one hash check
                  void (headRef.current ? headRef.current(next) : savePage(target, next + body));
                }}
              >
                {project ? (
                  <>
                    <dt className="h-7 flex items-center pl-4 text-tertiary">{t("page.conversations")}</dt>
                    <dd className="flex items-center px-2">
                      <span className="inline-flex items-center gap-1.5 px-2 rounded-md border border-separator text-accent-text">
                        <Icon name="chat" className="glyph size-3" />
                        {chats.length
                          ? t("page.latest", {
                              n: chats.length,
                              time: clockTime(new Date(chats[0].at).toISOString(), locale),
                            })
                          : 0}
                      </span>
                    </dd>
                  </>
                ) : null}
              </PageTop>
              <div className="h-px bg-separator" />
              {picked ? (
                <VersionDiff
                  page={target}
                  kind={picked.kind}
                  version={picked.v}
                  current={page.text}
                  onDone={() => {
                    setPicked(null);
                    void loadPage(target);
                  }}
                />
              ) : page.text.length > EDIT_MAX ? (
                <>
                  <Note>{t("page.tooBig")}</Note>
                  <PageBody text={body} />
                </>
              ) : (
                <PageEditor
                  key={target}
                  page={target}
                  head={head}
                  body={body}
                  headRef={headRef}
                  split={text => pageParts(path, text)}
                  onPeers={setPeers}
                  comments={{
                    onApi: api => {
                      commentsApi.current = api;
                    },
                    onSelect: setSelected,
                    onKey: () => {
                      showComments();
                      const sel = commentsApi.current?.selection() ?? null;
                      setCompose(c => ({ n: c.n + 1, sel }));
                    },
                    onOpen: id => {
                      showComments();
                      setOpenThread(id);
                    },
                    onEdited: () => setEdits(n => n + 1),
                  }}
                />
              )}
              <LinkedSections path={path} />
            </article>
          )}
        </div>
        {side === "comments" && page ? (
          <PageComments
            key={target}
            page={target}
            api={commentsApi}
            hasSelection={selected}
            compose={compose}
            open={openThread}
            onOpen={setOpenThread}
            edits={edits}
          />
        ) : null}
        {history && page ? (
          <PageHistory
            page={target}
            current={page.text}
            picked={picked?.v ?? null}
            onPick={(v, kind) => {
              setPicked(v ? { v, kind } : null);
              void loadPage(target); // the page's text as it is now, to show what changed since
            }}
          />
        ) : null}
        {shown && !side && page ? (
          <Rail target={target} text={page.text} api={commentsApi} scroller={scroller} />
        ) : null}
      </div>
      {menu ? <SidebarMenu ref={menuElement} x={menu.x} y={menu.y} items={menuItems()} onPick={pick} /> : null}
      {feedOpen ? <ChangesPanel folder={folder} /> : null}
      {/* the bar ConversationsView shows under a conversation: Undo of a page put in the trash, an error */}
      {toast ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toast toast={toast} />
        </div>
      ) : null}
    </div>
  );
}

/** A page's text read-only: rendered markdown, for a note too big to edit. */
function PageBody({ text }: { text: string }) {
  return (
    <Markdown
      className="md-note leading-[1.65] text-pretty [&_:not(pre)>code]:bg-transparent [&_:not(pre)>code]:p-0 [&_:not(pre)>code]:text-label"
      text={text}
    />
  );
}

/** A page's file in parts: its title, what comes before the body (frontmatter, the title's heading: the editor writes it
 *  back unchanged) and the body. */
function pageParts(path: string, text: string) {
  const match = FRONTMATTER.exec(text);
  const { title, body } = noteTitle(path, text.slice(match ? match[0].length : 0));
  return { title, head: text.slice(0, text.length - body.length), body };
}

/** A member's initials for their avatar: the first letters of their first two words. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0].toUpperCase())
    .join("");
}
